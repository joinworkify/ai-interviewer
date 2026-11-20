-- A candidate's report of a problem during an interview attempt (lost
-- internet, microphone, could not hear the interviewer), shown to reviewers.
--
--  * No browser access: the report route checks the session belongs to the
--    signed-in user and writes with the service role; the admin pages read it.
--  * Deleting the session (or the user's account) deletes its reports.

create table if not exists public.interview_problem_reports (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.interview_sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('lost_internet', 'microphone', 'audio', 'other')),
  message     text not null default '' check (char_length(message) <= 1000),
  created_at  timestamptz not null default now()
);

create index if not exists interview_problem_reports_session_idx
  on public.interview_problem_reports (session_id, created_at);

alter table public.interview_problem_reports enable row level security;

revoke all on table public.interview_problem_reports from anon, authenticated;
grant all on table public.interview_problem_reports to service_role;
