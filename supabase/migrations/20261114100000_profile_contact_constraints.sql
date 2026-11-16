-- Contact details are written through POST /api/candidate/profile, but the
-- profiles_update_own policy also lets a browser update its own row, so the
-- same rules are enforced here. The links are shown to reviewers, so only
-- http(s) is allowed (no javascript: or data: links).
-- NOT VALID: existing rows are not re-checked; every new write is.

alter table public.profiles
  add constraint profiles_phone_format
    check (phone is null or phone ~ '^\+?[0-9 ()-]{7,32}$') not valid,
  add constraint profiles_linkedin_url_format
    check (linkedin_url is null or (linkedin_url ~* '^https?://' and length(linkedin_url) <= 2048)) not valid,
  add constraint profiles_portfolio_url_format
    check (portfolio_url is null or (portfolio_url ~* '^https?://' and length(portfolio_url) <= 2048)) not valid;
