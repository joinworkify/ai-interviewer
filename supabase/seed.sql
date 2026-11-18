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
-- Admin (opens /admin): admin@example.test / test123!
--
-- All data is fake. Safe to run more than once: fixed ids and
-- "on conflict do nothing". The three users are the exception: they are
-- upserted, so running the seed again also resets their password and
-- app_metadata (the admin's role included). Every insert lists its
-- columns, so a column added later (nullable or with a default) does not break
-- this file. When a migration renames or drops a column, or adds a NOT NULL
-- column without a default, tests/db/seed.test.ts fails; update the matching
-- insert here.
--
-- Two rows per table for the two candidate users (the roles catalogue
-- excepted: it seeds the available job roles). The admin has no
-- interviews, so it only adds an auth user and a profile. Each candidate has
-- one interview with a completed Gemini Live session, its feedback and one AI
-- usage row, so the dev user can be checked against the other user's rows.
--
-- Ids use a d0..dd prefix for the dev user, e0..e4 for the second user and an
-- f0 prefix for the admin, so they never collide with the fixed ids in
-- tests/helpers/psql.ts.

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
  ),
  (
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@example.test',
    crypt('test123!', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"],"role":"admin"}',
    '{"name":"DataSea Admin"}',
    now(), now(),
    '', '', '', '', ''
  )
on conflict (id) do update set
  encrypted_password = excluded.encrypted_password,
  raw_user_meta_data = excluded.raw_user_meta_data,
  raw_app_meta_data  = excluded.raw_app_meta_data,
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
  ),
  (
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
    'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
    '{"sub":"f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0","email":"admin@example.test","email_verified":true}',
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
-- One completed Gemini Live session per user. Gemini Live sessions use the
-- stored canonical shape ({role, text}), plus transcript_source,
-- duration_seconds and ended_reason.
-- ---------------------------------------------------------------------------
insert into public.interview_sessions (
  id, interview_id, user_id, status, vapi_call_id, started_at, ended_at,
  transcript, recording_url, transcript_source, duration_seconds, ended_reason
) values
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
  )on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Feedback. Sources are "transcript": each answer is a short summary of what
-- the candidate said, as the evaluator writes it.
-- ---------------------------------------------------------------------------
insert into public.feedback (
  id, session_id, user_id, total_score, strengths, areas_for_improvement,
  final_assessment, per_answer, created_at
) values
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
-- AI usage: one row per model call. All older than 24 hours, so they do not use up the
-- rolling daily quota of a fresh local database.
-- ---------------------------------------------------------------------------
insert into public.ai_usage (id, user_id, feature, model, prompt_tokens, completion_tokens, created_at) values
  ('d8d8d8d8-d8d8-4d8d-8d8d-d8d8d8d8d8d3', 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'session-feedback', 'gemini-2.5-flash', 1790, 510, now() - interval '2 days 2 hours'),
  ('e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0', 'session-feedback', 'gemini-2.5-flash', 980, 330, now() - interval '4 days')
on conflict (id) do nothing;
-- BEGIN candidate roles
insert into public.roles
  (id, title, pay_min, pay_max, pay_type, job_type, sort_order, skills, about, responsibilities, requirements)
values
  ('software-engineer', 'Software Engineer', 10, 15, 'hour', 'Contractor (~15 hrs a week)', 1,
   array['Python', 'Java', 'C++', 'TypeScript'], '',
   '[{"title":"Feature Development & Bug Fixing","text":"Write clean, readable code to implement new features, resolve reported bugs, and improve day-to-day system functionality."},{"title":"Code Maintenance & Refactoring","text":"Assist in refactoring older components to improve codebase organization, readability, and overall maintainability."},{"title":"Testing & Quality Assurance","text":"Write unit and integration tests, help maintain test suites, and assist in identifying and fixing flaky tests to ensure high software reliability."},{"title":"Backend API & Service Work","text":"Help build and maintain RESTful APIs and backend services using established engineering standards."},{"title":"Code Reviews & Collaboration","text":"Participate in team code reviews to give and receive constructive feedback, learn best practices, and improve technical documentation."}]'::jsonb,
   '[{"title":"Programming Foundations","text":"Working proficiency in at least one primary backend language (Python 3, Java, TypeScript/Node.js, C++, Go, or Rust)."},{"title":"Core CS Concepts","text":"Solid understanding of basic data structures, algorithms, and fundamental computer science principles."},{"title":"Software Maintenance","text":"Hands-on experience with basic bug fixing, code refactoring, and performance optimization techniques."},{"title":"Testing Mindset","text":"Familiarity with writing automated tests (unit/integration) and using version control tools like git."},{"title":"Problem-Solving & Communication","text":"Good analytical skills with the ability to communicate technical questions and solutions clearly in a remote team environment."}]'::jsonb),
  ('data-annotation-generalist', 'Generalist for Data Annotation', 21, 35, 'hour', 'Contractor (~15 hrs a week)', 2,
   array['Annotation', 'English'], '',
   '[{"title":"Data Annotation & Categorization","text":"Precisely label, tag, and categorize image datasets in strict accordance with detailed project guidelines and technical specifications."},{"title":"Quality Assurance & Validation","text":"Review and validate existing annotations to ensure accuracy, high quality, and formatting consistency across datasets; identify and correct discrepancies."},{"title":"Process Documentation & Rationale","text":"Document annotation methodologies, track workflows, and clearly articulate the reasoning behind specific labeling decisions."},{"title":"Stakeholder Collaboration","text":"Communicate effectively with project leads and team members to clarify ambiguous requirements, resolve edge-case questions, and provide feedback to improve annotation workflows."},{"title":"Workflow Adaptation","text":"Quickly learn, adapt to, and integrate updated annotation guidelines, new software tools, or evolving project standards."},{"title":"Deadline Management","text":"Independently prioritize tasks to meet defined project deliverables and quality benchmarks within established timelines."}]'::jsonb,
   '[{"title":"Annotation Experience","text":"Demonstrated experience in data annotation, with a specific emphasis on image-based datasets and annotation software tools."},{"title":"Detail Orientation","text":"Meticulous attention to detail with a strong commitment to maintaining high accuracy and consistency."},{"title":"Communication Skills","text":"Strong written and verbal English communication skills for clear asynchronous and remote team collaboration."},{"title":"Adaptability & Independence","text":"Proven ability to work independently on complex tasks, self-manage deadlines, and adapt quickly to shifting project goals."},{"title":"Domain Background (Bonus)","text":"Prior exposure to computer vision, data analysis, or machine learning model validation is a plus."}]'::jsonb),
  ('mechanical-engineering-expert', 'Mechanical Engineering Expert', 60, 120, 'hour', 'Contractor (~15 hrs a week)', 3,
   array['CAD', 'Mechanics'], '',
   '[{"title":"Engineering Problem-Solving","text":"Create, solve, and validate complex mechanical engineering problems across design, analysis, simulation, testing, and R&D domains."},{"title":"Computational Modeling","text":"Translate physical systems, governing equations, and engineering requirements into clean, reproducible analytical or computational models using Python."},{"title":"Simulation & Setup","text":"Build and modify geometry, meshes, material definitions, loads, contacts, constraints, and solver inputs across structural, thermal, and multiphysics setups."},{"title":"Artifact & Design Validation","text":"Run engineering simulations to determine whether resulting artifacts and numerical outputs satisfy relevant physical laws and design constraints."},{"title":"AI Workflow Integration","text":"Utilize coding agents and developer tools to streamline environment creation, code execution, and benchmark validation."}]'::jsonb,
   '[{"title":"Academic Background","text":"Master’s or Ph.D. in Mechanical Engineering or a closely related engineering discipline (or equivalent depth in applied mechanics and core engineering fundamentals)."},{"title":"Simulation & Modeling Experience","text":"Demonstrated experience developing analytical, computational, or simulation-based engineering solutions."},{"title":"Python & Coding Proficiency","text":"Strong Python skills with a heavy focus on engineering computation, script-based modeling, or simulation frameworks."},{"title":"Coding Agent Experience","text":"Practical, hands-on experience incorporating AI coding agents into your software and engineering workflow."}]'::jsonb),
  ('senior-software-engineer', 'Senior Software Engineer', 80, 120, 'hour', 'Contractor (~15 hrs a week)', 4,
   array['System design', 'TypeScript', 'Go'], '',
   '[{"title":"Create RL Environments","text":"Design and build reproducible Reinforcement Learning (RL) benchmark environments to evaluate AI models on complex, multi-step software engineering tasks."},{"title":"Develop Golden Reference Solutions","text":"Write verified, ideal solutions that serve as the ground truth for models to solve within each environment."},{"title":"Simulate Real-World Workflows","text":"Build scenarios reflecting real-world DevOps, CI/CD, and software debugging workflows using command-line tools like git, docker, gdb, asan, ffmpeg, and similar utilities."}]'::jsonb,
   '[{"title":"Programming Proficiency","text":"Fluency in at least one of the following languages: C++, Python, Java, Go, TypeScript, or Rust."},{"title":"Computer Science Foundations","text":"Deep understanding of algorithms, data structures, and performance tuning."},{"title":"Debugging & Maintenance","text":"Demonstrated experience diagnosing complex software bugs and delivering maintainable code."},{"title":"Software Architecture","text":"Strong background in end-to-end feature development and codebase refactoring."},{"title":"Optimization","text":"Proven ability to optimize software systems for performance and scalability."},{"title":"Communication & Remote Work","text":"Exceptional written and verbal communication skills with high attention to detail, alongside a track record of effective remote, cross-functional collaboration."}]'::jsonb),
  ('generalist', 'Generalist', 30, 49, 'hour', 'Contractor (~15 hrs a week)', 5,
   array['Writing', 'Research'], '',
   '[{"title":"Workflow Execution","text":"Execute complex, real-world digital workflows across online platforms, products, and services using assigned AI tools."},{"title":"Transaction Testing","text":"Perform online purchasing, payment, and cancellation workflows in strict accordance with project guidelines and reimbursement policies."},{"title":"AI Output Evaluation","text":"Identify errors, logical inconsistencies, edge-case failures, and areas for performance improvement within AI-generated outputs."},{"title":"Documentation & Feedback","text":"Provide clear, structured, and highly detailed feedback, backed by screenshots and observations, to enhance AI accuracy and usability."},{"title":"Independent Task Management","text":"Independently manage and complete multiple workflow assignments on schedule while maintaining high quality and data precision."}]'::jsonb,
   '[{"title":"Professional Background","text":"2+ years of professional work experience in business, technology, operations, or related fields."},{"title":"AI Tool Familiarity","text":"Hands-on experience using current AI tools and digital applications."},{"title":"Biometric Capability","text":"A laptop or mobile device equipped with working biometric authentication (fingerprint or facial recognition) to execute checkout tasks securely."},{"title":"Payment Task Comfort","text":"Willingness to perform standard purchasing and cancellation testing using approved reimbursement processes."},{"title":"Digital Literacy & Communication","text":"Exceptional written communication and documentation skills, with strong confidence navigating diverse web applications."},{"title":"Self-Management","text":"Proven ability to work independently, maintain good weekly availability, and hit project benchmarks."}]'::jsonb),
  ('semiconductor-engineering-expert', 'Semiconductor Engineering Expert', 85, 185, 'hour', 'Contractor (~15 hrs a week)', 6,
   array['VLSI', 'Physics'], '',
   '[{"title":"Problem Design","text":"Create highly challenging, domain-specific technical problems reflecting real-world complexities in device physics, process integration, circuit design, lithography, packaging, yield, or reliability, complete with realistic constraints and supporting data."},{"title":"Solution Architecture","text":"Provide rigorous, correct analytical solutions and walk through the underlying engineering reasoning step-by-step."},{"title":"Grading & Correctness Criteria","text":"Define objective, unambiguous evaluation criteria so that peer reviewers can independently verify and reach the same technical verdict."},{"title":"Peer Review","text":"Review technical problems authored by other domain experts to validate their soundness, accuracy, and grading clarity."},{"title":"Quality Control","text":"Identify, flag, and filter out ambiguous, ungradable, or flawed problems to maintain a pristine benchmark dataset."}]'::jsonb,
   '[{"title":"Advanced Degree","text":"Master’s or Ph.D. in Electrical Engineering, Materials Science, Applied Physics, or a closely related field."},{"title":"Industry or Academic Seniority","text":"Principal, staff, or fellow-level experience at a major semiconductor company, OR an active or recent faculty appointment at a leading university."},{"title":"Domain Depth","text":"Deep technical expertise in at least one core semiconductor subdomain with a documented record of hands-on project ownership."},{"title":"Communication & Rigor","text":"Exceptional ability to articulate complex physical and engineering reasoning clearly enough for peer verification."},{"title":"Preferred Experience","text":"Strong publication history, patents, or a proven track record of technical leadership; prior AI/ML or LLM evaluation experience is a plus."}]'::jsonb),
  ('data-engineer', 'Data Engineer', 45, 75, 'hour', 'Contractor (~20 hrs a week)', 7,
   array['SQL', 'Python', 'Spark', 'Airflow'], 'Build and maintain the pipelines that turn raw data into reliable datasets for AI evaluation and analytics.',
   '[{"title":"Pipeline Development","text":"Design, build and maintain batch and streaming data pipelines using SQL, Python, Spark and Airflow."},{"title":"Data Quality","text":"Add validation, monitoring and alerting so downstream datasets stay complete and accurate."},{"title":"Warehouse Modeling","text":"Model curated tables and views that analysts and ML teams can query without rewriting logic."},{"title":"Collaboration","text":"Work with data scientists and product teams to turn new data sources into documented, reusable assets."}]'::jsonb,
   '[{"title":"SQL Proficiency","text":"Strong SQL, including joins, window functions and query performance tuning."},{"title":"Python Engineering","text":"Production Python experience for ETL jobs, testing and automation."},{"title":"Orchestration","text":"Hands-on experience with Airflow or a comparable workflow orchestrator."},{"title":"Data Modeling","text":"Practical knowledge of dimensional modeling, partitioning and schema evolution."}]'::jsonb),
  ('frontend-engineer', 'Frontend Engineer', 40, 70, 'hour', 'Contractor (~15 hrs a week)', 8,
   array['React', 'TypeScript', 'CSS', 'Accessibility'], 'Build accessible, fast interfaces for the products candidates and reviewers use every day.',
   '[{"title":"UI Development","text":"Build responsive interfaces with React and TypeScript from design specs and product requirements."},{"title":"Accessibility","text":"Implement keyboard, focus, contrast and screen-reader behavior that meets WCAG expectations."},{"title":"Performance","text":"Keep bundles small and pages fast by measuring and fixing rendering and loading bottlenecks."},{"title":"Testing","text":"Write component and end-to-end tests for the flows you own."}]'::jsonb,
   '[{"title":"React & TypeScript","text":"Production experience building and maintaining React applications in TypeScript."},{"title":"CSS Fundamentals","text":"Strong CSS layout skills, including responsive design and modern component styling."},{"title":"Accessibility","text":"Familiarity with semantic HTML, ARIA and keyboard-only testing."},{"title":"Quality Mindset","text":"Experience with automated testing and thoughtful code review."}]'::jsonb),
  ('devops-engineer', 'DevOps Engineer', 55, 90, 'hour', 'Contractor (~20 hrs a week)', 9,
   array['Kubernetes', 'Terraform', 'AWS', 'CI/CD'], 'Own the infrastructure and delivery pipeline behind our AI evaluation platform.',
   '[{"title":"Infrastructure as Code","text":"Define and maintain cloud infrastructure with Terraform and reviewable changes."},{"title":"Deployment","text":"Operate CI/CD pipelines that build, test and release services safely."},{"title":"Reliability","text":"Add monitoring, alerting and runbooks so incidents are detected and resolved quickly."},{"title":"Security","text":"Apply least-privilege access, secret management and network controls across environments."}]'::jsonb,
   '[{"title":"Cloud Experience","text":"Hands-on AWS experience across compute, networking, storage and IAM."},{"title":"Kubernetes","text":"Operational experience deploying and debugging workloads on Kubernetes."},{"title":"Terraform","text":"Experience managing production infrastructure as code."},{"title":"Incident Response","text":"A calm, methodical approach to production incidents and postmortems."}]'::jsonb),
  ('machine-learning-engineer', 'Machine Learning Engineer', 70, 110, 'hour', 'Contractor (~20 hrs a week)', 10,
   array['PyTorch', 'Python', 'LLMs', 'MLOps'], 'Prototype and productionize models that evaluate interviews and improve reviewer workflows.',
   '[{"title":"Model Development","text":"Build, fine-tune and evaluate machine learning models with PyTorch and modern LLM APIs."},{"title":"Experimentation","text":"Design reproducible experiments and report results with clear baselines."},{"title":"Deployment","text":"Package models and inference services so they run reliably in production."},{"title":"Evaluation","text":"Create datasets and metrics that measure correctness, safety and regressions."}]'::jsonb,
   '[{"title":"ML Foundations","text":"Solid understanding of supervised learning, evaluation metrics and model failure modes."},{"title":"Python & PyTorch","text":"Production Python skills and hands-on PyTorch experience."},{"title":"LLM Experience","text":"Practical experience with prompting, fine-tuning or retrieval-augmented systems."},{"title":"Production Mindset","text":"Ability to ship models with monitoring, versioning and rollback plans."}]'::jsonb),
  ('product-designer', 'Product Designer', 35, 60, 'hour', 'Contractor (~15 hrs a week)', 11,
   array['Figma', 'UX Research', 'Prototyping'], 'Shape clear, humane interview experiences from first sketch to shipped interface.',
   '[{"title":"Product Discovery","text":"Turn ambiguous problems into flows, wireframes and testable prototypes."},{"title":"Interaction Design","text":"Design accessible interfaces with clear states, feedback and error handling."},{"title":"Research","text":"Run lightweight interviews and usability tests, then translate findings into decisions."},{"title":"Design Systems","text":"Contribute reusable patterns and components to the shared design system."}]'::jsonb,
   '[{"title":"Portfolio","text":"A portfolio showing end-to-end product design work and the reasoning behind it."},{"title":"Figma","text":"Strong Figma skills for wireframes, prototypes and developer handoff."},{"title":"UX Research","text":"Experience planning and running qualitative research sessions."},{"title":"Collaboration","text":"Comfort working closely with engineers and product managers."}]'::jsonb),
  ('technical-writer', 'Technical Writer', 25, 45, 'hour', 'Contractor (~10 hrs a week)', 12,
   array['Documentation', 'Editing', 'Markdown'], 'Write the guides and reference material that help teams use our platform with confidence.',
   '[{"title":"Documentation","text":"Write and maintain setup guides, API references and troubleshooting articles."},{"title":"Editing","text":"Improve structure, clarity and consistency across existing documentation."},{"title":"Information Architecture","text":"Organize content so readers can find the right answer quickly."},{"title":"Release Notes","text":"Turn product changes into accurate, readable release notes."}]'::jsonb,
   '[{"title":"Writing Samples","text":"Published technical writing samples that show clear structure and accurate detail."},{"title":"Tooling","text":"Comfort with Markdown, version control and docs-as-code workflows."},{"title":"Technical Aptitude","text":"Ability to read code and test the steps you document."},{"title":"Collaboration","text":"Experience working with engineers and product managers under deadlines."}]'::jsonb),
  ('customer-support-specialist', 'Customer Support Specialist', 15, 22, 'hour', 'Contractor (~25 hrs a week)', 13,
   array['Communication', 'Zendesk', 'Troubleshooting'], 'Help candidates and reviewers resolve issues quickly and kindly.',
   '[{"title":"Ticket Handling","text":"Respond to support requests within service targets and keep records accurate."},{"title":"Troubleshooting","text":"Reproduce issues, gather evidence and route bugs to the right team."},{"title":"Knowledge Base","text":"Turn recurring questions into help-center articles and macros."},{"title":"Escalation","text":"Flag sensitive or urgent cases and follow the escalation process."}]'::jsonb,
   '[{"title":"Written Communication","text":"Clear, patient English writing across email and chat."},{"title":"Support Tools","text":"Experience with a ticketing system such as Zendesk or a similar product."},{"title":"Technical Comfort","text":"Confidence troubleshooting browsers, accounts and basic integrations."},{"title":"Reliability","text":"Consistent availability for scheduled shifts and handoffs."}]'::jsonb),
  ('financial-analyst', 'Financial Analyst', 30, 55, 'hour', 'Contractor (~15 hrs a week)', 14,
   array['Excel', 'Financial Modeling', 'SQL'], 'Build the models and reports that keep hiring and delivery decisions grounded in numbers.',
   '[{"title":"Modeling","text":"Build and maintain forecasts, unit economics and scenario models."},{"title":"Reporting","text":"Prepare clear monthly reports and explain variances to non-finance readers."},{"title":"Data Analysis","text":"Query operational data with SQL and reconcile it against finance systems."},{"title":"Process Improvement","text":"Simplify recurring analyses and document assumptions."}]'::jsonb,
   '[{"title":"Financial Modeling","text":"Strong spreadsheet modeling with clean, auditable structure."},{"title":"SQL","text":"Ability to write joins and aggregations against production data."},{"title":"Analytical Rigor","text":"Comfort checking assumptions and explaining uncertainty."},{"title":"Communication","text":"Ability to present findings clearly in writing and conversation."}]'::jsonb),
  ('biology-expert', 'Biology Expert', 50, 95, 'hour', 'Contractor (~15 hrs a week)', 15,
   array['Molecular Biology', 'Genetics', 'Lab Methods'], 'Author and review graduate-level biology problems for AI benchmark datasets.',
   '[{"title":"Problem Design","text":"Write challenging problems grounded in real experimental scenarios."},{"title":"Solution Review","text":"Provide rigorous solutions and explain the underlying reasoning."},{"title":"Grading Criteria","text":"Define unambiguous criteria that peer reviewers can apply consistently."},{"title":"Quality Control","text":"Flag ambiguous or flawed problems before they enter the dataset."}]'::jsonb,
   '[{"title":"Advanced Degree","text":"Master''s or Ph.D. in Biology, Genetics or a closely related field."},{"title":"Research Depth","text":"Hands-on research experience in molecular or cellular biology."},{"title":"Scientific Writing","text":"Clear, precise technical writing with careful citation."},{"title":"Peer Review","text":"Experience reviewing scientific work or evaluating student answers."}]'::jsonb),
  ('legal-research-expert', 'Legal Research Expert', 60, 120, 'hour', 'Contractor (~10 hrs a week)', 16,
   array['Legal Research', 'Writing', 'Citation'], 'Create and review legal research tasks that test careful reasoning and source accuracy.',
   '[{"title":"Research Tasks","text":"Design realistic legal research questions with verifiable answers."},{"title":"Source Checking","text":"Verify statutes, cases and citations against authoritative sources."},{"title":"Rubrics","text":"Write grading rubrics that separate sound reasoning from unsupported claims."},{"title":"Review","text":"Evaluate submissions for accuracy, relevance and citation quality."}]'::jsonb,
   '[{"title":"Legal Training","text":"JD, LLB or equivalent legal education and research experience."},{"title":"Research Tools","text":"Proficiency with legal databases and primary-source research."},{"title":"Writing","text":"Precise analytical writing with clean citation practice."},{"title":"Attention to Detail","text":"Careful checking of jurisdiction, dates and subsequent history."}]'::jsonb)
on conflict (id) do update set
  title            = excluded.title,
  pay_min          = excluded.pay_min,
  pay_max          = excluded.pay_max,
  pay_type         = excluded.pay_type,
  job_type         = excluded.job_type,
  sort_order       = excluded.sort_order,
  skills           = excluded.skills,
  about            = excluded.about,
  responsibilities = excluded.responsibilities,
  requirements     = excluded.requirements,
  updated_at       = now();
-- END candidate roles
