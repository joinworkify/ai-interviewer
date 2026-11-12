/**
 * Candidate interview data.
 *
 * Roles are read from Supabase (public.roles, readable when active).
 * Function names mirror the REST calls in the "Datasea AI interviewer"
 * diagram, so TRH's API can replace the bodies without changing the screens.
 *
 * shortcut: instructions, consent/attempt and result are still fixtures;
 * replace them with TRH's REST API once it exists.
 */

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type RoleRow = Database["public"]["Tables"]["roles"]["Row"];
type Bullet = { title: string; text: string };

export interface Role {
  id: string;
  title: string;
  payRate: string;
  jobType?: string;
  skills: string[];
  about?: string;
  responsibilities: Bullet[];
  requirements: Bullet[];
}

export type AttemptStatus =
  | "created"
  | "in_progress"
  | "interrupted"
  | "incomplete"
  | "submitted"
  | "under_review"
  | "reviewed";

export interface AttemptResult {
  attemptId: string;
  status: AttemptStatus;
  /** Shown as-is. Never a score, pass/fail, accent, emotion or personality. */
  summary: string;
  nextAttemptOn?: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const ROLE_COLUMNS = "id, title, pay_rate, job_type, skills, about, responsibilities, requirements";

/** Maps a public.roles row to the shape the screens use. */
export function roleFromRow(
  row: Pick<RoleRow, "id" | "title" | "pay_rate" | "job_type" | "skills" | "about" | "responsibilities" | "requirements">,
): Role {
  const bullets = (v: unknown): Bullet[] => (Array.isArray(v) ? (v as Bullet[]) : []);
  return {
    id: row.id,
    title: row.title,
    payRate: row.pay_rate,
    jobType: row.job_type || undefined,
    skills: row.skills ?? [],
    about: row.about || undefined,
    responsibilities: bullets(row.responsibilities),
    requirements: bullets(row.requirements),
  };
}

/** GET /roles: active roles, in display order. */
export async function getRoles(): Promise<Role[]> {
  const { data, error } = await createClient()
    .from("roles")
    .select(ROLE_COLUMNS)
    .order("sort_order", { ascending: true })
    .order("title", { ascending: true });
  if (error) throw new ApiError("ROLES_FAILED", "Roles failed to load.");
  return data.map(roleFromRow);
}

/** GET /roles/:id */
export async function getRole(id: string): Promise<Role> {
  const { data, error } = await createClient().from("roles").select(ROLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new ApiError("ROLES_FAILED", "This role failed to load.");
  if (!data) throw new ApiError("NOT_FOUND", "This role is no longer available.");
  return roleFromRow(data);
}

/** Case-insensitive title/skill search for the role list. */
export function filterRoles(roles: Role[], query: string): Role[] {
  const q = query.trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(
    (r) => r.title.toLowerCase().includes(q) || r.skills.some((s) => s.toLowerCase().includes(q)),
  );
}

/** Basic shape check (something@domain.tld); the server does the real validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** GET /roles/:id/instructions (fixture). PSK owns the reviewed text. */
export async function getInstructions(roleId: string): Promise<string> {
  const role = await getRole(roleId);
  return (
    `You are about to start an AI voice interview for the ${role.title} role. ` +
    "Find a quiet place and use a laptop with a working microphone. The AI interviewer asks one question at a time; " +
    "answer out loud. Your answers are recorded and reviewed by a person at DataSea. " +
    "(Placeholder: the final reviewed instructions and consent text are supplied by PSK.)"
  );
}

/** POST /consents then POST /attempts (fixture). Returns the new attempt id. */
export async function giveConsentAndCreateAttempt(roleId: string): Promise<{ attemptId: string }> {
  await getRole(roleId);
  return { attemptId: `att_${roleId}_${Date.now().toString(36)}` };
}

/** GET /attempts/:id/result (fixture). */
export async function getResult(attemptId: string, ended: "complete" | "early"): Promise<AttemptResult> {
  await new Promise((r) => setTimeout(r, 300));
  if (ended === "early") {
    return {
      attemptId,
      status: "incomplete",
      summary: "Your interview didn't finish. Counts as 1 attempt.",
      nextAttemptOn: "23 Nov",
    };
  }
  return { attemptId, status: "submitted", summary: "No scores, no auto-reject" };
}
