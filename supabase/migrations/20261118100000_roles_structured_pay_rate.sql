-- Structured pay rate for public.roles: min, max and a type (per hour / per
-- task) instead of one free-text string, so the admin form can validate it and
-- the screens format it the same way everywhere.
--
-- Purely additive: three new columns, backfilled from the old pay_rate text
-- (e.g. '$10~$15/Hour'). pay_rate stays as a legacy column, no longer required.
-- Hosted Supabase must get this migration before the code that reads pay_min,
-- pay_max and pay_type is deployed.

alter table public.roles
  add column if not exists pay_min  numeric(10, 2),
  add column if not exists pay_max  numeric(10, 2),
  add column if not exists pay_type text;

update public.roles set
  pay_min  = (regexp_match(pay_rate, '^\$([0-9]+(?:\.[0-9]+)?)\s*~'))[1]::numeric,
  pay_max  = (regexp_match(pay_rate, '~\s*\$([0-9]+(?:\.[0-9]+)?)'))[1]::numeric,
  pay_type = case when pay_rate ~* '/\s*task' then 'task' else 'hour' end
where pay_min is null and pay_rate is not null;

-- Fails loudly if a legacy row could not be parsed, rather than guessing.
alter table public.roles
  alter column pay_min  set not null,
  alter column pay_max  set not null,
  alter column pay_type set not null;

alter table public.roles drop constraint if exists roles_pay_type_check;
alter table public.roles
  add constraint roles_pay_type_check check (pay_type in ('hour', 'task'));

-- Rule from the wireframe: max must always be greater than min.
alter table public.roles drop constraint if exists roles_pay_range_check;
alter table public.roles
  add constraint roles_pay_range_check check (pay_min >= 0 and pay_max > pay_min);

alter table public.roles alter column pay_rate drop not null;
comment on column public.roles.pay_rate is 'Legacy free-text pay rate. Use pay_min, pay_max and pay_type.';
