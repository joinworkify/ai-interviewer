-- AI backend foundation, built on 20261109000001_diagram_schema.sql.
--
--  * capability_uses: restores single-use capability tokens. The diagram schema
--    dropped interviews.generation_id, which was the replay guard that stopped
--    one unexpired token from triggering several paid LLM calls.
--  * save_generated_interview(): claims the token and inserts the interview in
--    ONE transaction, so a concurrent replay cannot leave an orphan interview.
--  * ai_usage: one row per paid LLM call, used for per-user daily caps.
--  * feedback(session_id) unique: at most one AI evaluation per session.
--
-- Writes to capability_uses and ai_usage come only from the server (service
-- role). Statements are guarded so a re-run is a no-op.

-- ---------------------------------------------------------------------------
-- capability_uses (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.capability_uses (
  generation_id uuid primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now()
);

alter table public.capability_uses enable row level security;

revoke all on table public.capability_uses from anon, authenticated;
grant all on table public.capability_uses to service_role;
-- RLS on, no policies => only the service role can access.

-- ---------------------------------------------------------------------------
-- save_generated_interview: atomic "claim token + insert interview"
-- ---------------------------------------------------------------------------
create or replace function public.save_generated_interview(
  p_generation_id uuid,
  p_user_id       uuid,
  p_questions     text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- A reused generation_id raises unique_violation (23505) here, before any
  -- interview row is written.
  insert into public.capability_uses (generation_id, user_id)
  values (p_generation_id, p_user_id);

  insert into public.interviews (user_id, questions)
  values (p_user_id, p_questions)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_generated_interview(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.save_generated_interview(uuid, uuid, text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- ai_usage
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  feature           text not null check (char_length(feature) between 1 and 60),
  model             text not null check (char_length(model) between 1 and 120),
  prompt_tokens     int check (prompt_tokens >= 0),
  completion_tokens int check (completion_tokens >= 0),
  created_at        timestamptz not null default now()
);

create index if not exists ai_usage_user_id_created_at_idx
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

revoke all on table public.ai_usage from anon, authenticated;
grant select on table public.ai_usage to authenticated;
grant all on table public.ai_usage to service_role;

drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- feedback: at most one evaluation per session
-- ---------------------------------------------------------------------------
-- Makes the evaluate endpoint idempotent under concurrent submits: the second
-- insert fails with unique_violation and is reported as "already evaluated".
create unique index if not exists feedback_session_id_key
  on public.feedback (session_id);
