-- Persisted AI interview transcripts, built on 20261109000001_diagram_schema.sql.
--
--  * interview_sessions gets transcript_source, duration_seconds and
--    ended_reason next to the existing transcript jsonb.
--  * store_session_transcript(): the set-once write used by
--    PUT /api/sessions/:id/transcript. One UPDATE ... WHERE transcript IS NULL
--    RETURNING, so two concurrent writers cannot both win.
--
-- Written to be safe in any order relative to other migrations: every
-- statement is guarded and nothing here edits an applied migration.

alter table public.interview_sessions
  add column if not exists transcript_source text,
  add column if not exists duration_seconds int,
  add column if not exists ended_reason text;

-- To allow a new transcript provider, add a migration that drops this
-- constraint and re-creates it with the extended list.
alter table public.interview_sessions
  drop constraint if exists interview_sessions_transcript_source_check;
alter table public.interview_sessions
  add constraint interview_sessions_transcript_source_check
  check (transcript_source in ('client_gemini_live'));

alter table public.interview_sessions
  drop constraint if exists interview_sessions_duration_seconds_check;
alter table public.interview_sessions
  add constraint interview_sessions_duration_seconds_check
  check (duration_seconds between 0 and 86400);

alter table public.interview_sessions
  drop constraint if exists interview_sessions_ended_reason_check;
alter table public.interview_sessions
  add constraint interview_sessions_ended_reason_check
  check (char_length(ended_reason) between 1 and 40);

-- ---------------------------------------------------------------------------
-- store_session_transcript: atomic set-once transcript write
-- ---------------------------------------------------------------------------
-- Returns the updated row, or no row when the session does not exist, belongs
-- to another user, or already has a transcript. The caller tells those apart.
-- Status: a completed session stays completed; otherwise an empty transcript
-- means the interview never really happened (abandoned) and anything else
-- completes it. A session is never moved back to in_progress.
create or replace function public.store_session_transcript(
  p_session_id       uuid,
  p_user_id          uuid,
  p_transcript       jsonb,
  p_source           text,
  p_duration_seconds int,
  p_ended_reason     text,
  p_ended_at         timestamptz
)
returns table (id uuid, status text)
language sql
security invoker
set search_path = ''
as $$
  update public.interview_sessions as s
  set transcript = p_transcript,
      transcript_source = p_source,
      duration_seconds = p_duration_seconds,
      ended_reason = p_ended_reason,
      ended_at = coalesce(s.ended_at, p_ended_at),
      status = case
        when s.status = 'completed' then 'completed'
        when jsonb_array_length(p_transcript) = 0 then 'abandoned'
        else 'completed'
      end
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.transcript is null
  returning s.id, s.status;
$$;

revoke all on function public.store_session_transcript(
  uuid, uuid, jsonb, text, int, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.store_session_transcript(
  uuid, uuid, jsonb, text, int, text, timestamptz
) to service_role;
