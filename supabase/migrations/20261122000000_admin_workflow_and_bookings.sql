-- Admin workflow (notes, assignment) and interview bookings.
--
--  * reviewer_notes: internal notes on an interview, written by admins. Never
--    visible to candidates (service role only, like interview_reviews).
--  * interview_reviews.assigned_to: the admin responsible for reviewing it.
--  * interview_bookings: a time a candidate chose to take an interview. The AI
--    interview itself can be taken any time; a booking is a commitment the
--    candidate gets reminded about. Candidates read and change their own rows
--    only through the server (service role), never directly.

create table if not exists public.reviewer_notes (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.interview_sessions (id) on delete cascade,
  author_id   uuid references auth.users (id) on delete set null,
  -- Kept so a note still says who wrote it after the account is gone.
  author_name text not null check (char_length(author_name) between 1 and 200),
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists reviewer_notes_session_idx on public.reviewer_notes (session_id, created_at);

alter table public.interview_reviews
  add column if not exists assigned_to uuid references auth.users (id) on delete set null;

create table if not exists public.interview_bookings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  role_id          text not null references public.roles (id) on delete cascade,
  starts_at        timestamptz not null,
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  reminder_sent_at timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists interview_bookings_user_idx on public.interview_bookings (user_id, starts_at);
create index if not exists interview_bookings_due_idx on public.interview_bookings (starts_at) where status = 'scheduled';

alter table public.reviewer_notes enable row level security;
alter table public.interview_bookings enable row level security;
revoke all on table public.reviewer_notes from anon, authenticated;
revoke all on table public.interview_bookings from anon, authenticated;
grant all on table public.reviewer_notes to service_role;
grant all on table public.interview_bookings to service_role;
