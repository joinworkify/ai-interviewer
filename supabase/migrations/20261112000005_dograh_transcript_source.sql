-- Allow Dograh as a transcript source.
--
-- The transcript write path (store_session_transcript) is unchanged. A Dograh
-- call is saved by the webhook route with transcript_source = 'dograh_webhook'.
-- Only the allowed-values list of the check constraint grows. Drop and
-- re-create, as 20261111000003 anticipated, so this file can run twice.
--
-- Rollback (only while no row uses the new value):
--   alter table public.interview_sessions
--     drop constraint if exists interview_sessions_transcript_source_check;
--   alter table public.interview_sessions
--     add constraint interview_sessions_transcript_source_check
--     check (transcript_source in ('client_gemini_live'));

alter table public.interview_sessions
  drop constraint if exists interview_sessions_transcript_source_check;
alter table public.interview_sessions
  add constraint interview_sessions_transcript_source_check
  check (transcript_source in ('client_gemini_live', 'dograh_webhook'));
