-- Local seed data, loaded by `npm run db:reset` (and `npm run db:seed`).
-- Mirrors FIXTURE_ROLES in lib/candidate/api.ts; tests/candidate-roles-migration.test.ts
-- checks the role ids stay in sync. Safe to re-run: existing rows are updated.

with shared (responsibilities, requirements) as (
  select
    '[
      {"title": "Feature Development & Bug Fixing", "text": "Write clean, readable code to implement new features, resolve reported bugs, and improve day-to-day system functionality."},
      {"title": "Code Maintenance & Refactoring", "text": "Assist in refactoring older components to improve codebase organization, readability, and overall maintainability."},
      {"title": "Testing & Quality Assurance", "text": "Write unit and integration tests, help maintain test suites, and assist in identifying and fixing flaky tests."},
      {"title": "Backend API & Service Work", "text": "Help build and maintain RESTful APIs and backend services using established engineering standards."},
      {"title": "Code Reviews & Collaboration", "text": "Participate in team code reviews to give and receive constructive feedback and improve technical documentation."}
    ]'::jsonb,
    '[
      {"title": "Programming Foundations", "text": "Working proficiency in at least one primary backend language (Python 3, Java, TypeScript/Node.js, C++, Go, or Rust)."},
      {"title": "Core CS Concepts", "text": "Solid understanding of basic data structures, algorithms, and fundamental computer science principles."},
      {"title": "Software Maintenance", "text": "Hands-on experience with basic bug fixing, code refactoring, and performance optimization techniques."},
      {"title": "Testing Mindset", "text": "Familiarity with writing automated tests (unit/integration) and using version control tools like git."},
      {"title": "Problem-Solving & Communication", "text": "Good analytical skills with the ability to communicate technical questions and solutions clearly in a remote team."}
    ]'::jsonb
)
insert into public.roles
  (id, title, pay_rate, job_type, skills, about, responsibilities, requirements)
select
  v.id,
  v.title,
  v.pay_rate,
  'Contractor (~15 hrs a week)',
  v.skills,
  'Placeholder description for the ' || v.title || ' role. Final text comes from the role owner.',
  shared.responsibilities,
  shared.requirements
from shared,
  (values
    ('software-engineer',                'Software Engineer',                '$10~$15/Hour',  array['Python', 'Java', 'C++', 'TypeScript']),
    ('data-annotation-generalist',       'Generalist for Data Annotation',   '$21~$35/Hour',  array['Annotation', 'English']),
    ('mechanical-engineering-expert',    'Mechanical Engineering Expert',    '$60~$120/Hour', array['CAD', 'Mechanics']),
    ('senior-software-engineer',         'Senior Software Engineer',         '$80~$120/Hour', array['System design', 'TypeScript', 'Go']),
    ('generalist',                       'Generalist',                       '$30~$49/Hour',  array['Writing', 'Research']),
    ('semiconductor-engineering-expert', 'Semiconductor Engineering Expert', '$85~$185/Hour', array['VLSI', 'Physics'])
  ) as v (id, title, pay_rate, skills)
on conflict (id) do update set
  title            = excluded.title,
  pay_rate         = excluded.pay_rate,
  job_type         = excluded.job_type,
  skills           = excluded.skills,
  about            = excluded.about,
  responsibilities = excluded.responsibilities,
  requirements     = excluded.requirements,
  updated_at       = now();
