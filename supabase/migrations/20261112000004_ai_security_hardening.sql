-- AI data security hardening.
--
-- Problem: 20261109000001_diagram_schema.sql let signed-in browsers write
-- interview_sessions (insert, update, delete) and feedback (insert, delete),
-- limited only by "user_id = auth.uid()" policies. Through PostgREST a user
-- could therefore forge their own transcript, status or score, or delete their
-- feedback to re-open a session for another paid evaluation.
--
-- Fix: browsers keep select-own only. Every write goes through server routes
-- that use the service role and filter by the verified user id explicitly.
--
-- Safe to apply in any order next to other migrations: every statement is
-- guarded or idempotent, nothing earlier is edited, and nothing is granted to
-- browser roles.

-- ---------------------------------------------------------------------------
-- 1. Revoke browser writes (guarded in case a table does not exist yet)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.interview_sessions') is not null then
    revoke insert, update, delete on table public.interview_sessions from anon, authenticated;
  end if;
  if to_regclass('public.feedback') is not null then
    revoke insert, update, delete on table public.feedback from anon, authenticated;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop the owner write policies. The privileges are already gone, so this is
--    defence in depth: a privilege added back by mistake still has no policy to
--    allow the write. The *_select_own policies stay.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.interview_sessions') is not null then
    drop policy if exists "sessions_insert_own" on public.interview_sessions;
    drop policy if exists "sessions_update_own" on public.interview_sessions;
    drop policy if exists "sessions_delete_own" on public.interview_sessions;
  end if;
  if to_regclass('public.feedback') is not null then
    drop policy if exists "feedback_insert_own" on public.feedback;
    drop policy if exists "feedback_delete_own" on public.feedback;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. purge_vapi_events: vapi_events has no user column and no foreign key, so
--    deleting a user or a session never cascades to it, yet its payload holds
--    call data. This removes the rows whose call id belongs to the user's
--    sessions (optionally just one session). Call it BEFORE the sessions are
--    deleted. Service role only; runs as the caller with an empty search_path.
-- ---------------------------------------------------------------------------
create or replace function public.purge_vapi_events(
  p_user_id uuid,
  p_session_id uuid default null
)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.vapi_events e
  where e.vapi_call_id in (
    select s.vapi_call_id
    from public.interview_sessions s
    where s.user_id = p_user_id
      and s.vapi_call_id is not null
      and (p_session_id is null or s.id = p_session_id)
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_vapi_events(uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_vapi_events(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Correct stale documentation. Applied migrations are not edited; these
--    comments describe the behaviour as it is now.
-- ---------------------------------------------------------------------------
comment on table public.capability_uses is
  'Single-use record of each interview-generation capability token (generation_id is the token id). It replaced interviews.generation_id as the replay guard. Server only: no browser privileges and no policy. user_id cascades from profiles, so it is deleted with the account. There is no foreign key to interviews, so deleting an interview does NOT free its token for reuse.';

comment on table public.interviews is
  'AI-generated interview questions. Browsers can select their own rows only. Rows are written by the server (save_generated_interview, service role). Deleting an interview cascades to its sessions and feedback but not to capability_uses. Rows are deleted with the account (cascade from profiles).';

comment on table public.interview_sessions is
  'One row per attempt, holding the transcript. Browsers can select their own rows only; all writes are server-side (service role) and filtered by the verified user id. Deleting a session cascades to its feedback.';

comment on table public.feedback is
  'AI feedback for a session, at most one per session. Browsers can select their own rows only; it is written once by the server after evaluation. Deleting the transcript keeps feedback; deleting the session deletes it.';

comment on table public.vapi_events is
  'Webhook audit log with no user column and no foreign key. Deleting a user or session does not cascade here. Use public.purge_vapi_events(user_id, session_id) before deleting sessions. Service role only.';

comment on table public.ai_usage is
  'Per-call AI usage used for the rolling daily quota. Browsers can select their own rows; writes are server only. Deleted with the account (cascade from profiles), which also resets that user''s quota history.';

-- ---------------------------------------------------------------------------
-- 5. Self-check: fail the migration if a browser role can still write.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  r text;
begin
  foreach t in array array['public.interview_sessions', 'public.feedback'] loop
    continue when to_regclass(t) is null;
    foreach r in array array['anon', 'authenticated'] loop
      if has_any_column_privilege(r, t, 'INSERT, UPDATE')
         or has_table_privilege(r, t, 'DELETE') then
        raise exception 'role % can still write %', r, t;
      end if;
    end loop;
  end loop;
end;
$$;
