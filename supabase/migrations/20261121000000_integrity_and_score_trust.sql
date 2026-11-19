-- Integrity signals and score trust. All reviewer-only: no browser access.
-- Only the service role (server routes and jobs) reads or writes these tables.
-- Deleting a session deletes its rows.
--
--  * interview_integrity_events: things the browser saw during the call (tab
--    hidden, window lost focus, went offline, pasted text). Signals for a
--    reviewer, never an automatic verdict.
--  * interview_identity_photos: one camera snapshot taken at setup, for a
--    reviewer to look at. The image lives in S3; only its key is kept here.
--  * interview_audio_reviews: a model's review of the recording itself:
--    second voice, reading aloud, and rubric scores from the audio, to compare
--    with the transcript-based score.
--  * evaluation_overrides: a reviewer's adjusted score for one criterion, with
--    the reason. The AI score is never overwritten, so both stay visible.
--  * calibration_cases / calibration_runs: transcripts a human scored, and the
--    AI's scores on them, to measure how far the AI is from people.

create table if not exists public.interview_integrity_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.interview_sessions (id) on delete cascade,
  kind        text not null check (kind in ('tab_hidden', 'window_blur', 'offline', 'paste', 'fullscreen_exit')),
  -- Milliseconds since the interview started (0 when unknown).
  at_ms       integer not null default 0 check (at_ms >= 0),
  -- How long it lasted, when that applies (e.g. time away from the tab).
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists interview_integrity_events_session_idx
  on public.interview_integrity_events (session_id, at_ms);

create table if not exists public.interview_identity_photos (
  session_id  uuid primary key references public.interview_sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  s3_key      text not null check (char_length(s3_key) between 1 and 300),
  size_bytes  integer not null check (size_bytes > 0),
  created_at  timestamptz not null default now()
);

create table if not exists public.interview_audio_reviews (
  session_id         uuid primary key references public.interview_sessions (id) on delete cascade,
  status             text not null check (status in ('completed', 'failed')),
  second_voice       boolean,
  reading_aloud      boolean,
  notes              text not null default '',
  -- Array of { name, score, evidence } scored from the audio.
  audio_criteria     jsonb not null default '[]' check (jsonb_typeof(audio_criteria) = 'array'),
  audio_overall      integer check (audio_overall between 0 and 100),
  model              text,
  error_code         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.evaluation_overrides (
  session_id  uuid not null references public.interview_sessions (id) on delete cascade,
  criterion   text not null check (char_length(criterion) between 1 and 60),
  score       integer not null check (score between 0 and 100),
  reason      text not null check (char_length(reason) between 1 and 500),
  updated_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (session_id, criterion)
);

create table if not exists public.calibration_cases (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(title) between 1 and 120),
  role_title    text not null check (char_length(role_title) between 1 and 120),
  -- Array of { name, description, weight }: the rubric the case is scored on.
  rubric        jsonb not null check (jsonb_typeof(rubric) = 'array'),
  -- Array of { role, text } turns.
  transcript    jsonb not null check (jsonb_typeof(transcript) = 'array'),
  -- Object of criterion name -> human score 0-100.
  human_scores  jsonb not null check (jsonb_typeof(human_scores) = 'object'),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.calibration_runs (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.calibration_cases (id) on delete cascade,
  -- Object of criterion name -> AI score (null = not covered).
  ai_scores   jsonb not null check (jsonb_typeof(ai_scores) = 'object'),
  overall     integer not null check (overall between 0 and 100),
  created_at  timestamptz not null default now()
);
create index if not exists calibration_runs_case_idx on public.calibration_runs (case_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'interview_integrity_events', 'interview_identity_photos', 'interview_audio_reviews',
    'evaluation_overrides', 'calibration_cases', 'calibration_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
