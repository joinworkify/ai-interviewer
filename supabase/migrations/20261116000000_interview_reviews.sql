-- Admin review of an interview attempt: one row per session, written from the
-- admin dashboard. A session with no row is 'pending'.
--
--  * Kept out of interview_sessions on purpose: candidates can read their own
--    sessions, but must never see a reviewer's decision.
--  * No browser access at all: only the service role (the admin routes, which
--    check the caller is an admin first) reads or writes it.
--  * Deleting the session deletes its review; deleting the admin who changed it
--    keeps the review and clears updated_by.

create table if not exists public.interview_reviews (
  session_id  uuid primary key references public.interview_sessions (id) on delete cascade,
  status      text not null default 'pending'
              check (status in ('pending', 'in_progress', 'completed', 'rejected')),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

alter table public.interview_reviews enable row level security;

revoke all on table public.interview_reviews from anon, authenticated;
grant all on table public.interview_reviews to service_role;
