-- Display order for public.roles (the role cards on /candidate/roles).
-- Additive: one new column with a default, nothing else changes.

alter table public.roles add column if not exists sort_order int not null default 0;
