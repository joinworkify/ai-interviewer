/**
 * Candidate interview API, fixture version.
 *
 * Function names mirror the REST calls in the "Datasea AI interviewer"
 * diagram (TRH owns the real API). Swap each body for a fetch() to the real
 * endpoint; the screens only depend on these signatures.
 *
 * shortcut: in-memory fixtures and sessionStorage login, replace with TRH's
 * REST API once it exists.
 */

export interface Role {
  id: string;
  title: string;
  payRate: string;
  jobType: string;
  skills: string[];
  about: string;
  responsibilities: { title: string; text: string }[];
  requirements: { title: string; text: string }[];
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const SE_RESPONSIBILITIES = [
  { title: "Feature Development & Bug Fixing", text: "Write clean, readable code to implement new features, resolve reported bugs, and improve day-to-day system functionality." },
  { title: "Code Maintenance & Refactoring", text: "Assist in refactoring older components to improve codebase organization, readability, and overall maintainability." },
  { title: "Testing & Quality Assurance", text: "Write unit and integration tests, help maintain test suites, and assist in identifying and fixing flaky tests." },
  { title: "Backend API & Service Work", text: "Help build and maintain RESTful APIs and backend services using established engineering standards." },
  { title: "Code Reviews & Collaboration", text: "Participate in team code reviews to give and receive constructive feedback and improve technical documentation." },
];

const SE_REQUIREMENTS = [
  { title: "Programming Foundations", text: "Working proficiency in at least one primary backend language (Python 3, Java, TypeScript/Node.js, C++, Go, or Rust)." },
  { title: "Core CS Concepts", text: "Solid understanding of basic data structures, algorithms, and fundamental computer science principles." },
  { title: "Software Maintenance", text: "Hands-on experience with basic bug fixing, code refactoring, and performance optimization techniques." },
  { title: "Testing Mindset", text: "Familiarity with writing automated tests (unit/integration) and using version control tools like git." },
  { title: "Problem-Solving & Communication", text: "Good analytical skills with the ability to communicate technical questions and solutions clearly in a remote team." },
];

function role(id: string, title: string, payRate: string, skills: string[]): Role {
  return {
    id,
    title,
    payRate,
    jobType: "Contractor (~15 hrs a week)",
    skills,
    about: `Placeholder description for the ${title} role. Final text comes from the role owner.`,
    responsibilities: SE_RESPONSIBILITIES,
    requirements: SE_REQUIREMENTS,
  };
}

/** Fixture roles from the wireframe. Same rows as supabase/seed.sql (public.roles), kept in sync by tests. */
export const FIXTURE_ROLES: Role[] = [
  role("software-engineer", "Software Engineer", "$10~$15/Hour", ["Python", "Java", "C++", "TypeScript"]),
  role("data-annotation-generalist", "Generalist for Data Annotation", "$21~$35/Hour", ["Annotation", "English"]),
  role("mechanical-engineering-expert", "Mechanical Engineering Expert", "$60~$120/Hour", ["CAD", "Mechanics"]),
  role("senior-software-engineer", "Senior Software Engineer", "$80~$120/Hour", ["System design", "TypeScript", "Go"]),
  role("generalist", "Generalist", "$30~$49/Hour", ["Writing", "Research"]),
  role("semiconductor-engineering-expert", "Semiconductor Engineering Expert", "$85~$185/Hour", ["VLSI", "Physics"]),
];

/** Invited test identities (diagram: only invited test emails can sign in). */
const INVITED = new Set(["cand_test_01@datasea.test", "cand_test_02@datasea.test"]);

const SESSION_KEY = "candidate.session";

function delay(ms = 300) {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST /auth/login (fixture). Any non-empty password works for an invited email. */
export async function login(email: string, password: string): Promise<{ candidateId: string }> {
  await delay();
  const normalized = email.trim().toLowerCase();
  if (!INVITED.has(normalized) || password.length === 0) {
    throw new ApiError("AUTH_INVALID", "Error: wrong email or password");
  }
  const candidateId = normalized.split("@")[0];
  try {
    sessionStorage.setItem(SESSION_KEY, candidateId);
  } catch {
    // Storage blocked: the flow still works for this page view.
  }
  return { candidateId };
}

/** GET /me (fixture). */
export function currentCandidateId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function logout() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

/** GET /roles (fixture). */
export async function getRoles(): Promise<Role[]> {
  await delay();
  return FIXTURE_ROLES;
}

/** GET /roles/:id (fixture). */
export async function getRole(id: string): Promise<Role> {
  await delay();
  const found = FIXTURE_ROLES.find((r) => r.id === id);
  if (!found) throw new ApiError("NOT_FOUND", "This role is no longer available.");
  return found;
}

/** Basic shape check (something@domain.tld); the server does the real validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Case-insensitive title/skill search for the role list. */
export function filterRoles(roles: Role[], query: string): Role[] {
  const q = query.trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(
    (r) => r.title.toLowerCase().includes(q) || r.skills.some((s) => s.toLowerCase().includes(q)),
  );
}
