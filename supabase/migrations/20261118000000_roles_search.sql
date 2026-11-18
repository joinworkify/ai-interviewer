-- Server-side search for the public role list (/candidate/roles).
--
-- PostgREST can filter a text column with ilike, but it cannot do a
-- case-insensitive partial match inside a text[]. A plain .or() query would
-- either drop skill search or only match whole, case-sensitive skills. This
-- function keeps the title + skill substring search on the database side.
--
-- Reads only, with RLS still in force (security invoker): active roles are
-- public, the same rows the table grant already exposes.

create or replace function public.search_roles(p_query text)
returns setof public.roles
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.roles
  where is_active
    and (
      coalesce(trim(p_query), '') = ''
      or strpos(lower(title), lower(trim(p_query))) > 0
      or exists (
        select 1
        from unnest(skills) as skill
        where strpos(lower(skill), lower(trim(p_query))) > 0
      )
    )
  order by sort_order, title;
$$;

revoke all on function public.search_roles(text)
  from public, anon, authenticated;
grant execute on function public.search_roles(text)
  to anon, authenticated, service_role;
