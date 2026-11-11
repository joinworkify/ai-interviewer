-- Development seed data. LOCAL ONLY.
--
-- Loaded by `supabase db reset` (config.toml [db.seed]) after all migrations,
-- as the database owner. It is never run by `db push`, so it does not reach a
-- hosted project. Do not move any of this into a migration, and do not run it
-- against a hosted database: it creates a user with a known password.
--
-- Dev login: dev@example.test / dev-password-local-only
--
-- All data is fake. Safe to run more than once: fixed ids and
-- "on conflict do nothing". Every insert lists its columns, so a column added
-- later (nullable or with a default) does not break this file. When a
-- migration renames or drops a column, or adds a NOT NULL column without a
-- default, tests/db/seed.test.ts fails; update the matching insert here.
--
-- Ids use a d0..d8 prefix so they never collide with the fixed ids in
-- tests/helpers/psql.ts.

-- ---------------------------------------------------------------------------
-- Dev user. The handle_new_user trigger creates the matching profiles row.
-- The identity row is what lets password login work.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
) values (
  'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'dev@example.test',
  crypt('dev-password-local-only', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"Dev User"}',
  '', '', '', '', ''
)
on conflict (id) do nothing;

-- auth.identities.email is a generated column (from identity_data), so it is
-- not listed here.
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (
  'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
  'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
  '{"sub":"d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0","email":"dev@example.test","email_verified":true}',
  'email'
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Interviews (AI-generated questions)
-- ---------------------------------------------------------------------------
insert into public.interviews (id, user_id, questions, duration_minutes) values
  (
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'Tell me about a React project you are proud of.',
      'How do you decide what to test, and what not to?',
      'Describe a production bug you debugged. What was the root cause?'
    ],
    15
  ),
  (
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'What is the difference between a process and a thread?',
      'How would you design a rate limiter?'
    ],
    10
  ),
  (
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array['Walk me through how you would onboard onto an unfamiliar codebase.'],
    5
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sessions: one with no transcript, one with a transcript ready to evaluate,
-- one completed (with feedback below).
-- ---------------------------------------------------------------------------
insert into public.interview_sessions (
  id, interview_id, user_id, status, vapi_call_id, started_at, ended_at, transcript, recording_url
) values
  (
    'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'in_progress', 'seed-call-1', now() - interval '2 hours', null, null, null
  ),
  (
    'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'in_progress', 'seed-call-2', now() - interval '1 hour', null,
    '[
      {"role":"assistant","message":"Tell me about a React project you are proud of."},
      {"role":"user","message":"I built an internal dashboard in React with TypeScript. It cut report prep from two hours to ten minutes."},
      {"role":"assistant","message":"How do you decide what to test, and what not to?"},
      {"role":"user","message":"I test behaviour users rely on, like permissions and money maths, and skip pure layout."}
    ]',
    null
  ),
  (
    'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6',
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'completed', 'seed-call-3', now() - interval '1 day', now() - interval '1 day' + interval '9 minutes',
    '[
      {"role":"assistant","message":"What is the difference between a process and a thread?"},
      {"role":"user","message":"A process has its own memory space. Threads share the memory of their process, so they are cheaper but need locking."}
    ]',
    null
  )
on conflict (id) do nothing;

insert into public.feedback (
  id, session_id, user_id, total_score, strengths, areas_for_improvement, final_assessment, per_answer
) values (
  'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7',
  'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6',
  'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
  72,
  array['Clear core definition', 'Mentioned the memory-sharing trade-off'],
  array['Add a concrete example', 'Cover scheduling and context-switch cost'],
  'A solid, accurate answer that would be stronger with an example.',
  '[
    {"questionIndex":0,"question":"What is the difference between a process and a thread?","answer":"A process has its own memory; threads share it and need locking.","source":"transcript","score":72,"feedback":"Accurate and concise. An example would help."}
  ]'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- AI usage (counts toward the rolling daily quota)
-- ---------------------------------------------------------------------------
insert into public.ai_usage (id, user_id, feature, model, prompt_tokens, completion_tokens) values
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d1', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'seed-model', 850, 310),
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d2', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'seed-model', 640, 220),
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d3', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'seed-model', 910, 405)
on conflict (id) do nothing;
