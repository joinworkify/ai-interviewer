-- Schema from the draw.io diagram, built on 20261109000000_create_interviews.sql.
--
-- Flow: a user's `interviews` row holds the AI-generated questions. Each attempt
-- is an `interview_sessions` row (the Vapi call + transcript), and the AI
-- feedback for that attempt is a `feedback` row.
--
-- Converting `interviews` drops role, level, type, techstack and generation_id
-- (not in the diagram). Statements are guarded so a re-run is a no-op.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  created_at timestamptz not null default now()
);

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for users that signed up before the trigger existed.
insert into public.profiles (id, name, email)
select
  u.id,
  coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'display_name'),
  u.email
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- interviews: keep id, user_id, created_at; add duration_minutes; questions
-- becomes text[]; drop everything else.
-- ---------------------------------------------------------------------------
alter table public.interviews add column if not exists duration_minutes int;

alter table public.interviews drop constraint if exists interviews_duration_minutes_check;
alter table public.interviews
  add constraint interviews_duration_minutes_check
  check (duration_minutes between 1 and 120);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interviews'
      and column_name = 'questions' and data_type = 'jsonb'
  ) then
    alter table public.interviews
      add column questions_text text[] not null default '{}';
    update public.interviews
    set questions_text = array(select jsonb_array_elements_text(questions))
    where jsonb_typeof(questions) = 'array';
    alter table public.interviews drop column questions;
    alter table public.interviews rename column questions_text to questions;
  end if;
end;
$$;

alter table public.interviews
  drop column if exists generation_id,
  drop column if exists role,
  drop column if exists level,
  drop column if exists type,
  drop column if exists techstack;

alter table public.interviews drop constraint if exists interviews_user_id_fkey;
alter table public.interviews
  add constraint interviews_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- interview_sessions (one row per attempt)
-- ---------------------------------------------------------------------------
create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  -- Denormalized from interviews.user_id so RLS needs no join.
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  -- Unique, so webhook retries are idempotent (nulls are allowed).
  vapi_call_id text unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  transcript jsonb,
  recording_url text
);

create index if not exists interview_sessions_interview_id_started_at_idx
  on public.interview_sessions (interview_id, started_at desc);
create index if not exists interview_sessions_user_id_started_at_idx
  on public.interview_sessions (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- feedback
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

-- ---------------------------------------------------------------------------
-- vapi_events (webhook audit log; service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.vapi_events (
  id uuid primary key default gen_random_uuid(),
  vapi_call_id text,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists vapi_events_vapi_call_id_idx
  on public.vapi_events (vapi_call_id);

-- ---------------------------------------------------------------------------
-- Grants (explicit; do not rely on default privileges) and row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.feedback enable row level security;
alter table public.vapi_events enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.interview_sessions from anon, authenticated;
revoke all on table public.feedback from anon, authenticated;
revoke all on table public.vapi_events from anon, authenticated;

grant select, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.interview_sessions to authenticated;
grant select, insert, delete on table public.feedback to authenticated;
grant all on table public.profiles to service_role;
grant all on table public.interview_sessions to service_role;
grant all on table public.feedback to service_role;
grant all on table public.vapi_events to service_role;
-- interviews keeps the grants and select policy from create_interviews.sql:
-- browsers read, only the server (service role) writes.

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- interview_sessions: owner-only
drop policy if exists "sessions_select_own" on public.interview_sessions;
create policy "sessions_select_own" on public.interview_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "sessions_insert_own" on public.interview_sessions;
create policy "sessions_insert_own" on public.interview_sessions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.interviews i
      where i.id = interview_id and i.user_id = (select auth.uid())
    )
  );

drop policy if exists "sessions_update_own" on public.interview_sessions;
create policy "sessions_update_own" on public.interview_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "sessions_delete_own" on public.interview_sessions;
create policy "sessions_delete_own" on public.interview_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- feedback: owner can read, delete, and insert for their own sessions.
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

-- vapi_events: RLS on, no policies => only the service role can access.
