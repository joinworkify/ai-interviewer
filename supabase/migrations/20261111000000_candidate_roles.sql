-- Candidate interview roles (the job cards on /candidate/roles).
--
-- Reads:  anyone (anon + authenticated), active roles only. These are public
--         job listings shown before a candidate starts an interview.
-- Writes: service role only (admin tooling / TRH's API). No browser writes.
--
-- Shape matches the Role type in lib/candidate/api.ts. Purely additive: it
-- creates one new table and touches nothing else. Seed data: supabase/seed.sql.

create table if not exists public.roles (
  id               text primary key check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title            text not null check (char_length(title) between 1 and 120),
  pay_rate         text not null check (char_length(pay_rate) between 1 and 60),
  job_type         text not null check (char_length(job_type) between 1 and 80),
  skills           text[] not null default '{}',
  about            text not null default '',
  -- Arrays of { "title": text, "text": text }, rendered as bullet lists.
  responsibilities jsonb not null default '[]'
                   check (jsonb_typeof(responsibilities) = 'array'),
  requirements     jsonb not null default '[]'
                   check (jsonb_typeof(requirements) = 'array'),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.roles enable row level security;

-- Explicit grants (do not rely on default privileges).
revoke all on table public.roles from anon, authenticated;
grant select on table public.roles to anon, authenticated;
grant all on table public.roles to service_role;

drop policy if exists "roles_select_active" on public.roles;
create policy "roles_select_active" on public.roles
  for select to anon, authenticated
  using (is_active);

-- Intentionally no INSERT/UPDATE/DELETE policies or grants for browsers.
