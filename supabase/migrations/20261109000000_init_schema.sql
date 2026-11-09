-- Initial schema for the Vapi-based AI interviewer.
--
-- Flow: user creates an `interviews` config -> app creates an `interview_sessions`
-- row and starts a Vapi call with metadata { sessionId } -> Vapi webhook
-- (service role) fills in call data, `transcript_messages` and `session_feedback`.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.interview_type as enum (
  'behavioral',
  'technical',
  'system_design',
  'mixed'
);

create type public.interview_difficulty as enum (
  'junior',
  'mid',
  'senior'
);

create type public.session_status as enum (
  'created',
  'in_progress',
  'completed',
  'failed'
);

create type public.message_role as enum (
  'assistant',
  'user'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- interviews (reusable, user-defined config)
-- ---------------------------------------------------------------------------
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  role text not null check (char_length(role) between 1 and 200),
  interview_type public.interview_type not null default 'mixed',
  difficulty public.interview_difficulty not null default 'mid',
  job_description text,
  focus_topics text[] not null default '{}',
  duration_minutes int not null default 15 check (duration_minutes between 5 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interviews_user_id_created_at_idx
  on public.interviews (user_id, created_at desc);

create trigger interviews_set_updated_at
  before update on public.interviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- interview_sessions (one Vapi call per row)
-- ---------------------------------------------------------------------------
create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews (id) on delete cascade,
  -- Denormalized from interviews.user_id so RLS needs no join.
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.session_status not null default 'created',
  vapi_call_id text unique,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  ended_reason text,
  recording_url text,
  cost_usd numeric(10, 4),
  created_at timestamptz not null default now()
);

create index interview_sessions_user_id_created_at_idx
  on public.interview_sessions (user_id, created_at desc);
create index interview_sessions_interview_id_idx
  on public.interview_sessions (interview_id);

-- ---------------------------------------------------------------------------
-- transcript_messages
-- ---------------------------------------------------------------------------
create table public.transcript_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions (id) on delete cascade,
  seq int not null,
  role public.message_role not null,
  content text not null,
  offset_ms int,
  unique (session_id, seq)
);

-- ---------------------------------------------------------------------------
-- session_feedback (1:1 with a session)
-- ---------------------------------------------------------------------------
create table public.session_feedback (
  session_id uuid primary key references public.interview_sessions (id) on delete cascade,
  overall_score numeric(4, 1) check (overall_score between 0 and 100),
  summary text,
  strengths jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  rubric_scores jsonb not null default '{}'::jsonb,
  raw_analysis jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- vapi_events (webhook audit log; service role only)
-- ---------------------------------------------------------------------------
create table public.vapi_events (
  id uuid primary key default gen_random_uuid(),
  vapi_call_id text,
  type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create index vapi_events_vapi_call_id_idx on public.vapi_events (vapi_call_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.transcript_messages enable row level security;
alter table public.session_feedback enable row level security;
alter table public.vapi_events enable row level security;

-- profiles
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- interviews
create policy "interviews_select_own" on public.interviews
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "interviews_insert_own" on public.interviews
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "interviews_update_own" on public.interviews
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "interviews_delete_own" on public.interviews
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- interview_sessions: users can read and create; the webhook updates.
create policy "sessions_select_own" on public.interview_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "sessions_insert_own" on public.interview_sessions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.interviews i
      where i.id = interview_id and i.user_id = (select auth.uid())
    )
  );

-- transcript_messages / session_feedback: read-only for the owner.
create policy "transcript_select_own" on public.transcript_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

create policy "feedback_select_own" on public.session_feedback
  for select to authenticated
  using (
    exists (
      select 1 from public.interview_sessions s
      where s.id = session_id and s.user_id = (select auth.uid())
    )
  );

-- vapi_events: RLS on, no policies => only the service role can access.
