-- Align the schema with the draw.io diagram.
--
-- Builds on 20261109000000_init_schema.sql (which is left untouched). Existing
-- data is migrated, not dropped, except where the diagram has no column for it:
--   * session_feedback.rubric_scores / raw_analysis
--   * interview_sessions.duration_seconds / ended_reason / cost_usd
--   * interviews.title / role / job_description / focus_topics
-- Statements are guarded (IF [NOT] EXISTS, DO blocks) so a re-run is a no-op.

-- ---------------------------------------------------------------------------
-- profiles: display_name -> name, add email
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'display_name'
  ) then
    alter table public.profiles rename column display_name to name;
  end if;
end;
$$;

alter table public.profiles add column if not exists email text;

-- Profiles for users that signed up before the trigger existed.
insert into public.profiles (id, name, email)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'display_name'),
  u.email
from auth.users u
on conflict (id) do nothing;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'display_name'
    ),
    new.email
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- interviews
-- ---------------------------------------------------------------------------
alter table public.interviews
  add column if not exists questions text[] not null default '{}';

-- duration_minutes: nullable, 1..120.
alter table public.interviews
  alter column duration_minutes drop not null,
  alter column duration_minutes drop default;
alter table public.interviews drop constraint if exists interviews_duration_minutes_check;
alter table public.interviews
  add constraint interviews_duration_minutes_check
  check (duration_minutes between 1 and 120);

drop trigger if exists interviews_set_updated_at on public.interviews;
drop function if exists public.set_updated_at();

alter table public.interviews
  drop column if exists title,
  drop column if exists role,
  drop column if exists interview_type,
  drop column if exists difficulty,
  drop column if exists job_description,
  drop column if exists focus_topics,
  drop column if exists updated_at;

alter table public.interviews drop constraint if exists interviews_user_id_fkey;
alter table public.interviews
  add constraint interviews_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- interview_sessions
-- ---------------------------------------------------------------------------
alter table public.interview_sessions add column if not exists transcript jsonb;

-- Fold transcript_messages into interview_sessions.transcript.
do $$
begin
  if to_regclass('public.transcript_messages') is not null then
    update public.interview_sessions s
    set transcript = t.messages
    from (
      select
        session_id,
        jsonb_agg(
          jsonb_build_object('role', role::text, 'content', content, 'offset_ms', offset_ms)
          order by seq
        ) as messages
      from public.transcript_messages
      group by session_id
    ) t
    where t.session_id = s.id and s.transcript is null;
  end if;
end;
$$;

drop table if exists public.transcript_messages;

-- status: enum -> text with a check.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interview_sessions'
      and column_name = 'status' and data_type = 'USER-DEFINED'
  ) then
    alter table public.interview_sessions alter column status drop default;
    alter table public.interview_sessions
      alter column status type text
      using (
        case status::text
          when 'created' then 'in_progress'
          when 'failed' then 'abandoned'
          else status::text
        end
      );
  end if;
end;
$$;

alter table public.interview_sessions alter column status set default 'in_progress';
alter table public.interview_sessions drop constraint if exists interview_sessions_status_check;
alter table public.interview_sessions
  add constraint interview_sessions_status_check
  check (status in ('in_progress', 'completed', 'abandoned'));

-- started_at: not null default now() (backfilled from created_at).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interview_sessions'
      and column_name = 'created_at'
  ) then
    update public.interview_sessions
    set started_at = coalesce(started_at, created_at);
  end if;
end;
$$;

alter table public.interview_sessions
  alter column started_at set default now(),
  alter column started_at set not null;

alter table public.interview_sessions
  drop column if exists duration_seconds,
  drop column if exists ended_reason,
  drop column if exists cost_usd,
  drop column if exists created_at;

alter table public.interview_sessions drop constraint if exists interview_sessions_user_id_fkey;
alter table public.interview_sessions
  add constraint interview_sessions_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

drop index if exists public.interview_sessions_user_id_created_at_idx;
drop index if exists public.interview_sessions_interview_id_idx;
create index if not exists interview_sessions_interview_id_started_at_idx
  on public.interview_sessions (interview_id, started_at desc);
create index if not exists interview_sessions_user_id_started_at_idx
  on public.interview_sessions (user_id, started_at desc);

-- Owner-only update and delete (select and insert policies already exist).
drop policy if exists "sessions_update_own" on public.interview_sessions;
create policy "sessions_update_own" on public.interview_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "sessions_delete_own" on public.interview_sessions;
create policy "sessions_delete_own" on public.interview_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- feedback (replaces session_feedback)
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  -- Denormalized from the session so RLS needs no join on read.
  user_id uuid not null references public.profiles (id) on delete cascade,
  total_score int check (total_score between 0 and 100),
  strengths text[] not null default '{}',
  areas_for_improvement text[] not null default '{}',
  final_assessment text,
  per_answer jsonb,
  created_at timestamptz not null default now()
);

create index if not exists feedback_session_id_created_at_idx
  on public.feedback (session_id, created_at desc);
create index if not exists feedback_user_id_created_at_idx
  on public.feedback (user_id, created_at desc);

do $$
begin
  if to_regclass('public.session_feedback') is not null then
    insert into public.feedback (
      session_id, user_id, total_score, strengths, areas_for_improvement,
      final_assessment, created_at
    )
    select
      sf.session_id,
      s.user_id,
      round(sf.overall_score)::int,
      case when jsonb_typeof(sf.strengths) = 'array'
        then array(select jsonb_array_elements_text(sf.strengths))
        else '{}'::text[]
      end,
      case when jsonb_typeof(sf.improvements) = 'array'
        then array(select jsonb_array_elements_text(sf.improvements))
        else '{}'::text[]
      end,
      sf.summary,
      sf.created_at
    from public.session_feedback sf
    join public.interview_sessions s on s.id = sf.session_id;
  end if;
end;
$$;

drop table if exists public.session_feedback;

alter table public.feedback enable row level security;

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own" on public.feedback
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "feedback_delete_own" on public.feedback;
create policy "feedback_delete_own" on public.feedback
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Cleanup: enums no longer used by any column.
-- ---------------------------------------------------------------------------
drop type if exists public.interview_type;
drop type if exists public.interview_difficulty;
drop type if exists public.session_status;
drop type if exists public.message_role;
