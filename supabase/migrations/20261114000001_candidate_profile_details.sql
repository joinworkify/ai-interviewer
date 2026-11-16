alter table public.profiles
  add column if not exists phone text,
  add column if not exists linkedin_url text,
  add column if not exists portfolio_url text;