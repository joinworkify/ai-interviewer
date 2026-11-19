-- Candidate follow-up (in-app notifications, more email stages) and
-- role tasks (written / coding / case work samples after the voice interview).
--
-- Everything here is server-only: no browser grants. Candidates reach their
-- own rows through routes that filter by the verified user id, and a role's
-- tasks only through the owner-checked task route (roles are public listings,
-- so tasks must not be a column there).

-- In-app notifications. One row per event; (user, kind, session) is unique so
-- a retried job never shows the same notification twice.
create table if not exists public.candidate_inbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('received', 'in_review', 'accepted', 'not_selected', 'unfinished', 'booking', 'booking_reminder')),
  -- Part of the dedupe key; the nil uuid when the event is not about a session.
  session_id  uuid not null default '00000000-0000-0000-0000-000000000000',
  title       text not null check (char_length(title) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 1000),
  link        text check (link is null or link ~ '^/'),
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, kind, session_id)
);
create index if not exists candidate_inbox_user_idx on public.candidate_inbox (user_id, created_at desc);

-- More emailed stages (the table dedupes one email per session and stage).
alter table public.candidate_notifications drop constraint if exists candidate_notifications_stage_check;
alter table public.candidate_notifications
  add constraint candidate_notifications_stage_check
  check (stage in ('in_review', 'accepted', 'not_selected', 'received', 'unfinished'));

create table if not exists public.role_tasks (
  id        uuid primary key default gen_random_uuid(),
  role_id   text not null references public.roles (id) on delete cascade,
  kind      text not null check (kind in ('writing', 'coding', 'case')),
  title     text not null check (char_length(title) between 1 and 120),
  prompt    text not null check (char_length(prompt) between 1 and 4000),
  minutes   integer not null default 20 check (minutes between 5 and 120),
  position  integer not null default 0
);
create index if not exists role_tasks_role_idx on public.role_tasks (role_id, position);

create table if not exists public.task_submissions (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.interview_sessions (id) on delete cascade,
  task_id       uuid not null references public.role_tasks (id) on delete cascade,
  answer        text not null check (char_length(answer) <= 20000),
  started_at    timestamptz not null,
  submitted_at  timestamptz not null default now(),
  -- What the browser saw while the task was open (signals, not proof).
  paste_count   integer not null default 0 check (paste_count >= 0),
  away_ms       integer not null default 0 check (away_ms >= 0),
  unique (session_id, task_id)
);

do $$
declare t text;
begin
  foreach t in array array['candidate_inbox', 'role_tasks', 'task_submissions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;
