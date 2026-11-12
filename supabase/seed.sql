-- Development seed data. LOCAL ONLY.
--
-- Loaded by `supabase db reset` (config.toml [db.seed]) after all migrations,
-- as the database owner. It is never run by `db push`, so it does not reach a
-- hosted project. Do not move any of this into a migration, and do not run it
-- against a hosted database: it creates users with a known password.
--
-- Dev login: dev@example.test / test123!
-- Second user (to check that users only see their own rows):
--            priya.nair@example.test / test123!
--
-- All data is fake. Safe to run more than once: fixed ids and
-- "on conflict do nothing". The two users are the exception: they are upserted,
-- so running the seed again also resets their password. Every insert lists its
-- columns, so a column added later (nullable or with a default) does not break
-- this file. When a migration renames or drops a column, or adds a NOT NULL
-- column without a default, tests/db/seed.test.ts fails; update the matching
-- insert here.
--
-- The dev user has one session of every kind the app produces today: a call
-- that has not started, a Vapi call waiting for feedback, finished Vapi and
-- Gemini Live sessions (one of them still without feedback), and an abandoned
-- one.
--
-- Ids use a d0..dd prefix for the dev user and e0..e4 for the second user, so
-- they never collide with the fixed ids in tests/helpers/psql.ts.

-- ---------------------------------------------------------------------------
-- Users. The handle_new_user trigger creates the matching profiles row.
-- The identity row is what lets password login work.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current
) values
  (
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'dev@example.test',
    crypt('test123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Alex Rivera"}',
    now(), now(),
    '', '', '', '', ''
  ),
  (
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'priya.nair@example.test',
    crypt('test123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"name":"Priya Nair"}',
    now(), now(),
    '', '', '', '', ''
  )
on conflict (id) do update set
  encrypted_password = excluded.encrypted_password,
  raw_user_meta_data = excluded.raw_user_meta_data,
  created_at         = coalesce(auth.users.created_at, excluded.created_at),
  updated_at         = excluded.updated_at;

-- auth.identities.email is a generated column (from identity_data), so it is
-- not listed here. created_at and updated_at have no default in auth, and the
-- auth service fails to load a user whose timestamps are NULL ("Database error
-- querying schema"), so both tables get them set explicitly.
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values
  (
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    '{"sub":"d0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0","email":"dev@example.test","email_verified":true}',
    'email', now(), now()
  ),
  (
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    '{"sub":"e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0","email":"priya.nair@example.test","email_verified":true}',
    'email', now(), now()
  )
on conflict (provider_id, provider) do update set
  created_at = coalesce(auth.identities.created_at, excluded.created_at),
  updated_at = excluded.updated_at;

-- ---------------------------------------------------------------------------
-- Interviews (AI-generated questions). Questions stay under 300 characters
-- each, which is what the voice interviewer prompts keep.
-- ---------------------------------------------------------------------------
insert into public.interviews (id, user_id, questions, duration_minutes, created_at) values
  (
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'Tell me about a React project you are proud of. What was your role and what did you learn?',
      'How do you decide whether state belongs in a component, in context, or in a store such as Redux or Zustand?',
      'A list page renders five thousand rows and scrolling stutters. How would you find the cause and fix it?',
      'What is the difference between useEffect and useLayoutEffect, and when would you reach for the second one?',
      'How do you decide what to test in a front-end codebase, and what not to test?',
      'Describe a production bug you debugged. What was the root cause and how did you stop it from coming back?'
    ],
    20,
    now() - interval '6 days'
  ),
  (
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'What is the difference between a process and a thread?',
      'How would you design a rate limiter for a public API?',
      'You need to change the type of a column on a table with 200 million rows without downtime. How do you approach it?',
      'How do you make a payment endpoint safe to retry? Explain idempotency keys.',
      'Your p99 latency doubled after a deploy. Walk me through how you would investigate.'
    ],
    25,
    now() - interval '5 days'
  ),
  (
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'Walk me through how you would onboard onto an unfamiliar codebase.',
      'Tell me about a disagreement with a teammate about a technical decision. How was it resolved?',
      'Describe a project that missed its deadline. What happened and what would you do differently?',
      'How have you helped a less experienced colleague grow?'
    ],
    15,
    now() - interval '4 days'
  ),
  (
    'd9d9d9d9-d9d9-4d9d-8d9d-d9d9d9d9d9d9',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    array[
      'What is the difference between an INNER JOIN and a LEFT JOIN? Give an example where picking the wrong one silently loses rows.',
      'A query that used to take 200 milliseconds now takes 20 seconds. Walk me through how you would investigate.',
      'How would you model a many-to-many relationship between users and teams, including the date each user joined a team?',
      'What is an index, and when can adding one make writes noticeably slower?',
      'How do you make a nightly data pipeline safe to re-run after a partial failure?'
    ],
    20,
    now() - interval '1 day'
  ),
  (
    'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    array[
      'Tell me about a time your analysis changed a decision. What did you find and what happened?',
      'How would you check whether an A/B test result is trustworthy before reporting it?',
      'Explain the difference between correlation and causation to a non-technical manager.',
      'A dashboard number looks wrong to a stakeholder. How do you handle it?'
    ],
    15,
    now() - interval '5 days'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sessions of the dev user, one of every kind:
--   d4  not started: open, no transcript (the target of a new call)
--   d5  Vapi call with a transcript, waiting for feedback
--   d6  Vapi call, completed, with feedback
--   da  Gemini Live session, completed, with feedback
--   db  Gemini Live session, completed, feedback not requested yet
--   dc  abandoned: the page was closed seconds after starting
-- Vapi transcripts use Vapi's shape ({role, message}). Gemini Live sessions use
-- the stored canonical shape ({role, text}), plus transcript_source,
-- duration_seconds and ended_reason.
-- ---------------------------------------------------------------------------
insert into public.interview_sessions (
  id, interview_id, user_id, status, vapi_call_id, started_at, ended_at,
  transcript, recording_url, transcript_source, duration_seconds, ended_reason
) values
  (
    'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4',
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'in_progress', null, now() - interval '2 hours', null,
    null, null, null, null, null
  ),
  (
    'd5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5',
    'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'in_progress', 'seed-call-2', now() - interval '1 hour', null,
    $t$[
      {"role":"assistant","message":"Hi, thanks for joining. I will ask you a few questions about front-end work. First, tell me about a React project you are proud of. What was your role and what did you learn?"},
      {"role":"user","message":"Sure. Last year I led the rebuild of our internal reporting dashboard in React and TypeScript. I was the main developer for about four months. The big win was moving the heavy filtering to the server and caching with React Query, which cut report prep from two hours to around ten minutes. What I learned is to sit with the real users early, because half of my first design was wrong."},
      {"role":"assistant","message":"Thanks. How do you decide whether state belongs in a component, in context, or in a store such as Redux or Zustand?"},
      {"role":"user","message":"I start local and only lift state when two components really need it. Context is fine for values that rarely change, like the theme or the current user. For shared data that changes often I prefer a small store so only the subscribed components re-render. I stopped putting server data in Redux because React Query already handles caching and refetching."},
      {"role":"assistant","message":"A list page renders five thousand rows and scrolling stutters. How would you find the cause and fix it?"},
      {"role":"user","message":"First I would profile with the React DevTools profiler and the browser performance tab to see if it is rendering or layout. The usual fix is virtualization, with something like react-window, so only the visible rows are in the DOM. After that I would memoize the row component and make sure its props are stable."}
    ]$t$::jsonb,
    null, null, null, null
  ),
  (
    'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6',
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'completed', 'seed-call-3', now() - interval '1 day 2 hours',
    now() - interval '1 day 2 hours' + interval '9 minutes',
    $t$[
      {"role":"assistant","message":"What is the difference between a process and a thread?"},
      {"role":"user","message":"A process has its own memory space and resources. Threads live inside a process and share its memory, so they are cheaper to start and to switch between, but you need locks or other synchronization to avoid races. A crash in one thread can also take down the whole process, while processes are isolated from each other."},
      {"role":"assistant","message":"Good. Next, how would you design a rate limiter for a public API?"},
      {"role":"user","message":"I would use a token bucket per API key. Each key gets a bucket that refills at a steady rate, and every request takes a token. For several servers I would keep the counters in Redis with an atomic script so the check and the decrement happen together. When the bucket is empty I return a 429 with a Retry-After header."},
      {"role":"assistant","message":"Now, you need to change the type of a column on a table with two hundred million rows without downtime. How do you approach it?"},
      {"role":"user","message":"I would avoid a direct type change because it rewrites the table and locks it. Instead I add a new nullable column with the new type, deploy code that writes to both columns, backfill the old rows in small batches, then switch reads to the new column and finally remove the old one in a later release."}
    ]$t$::jsonb,
    null, null, null, null
  ),
  (
    'dadadada-dada-4dad-8dad-dadadadadada',
    'd3d3d3d3-d3d3-4d3d-8d3d-d3d3d3d3d3d3',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'completed', null, now() - interval '2 days 3 hours',
    now() - interval '2 days 3 hours' + interval '5 minutes',
    $t$[
      {"role":"interviewer","text":"Let us start. Walk me through how you would onboard onto an unfamiliar codebase."},
      {"role":"candidate","text":"I begin by getting it running locally and reading the README and the tests, because tests show how the code is meant to be used. Then I pick a small bug or a tiny feature and follow it from the entry point to the database. I keep a notes file of questions and ask a teammate in batches instead of interrupting all day."},
      {"role":"interviewer","text":"Thanks. Tell me about a disagreement with a teammate about a technical decision. How was it resolved?"},
      {"role":"candidate","text":"We disagreed about adding a message queue for sending emails. I thought it was too much for our traffic. We wrote down the requirements, ran a one day spike with a database table as the queue, and measured it. It handled our load fine, so we shipped the simple version and agreed to revisit it if volume tripled."},
      {"role":"interviewer","text":"Describe a project that missed its deadline. What happened and what would you do differently?"},
      {"role":"candidate","text":"A reporting feature slipped by two weeks because we underestimated the data migration. I should have broken the work into smaller pieces earlier and flagged the risk in the first week instead of the third. Now I add a short risk list to every estimate."}
    ]$t$::jsonb,
    null, 'client_gemini_live', 300, 'time_limit'
  ),
  (
    'dbdbdbdb-dbdb-4dbd-8dbd-dbdbdbdbdbdb',
    'd9d9d9d9-d9d9-4d9d-8d9d-d9d9d9d9d9d9',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'completed', null, now() - interval '3 hours',
    now() - interval '3 hours' + interval '297 seconds',
    $t$[
      {"role":"interviewer","text":"Hi, thanks for joining. Let us talk about SQL. What is the difference between an INNER JOIN and a LEFT JOIN? Give an example where picking the wrong one silently loses rows."},
      {"role":"candidate","text":"An inner join returns only rows that match on both sides. A left join keeps every row from the left table and fills the right side with nulls when there is no match. If I join customers to orders with an inner join, customers with no orders disappear from the report, so a list of all customers and their order counts has to use a left join."},
      {"role":"interviewer","text":"A query that used to take 200 milliseconds now takes 20 seconds. Walk me through how you would investigate."},
      {"role":"candidate","text":"I would run EXPLAIN ANALYZE to see the actual plan and compare it with an older plan if I have one. I look for a sequential scan where there used to be an index scan, stale statistics, or a changed join order. Then I check whether the data volume grew, run ANALYZE on the table, and add or fix an index if the plan shows one is missing."},
      {"role":"interviewer","text":"How would you model a many-to-many relationship between users and teams, including the date each user joined a team?"},
      {"role":"candidate","text":"I would use a join table, team members, with a user id and a team id as a composite primary key, plus a joined at column. Both ids are foreign keys, and I would add an index on the team id for the reverse lookup."},
      {"role":"interviewer","text":"Thank you for your answers. That is all the time we have. Goodbye."}
    ]$t$::jsonb,
    null, 'client_gemini_live', 297, 'interviewer_ended'
  ),
  (
    'dcdcdcdc-dcdc-4dcd-8dcd-dcdcdcdcdcdc',
    'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    'abandoned', null, now() - interval '2 days 5 hours',
    now() - interval '2 days 5 hours' + interval '9 seconds',
    '[]'::jsonb,
    null, 'client_gemini_live', 9, 'page_closed'
  ),
  (
    'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
    'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    'completed', null, now() - interval '4 days 1 hour',
    now() - interval '4 days 1 hour' + interval '6 minutes',
    $t$[
      {"role":"interviewer","text":"Tell me about a time your analysis changed a decision. What did you find and what happened?"},
      {"role":"candidate","text":"At my last job I looked at why trial users were not converting. I found that users who finished the setup checklist in the first two days converted at three times the rate of the others. We moved the checklist to the first screen, and conversion rose by about eight percent over the next quarter."},
      {"role":"interviewer","text":"How would you check whether an A/B test result is trustworthy before reporting it?"},
      {"role":"candidate","text":"I first check the sample ratio to confirm users were split as planned. Then I confirm the test ran for full weeks, that I did not stop early when the number looked good, and that the metric and the sample size were decided before the test started. If the effect is small I report the confidence interval, not only the p value."}
    ]$t$::jsonb,
    null, 'client_gemini_live', 360, 'interviewer_ended'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Feedback. Sources are "transcript": each answer is a short summary of what
-- the candidate said, as the evaluator writes it. Session db has none yet.
-- ---------------------------------------------------------------------------
insert into public.feedback (
  id, session_id, user_id, total_score, strengths, areas_for_improvement,
  final_assessment, per_answer, created_at
) values
  (
    'd7d7d7d7-d7d7-4d7d-8d7d-d7d7d7d7d7d7',
    'd6d6d6d6-d6d6-4d6d-8d6d-d6d6d6d6d6d6',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    75,
    array[
      'Accurate explanation of the process and thread trade-offs',
      'Practical token bucket design with an atomic Redis check',
      'Safe, step by step column migration plan'
    ],
    array[
      'Mention fairness between customers when rate limiting',
      'Say how you would verify the backfill before switching reads',
      'Add an example from your own experience'
    ],
    'Accurate, well organised answers that show real systems experience. Adding concrete numbers and failure cases would make them stronger.',
    $t$[
      {"questionIndex":0,"question":"What is the difference between a process and a thread?","answer":"Processes have separate memory; threads share their process memory, which makes them cheaper but needs synchronization, and a thread crash can end the whole process.","source":"transcript","score":80,"feedback":"Accurate and complete. A short example of a race condition would make it memorable."},
      {"questionIndex":1,"question":"How would you design a rate limiter for a public API?","answer":"A token bucket per API key, with counters in Redis updated by an atomic script, returning 429 with Retry-After when empty.","source":"transcript","score":72,"feedback":"Good core design. Discuss limits per plan and what happens if Redis is unavailable."},
      {"questionIndex":2,"question":"You need to change the type of a column on a table with 200 million rows without downtime. How do you approach it?","answer":"Add a new column, write to both, backfill in batches, move reads over, then remove the old column in a later release.","source":"transcript","score":73,"feedback":"The expand and contract pattern is the right answer. Add how you would check the data matches before switching."}
    ]$t$::jsonb,
    now() - interval '1 day 1 hour'
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'dadadada-dada-4dad-8dad-dadadadadada',
    'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0',
    77,
    array[
      'Concrete, practical examples',
      'Shows a habit of measuring before deciding',
      'Honest about a missed deadline'
    ],
    array[
      'Say how you checked your understanding with the team',
      'Describe the actions you took once the deadline was at risk',
      'Add the result in numbers where you can'
    ],
    'Clear, grounded answers with good judgement. They would be stronger with more detail on communication and on what you changed after the setback.',
    $t$[
      {"questionIndex":0,"question":"Walk me through how you would onboard onto an unfamiliar codebase.","answer":"Runs the project locally, reads the tests, follows one small change from entry point to database, and batches questions to teammates.","source":"transcript","score":78,"feedback":"Practical and well ordered. Mention how you confirm your understanding with the team."},
      {"questionIndex":1,"question":"Tell me about a disagreement with a teammate about a technical decision. How was it resolved?","answer":"Disagreed about adding a message queue; ran a one day spike with a database table, measured it, shipped the simple version and agreed to revisit at higher volume.","source":"transcript","score":82,"feedback":"Strong example with a measurable outcome. Describe the other person's concern more fairly."},
      {"questionIndex":2,"question":"Describe a project that missed its deadline. What happened and what would you do differently?","answer":"A reporting feature slipped two weeks because of a data migration estimate; now adds a risk list to every estimate.","source":"transcript","score":70,"feedback":"Honest, but say what you changed in the plan when you saw the slip and who you told."}
    ]$t$::jsonb,
    now() - interval '2 days 2 hours'
  ),
  (
    'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3',
    'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
    'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
    82,
    array['Clear story with a measurable result', 'Sound checks before trusting an A/B test'],
    array['Say what the team did with the finding', 'Name the tools you used for the analysis'],
    'Confident answers backed by numbers and a careful approach to testing.',
    $t$[
      {"questionIndex":0,"question":"Tell me about a time your analysis changed a decision. What did you find and what happened?","answer":"Found that trial users who finished the setup checklist early converted at three times the rate; moving it to the first screen raised conversion by about eight percent.","source":"transcript","score":84,"feedback":"Clear finding and a measurable result."},
      {"questionIndex":1,"question":"How would you check whether an A/B test result is trustworthy before reporting it?","answer":"Checks the sample ratio, full weeks of data, no early stopping, pre-set metric and sample size, and reports the confidence interval.","source":"transcript","score":80,"feedback":"Thorough. Add how you handle several metrics at once."}
    ]$t$::jsonb,
    now() - interval '4 days'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- AI usage: one row per model call, including a call whose output was
-- rejected and retried. All older than 24 hours, so they do not use up the
-- rolling daily quota of a fresh local database.
-- ---------------------------------------------------------------------------
insert into public.ai_usage (id, user_id, feature, model, prompt_tokens, completion_tokens, created_at) values
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d1', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'gemini-2.5-flash', 1180, 420, now() - interval '1 day 1 hour'),
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d2', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'gemini-2.5-flash', 1790, 380, now() - interval '2 days 2 hours 1 minute'),
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d3', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'gemini-2.5-flash', 1790, 510, now() - interval '2 days 2 hours'),
  ('e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'session-feedback', 'gemini-2.5-flash', 980, 330, now() - interval '4 days')
on conflict (id) do nothing;
-- BEGIN candidate roles (generated by `node scripts/gen-roles-seed.mjs` from lib/candidate/roles.json; do not edit by hand)
insert into public.roles
  (id, title, pay_rate, job_type, sort_order, skills, about, responsibilities, requirements)
values
  ('software-engineer', 'Software Engineer', '$10~$15/Hour', 'Contractor (~15 hrs a week)', 1,
   array['Python', 'Java', 'C++', 'TypeScript'], '',
   '[{"title":"Feature Development & Bug Fixing","text":"Write clean, readable code to implement new features, resolve reported bugs, and improve day-to-day system functionality."},{"title":"Code Maintenance & Refactoring","text":"Assist in refactoring older components to improve codebase organization, readability, and overall maintainability."},{"title":"Testing & Quality Assurance","text":"Write unit and integration tests, help maintain test suites, and assist in identifying and fixing flaky tests to ensure high software reliability."},{"title":"Backend API & Service Work","text":"Help build and maintain RESTful APIs and backend services using established engineering standards."},{"title":"Code Reviews & Collaboration","text":"Participate in team code reviews to give and receive constructive feedback, learn best practices, and improve technical documentation."}]'::jsonb,
   '[{"title":"Programming Foundations","text":"Working proficiency in at least one primary backend language (Python 3, Java, TypeScript/Node.js, C++, Go, or Rust)."},{"title":"Core CS Concepts","text":"Solid understanding of basic data structures, algorithms, and fundamental computer science principles."},{"title":"Software Maintenance","text":"Hands-on experience with basic bug fixing, code refactoring, and performance optimization techniques."},{"title":"Testing Mindset","text":"Familiarity with writing automated tests (unit/integration) and using version control tools like git."},{"title":"Problem-Solving & Communication","text":"Good analytical skills with the ability to communicate technical questions and solutions clearly in a remote team environment."}]'::jsonb),
  ('data-annotation-generalist', 'Generalist for Data Annotation', '$21~$35/Hour', 'Contractor (~15 hrs a week)', 2,
   array['Annotation', 'English'], '',
   '[{"title":"Data Annotation & Categorization","text":"Precisely label, tag, and categorize image datasets in strict accordance with detailed project guidelines and technical specifications."},{"title":"Quality Assurance & Validation","text":"Review and validate existing annotations to ensure accuracy, high quality, and formatting consistency across datasets; identify and correct discrepancies."},{"title":"Process Documentation & Rationale","text":"Document annotation methodologies, track workflows, and clearly articulate the reasoning behind specific labeling decisions."},{"title":"Stakeholder Collaboration","text":"Communicate effectively with project leads and team members to clarify ambiguous requirements, resolve edge-case questions, and provide feedback to improve annotation workflows."},{"title":"Workflow Adaptation","text":"Quickly learn, adapt to, and integrate updated annotation guidelines, new software tools, or evolving project standards."},{"title":"Deadline Management","text":"Independently prioritize tasks to meet defined project deliverables and quality benchmarks within established timelines."}]'::jsonb,
   '[{"title":"Annotation Experience","text":"Demonstrated experience in data annotation, with a specific emphasis on image-based datasets and annotation software tools."},{"title":"Detail Orientation","text":"Meticulous attention to detail with a strong commitment to maintaining high accuracy and consistency."},{"title":"Communication Skills","text":"Strong written and verbal English communication skills for clear asynchronous and remote team collaboration."},{"title":"Adaptability & Independence","text":"Proven ability to work independently on complex tasks, self-manage deadlines, and adapt quickly to shifting project goals."},{"title":"Domain Background (Bonus)","text":"Prior exposure to computer vision, data analysis, or machine learning model validation is a plus."}]'::jsonb),
  ('mechanical-engineering-expert', 'Mechanical Engineering Expert', '$60~$120/Hour', 'Contractor (~15 hrs a week)', 3,
   array['CAD', 'Mechanics'], '',
   '[{"title":"Engineering Problem-Solving","text":"Create, solve, and validate complex mechanical engineering problems across design, analysis, simulation, testing, and R&D domains."},{"title":"Computational Modeling","text":"Translate physical systems, governing equations, and engineering requirements into clean, reproducible analytical or computational models using Python."},{"title":"Simulation & Setup","text":"Build and modify geometry, meshes, material definitions, loads, contacts, constraints, and solver inputs across structural, thermal, and multiphysics setups."},{"title":"Artifact & Design Validation","text":"Run engineering simulations to determine whether resulting artifacts and numerical outputs satisfy relevant physical laws and design constraints."},{"title":"AI Workflow Integration","text":"Utilize coding agents and developer tools to streamline environment creation, code execution, and benchmark validation."}]'::jsonb,
   '[{"title":"Academic Background","text":"Master’s or Ph.D. in Mechanical Engineering or a closely related engineering discipline (or equivalent depth in applied mechanics and core engineering fundamentals)."},{"title":"Simulation & Modeling Experience","text":"Demonstrated experience developing analytical, computational, or simulation-based engineering solutions."},{"title":"Python & Coding Proficiency","text":"Strong Python skills with a heavy focus on engineering computation, script-based modeling, or simulation frameworks."},{"title":"Coding Agent Experience","text":"Practical, hands-on experience incorporating AI coding agents into your software and engineering workflow."}]'::jsonb),
  ('senior-software-engineer', 'Senior Software Engineer', '$80~$120/Hour', 'Contractor (~15 hrs a week)', 4,
   array['System design', 'TypeScript', 'Go'], '',
   '[{"title":"Create RL Environments","text":"Design and build reproducible Reinforcement Learning (RL) benchmark environments to evaluate AI models on complex, multi-step software engineering tasks."},{"title":"Develop Golden Reference Solutions","text":"Write verified, ideal solutions that serve as the ground truth for models to solve within each environment."},{"title":"Simulate Real-World Workflows","text":"Build scenarios reflecting real-world DevOps, CI/CD, and software debugging workflows using command-line tools like git, docker, gdb, asan, ffmpeg, and similar utilities."}]'::jsonb,
   '[{"title":"Programming Proficiency","text":"Fluency in at least one of the following languages: C++, Python, Java, Go, TypeScript, or Rust."},{"title":"Computer Science Foundations","text":"Deep understanding of algorithms, data structures, and performance tuning."},{"title":"Debugging & Maintenance","text":"Demonstrated experience diagnosing complex software bugs and delivering maintainable code."},{"title":"Software Architecture","text":"Strong background in end-to-end feature development and codebase refactoring."},{"title":"Optimization","text":"Proven ability to optimize software systems for performance and scalability."},{"title":"Communication & Remote Work","text":"Exceptional written and verbal communication skills with high attention to detail, alongside a track record of effective remote, cross-functional collaboration."}]'::jsonb),
  ('generalist', 'Generalist', '$30~$49/Hour', 'Contractor (~15 hrs a week)', 5,
   array['Writing', 'Research'], '',
   '[{"title":"Workflow Execution","text":"Execute complex, real-world digital workflows across online platforms, products, and services using assigned AI tools."},{"title":"Transaction Testing","text":"Perform online purchasing, payment, and cancellation workflows in strict accordance with project guidelines and reimbursement policies."},{"title":"AI Output Evaluation","text":"Identify errors, logical inconsistencies, edge-case failures, and areas for performance improvement within AI-generated outputs."},{"title":"Documentation & Feedback","text":"Provide clear, structured, and highly detailed feedback, backed by screenshots and observations, to enhance AI accuracy and usability."},{"title":"Independent Task Management","text":"Independently manage and complete multiple workflow assignments on schedule while maintaining high quality and data precision."}]'::jsonb,
   '[{"title":"Professional Background","text":"2+ years of professional work experience in business, technology, operations, or related fields."},{"title":"AI Tool Familiarity","text":"Hands-on experience using current AI tools and digital applications."},{"title":"Biometric Capability","text":"A laptop or mobile device equipped with working biometric authentication (fingerprint or facial recognition) to execute checkout tasks securely."},{"title":"Payment Task Comfort","text":"Willingness to perform standard purchasing and cancellation testing using approved reimbursement processes."},{"title":"Digital Literacy & Communication","text":"Exceptional written communication and documentation skills, with strong confidence navigating diverse web applications."},{"title":"Self-Management","text":"Proven ability to work independently, maintain good weekly availability, and hit project benchmarks."}]'::jsonb),
  ('semiconductor-engineering-expert', 'Semiconductor Engineering Expert', '$85~$185/Hour', 'Contractor (~15 hrs a week)', 6,
   array['VLSI', 'Physics'], '',
   '[{"title":"Problem Design","text":"Create highly challenging, domain-specific technical problems reflecting real-world complexities in device physics, process integration, circuit design, lithography, packaging, yield, or reliability, complete with realistic constraints and supporting data."},{"title":"Solution Architecture","text":"Provide rigorous, correct analytical solutions and walk through the underlying engineering reasoning step-by-step."},{"title":"Grading & Correctness Criteria","text":"Define objective, unambiguous evaluation criteria so that peer reviewers can independently verify and reach the same technical verdict."},{"title":"Peer Review","text":"Review technical problems authored by other domain experts to validate their soundness, accuracy, and grading clarity."},{"title":"Quality Control","text":"Identify, flag, and filter out ambiguous, ungradable, or flawed problems to maintain a pristine benchmark dataset."}]'::jsonb,
   '[{"title":"Advanced Degree","text":"Master’s or Ph.D. in Electrical Engineering, Materials Science, Applied Physics, or a closely related field."},{"title":"Industry or Academic Seniority","text":"Principal, staff, or fellow-level experience at a major semiconductor company, OR an active or recent faculty appointment at a leading university."},{"title":"Domain Depth","text":"Deep technical expertise in at least one core semiconductor subdomain with a documented record of hands-on project ownership."},{"title":"Communication & Rigor","text":"Exceptional ability to articulate complex physical and engineering reasoning clearly enough for peer verification."},{"title":"Preferred Experience","text":"Strong publication history, patents, or a proven track record of technical leadership; prior AI/ML or LLM evaluation experience is a plus."}]'::jsonb)
on conflict (id) do update set
  title            = excluded.title,
  pay_rate         = excluded.pay_rate,
  job_type         = excluded.job_type,
  sort_order       = excluded.sort_order,
  skills           = excluded.skills,
  about            = excluded.about,
  responsibilities = excluded.responsibilities,
  requirements     = excluded.requirements,
  updated_at       = now();
-- END candidate roles
