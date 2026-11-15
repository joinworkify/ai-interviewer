-- Candidate resumes: one row per uploaded file. The file itself lives in S3
-- (AWS_S3_BUCKET) under resumes/<user_id>/<uuid>.<ext>; this row records it.
--
--  * status starts 'pending' when the upload link is issued and becomes
--    'uploaded' once the server has seen the object in S3.
--  * Deleting a user deletes their rows (the S3 files are removed by the
--    delete-account route before the user is deleted).
--
-- Browsers can read their own rows and cannot write; only the service role
-- inserts and updates. Statements are guarded so a re-run is a no-op.

create table if not exists public.candidate_resumes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  s3_key       text not null unique check (char_length(s3_key) between 1 and 300),
  file_name    text not null check (char_length(file_name) between 1 and 255),
  content_type text not null check (content_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )),
  size_bytes   integer not null check (size_bytes between 1 and 5242880),
  status       text not null default 'pending' check (status in ('pending', 'uploaded')),
  created_at   timestamptz not null default now(),
  uploaded_at  timestamptz
);

create index if not exists candidate_resumes_user_id_created_at_idx
  on public.candidate_resumes (user_id, created_at desc);

alter table public.candidate_resumes enable row level security;

revoke all on table public.candidate_resumes from anon, authenticated;
grant select on table public.candidate_resumes to authenticated;
grant all on table public.candidate_resumes to service_role;

drop policy if exists "candidate_resumes_select_own" on public.candidate_resumes;
create policy "candidate_resumes_select_own" on public.candidate_resumes
  for select to authenticated
  using (user_id = (select auth.uid()));
