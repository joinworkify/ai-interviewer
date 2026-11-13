-- Candidate consent: one row per interview attempt, written by the server in
-- the same step that creates the attempt (POST /api/candidate/attempts), so an
-- attempt cannot exist without a record of what the candidate agreed to.
--
--  * session_id is unique: one consent per attempt.
--  * consent_version names the wording shown (lib/candidate/consent.ts); the
--    text itself lives in the repository at that version.
--  * Deleting a user, an interview or a session deletes its consent rows too.
--
-- Browsers can read their own rows and cannot write; only the service role
-- inserts. Statements are guarded so a re-run is a no-op.

create table if not exists public.candidate_consents (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  session_id      uuid not null unique references public.interview_sessions (id) on delete cascade,
  role_id         text not null check (char_length(role_id) between 1 and 80),
  consent_version text not null check (char_length(consent_version) between 1 and 40),
  accepted_at     timestamptz not null default now()
);

create index if not exists candidate_consents_user_id_accepted_at_idx
  on public.candidate_consents (user_id, accepted_at desc);

alter table public.candidate_consents enable row level security;

revoke all on table public.candidate_consents from anon, authenticated;
grant select on table public.candidate_consents to authenticated;
grant all on table public.candidate_consents to service_role;

drop policy if exists "candidate_consents_select_own" on public.candidate_consents;
create policy "candidate_consents_select_own" on public.candidate_consents
  for select to authenticated
  using (user_id = (select auth.uid()));
