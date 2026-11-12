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

import roles from "./roles.json";

export interface Role {
  id: string;
  title: string;
  payRate: string;
  jobType?: string;
  skills: string[];
  about?: string;
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

/** Roles from the company job descriptions. Same rows as supabase/seed.sql (public.roles), kept in sync by tests. */
export const FIXTURE_ROLES: Role[] = roles;

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
