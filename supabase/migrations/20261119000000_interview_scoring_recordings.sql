-- Interview scoring and audio recordings.
--
--  * role_rubrics: the criteria a role's interviews are scored against, an
--    array of { name, description, weight } set by admins. No row (or an empty
--    array) means the app uses its built-in default rubric. It is a separate
--    table, not a roles column, because roles are public job listings: a
--    column there would let any candidate read how they will be scored.
--  * interview_evaluations: one AI score per session, written server-side
--    after the transcript is stored. Each criterion's name and weight are copied in so
--    editing a role's rubric later does not change old scores.
--  * interview_recordings: one stored audio file per session (the object lives
--    in S3; only its key and size are kept here).
--
-- Reviewer-only data, like interview_reviews: no browser access at all. Only
-- the service role (admin routes and server jobs) reads or writes these.
-- Deleting the session deletes the row.

create table if not exists public.role_rubrics (
  role_id     text primary key references public.roles (id) on delete cascade,
  criteria    jsonb not null default '[]'
              check (jsonb_typeof(criteria) = 'array'),
  updated_at  timestamptz not null default now()
);

alter table public.role_rubrics enable row level security;
revoke all on table public.role_rubrics from anon, authenticated;
grant all on table public.role_rubrics to service_role;

create table if not exists public.interview_evaluations (
  session_id      uuid primary key references public.interview_sessions (id) on delete cascade,
  status          text not null default 'completed'
                  check (status in ('completed', 'failed')),
  -- 0-100 weighted average of the criteria scores; null when failed.
  overall_score   integer check (overall_score between 0 and 100),
  recommendation  text check (recommendation in ('strong_yes', 'yes', 'maybe', 'no')),
  summary         text not null default '',
  strengths       text[] not null default '{}',
  concerns        text[] not null default '{}',
  -- Array of { name, weight, score, evidence } for the rubric used.
  criteria        jsonb not null default '[]'
                  check (jsonb_typeof(criteria) = 'array'),
  model           text,
  -- Short machine code when status = 'failed' (never provider text).
  error_code      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.interview_evaluations enable row level security;
revoke all on table public.interview_evaluations from anon, authenticated;
grant all on table public.interview_evaluations to service_role;

create table if not exists public.interview_recordings (
  session_id        uuid primary key references public.interview_sessions (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  s3_key            text not null check (char_length(s3_key) between 1 and 300),
  content_type      text not null check (char_length(content_type) between 1 and 100),
  size_bytes        integer not null check (size_bytes > 0),
  -- 'pending' until the browser's upload is confirmed against S3.
  status            text not null default 'pending'
                    check (status in ('pending', 'uploaded')),
  created_at        timestamptz not null default now(),
  uploaded_at       timestamptz
);

alter table public.interview_recordings enable row level security;
revoke all on table public.interview_recordings from anon, authenticated;
grant all on table public.interview_recordings to service_role;
