-- Candidate-facing application status and email notifications.
--
--  * interview_reviews.status gains 'accepted' so a reviewer can record a
--    positive decision (the existing 'completed' only meant "review finished").
--  * candidate_notifications: one row per email sent about a session's status,
--    so changing a status back and forth never emails the candidate twice
--    about the same stage. Service role only, like interview_reviews.
--
-- Purely additive: the check constraint is widened, no data changes.

alter table public.interview_reviews
  drop constraint if exists interview_reviews_status_check;

alter table public.interview_reviews
  add constraint interview_reviews_status_check
  check (status in ('pending', 'in_progress', 'completed', 'accepted', 'rejected'));

create table if not exists public.candidate_notifications (
  session_id  uuid not null references public.interview_sessions (id) on delete cascade,
  stage       text not null check (stage in ('in_review', 'accepted', 'not_selected')),
  sent_at     timestamptz not null default now(),
  primary key (session_id, stage)
);

alter table public.candidate_notifications enable row level security;
revoke all on table public.candidate_notifications from anon, authenticated;
grant all on table public.candidate_notifications to service_role;
