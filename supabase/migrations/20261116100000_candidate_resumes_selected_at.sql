-- Candidates can keep several resumes and pick which one to use. selected_at
-- is when a resume was last chosen (or uploaded, which also chooses it). The
-- resume an application uses is the most recently selected one.
--
-- No grant changes: browsers still only read their own rows, and the service
-- role (the resume routes) does every write. Guarded so a re-run is a no-op.

alter table public.candidate_resumes
  add column if not exists selected_at timestamptz;

create index if not exists candidate_resumes_user_id_selected_at_idx
  on public.candidate_resumes (user_id, selected_at desc);
