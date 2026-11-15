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
import { CONSENT_VERSION } from "./consent";
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
  | "processing"
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

/**
 * POST /api/candidate/attempts. Creates the interview (the role's questions)
 * and its session on the server; the attempt id is the interview session id,
 * which the Dograh call, the transcript webhook and feedback all use. The
 * request also records the consent: it sends the version of the consent text
 * the page showed, and the server stores it with the attempt.
 */
export async function giveConsentAndCreateAttempt(
  roleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ attemptId: string }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/candidate/attempts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roleId, consentVersion: CONSENT_VERSION }),
    });
  } catch {
    throw new ApiError("NETWORK", "Network error. Check your connection and try again.");
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.status === 409 && (json as { error?: unknown } | null)?.error === "consent_outdated") {
    throw new ApiError("CONSENT_OUTDATED", "The consent text has changed. Reload the page and agree again.");
  }
  if (res.status === 429 && (json as { error?: unknown } | null)?.error === "attempt_limit") {
    throw new ApiError("ATTEMPT_LIMIT", "You have used all of your attempts for this role. Contact DataSea if you need another.");
  }
  const sessionId = (json as { attempt?: { sessionId?: unknown } } | null)?.attempt?.sessionId;
  if (!res.ok || typeof sessionId !== "string" || sessionId.length === 0) {
    throw new ApiError("ATTEMPT_FAILED", "Could not start the interview.");
  }
  return { attemptId: sessionId };
}

const RESULT_SUMMARY: Record<"processing" | "submitted" | "incomplete", string> = {
  processing: "We're still processing your interview.",
  submitted: "Your answers were received.",
  incomplete: "We didn't hear an answer, so there is nothing to review.",
};

/**
 * GET /api/candidate/attempts/:id. Where the attempt really stands, read from
 * the stored session: processing (transcript not here yet), submitted, or
 * incomplete. Never a score or any evaluation; reviewers get those separately.
 */
export async function getResult(
  attemptId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AttemptResult> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/candidate/attempts/${encodeURIComponent(attemptId)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ApiError("NETWORK", "Network error. Check your connection and try again.");
  }
  const json: unknown = await res.json().catch(() => null);
  const status = (json as { attempt?: { status?: unknown } } | null)?.attempt?.status;
  if (!res.ok || (status !== "processing" && status !== "submitted" && status !== "incomplete")) {
    throw new ApiError("RESULT_FAILED", "Could not load the result.");
  }
  return { attemptId, status, summary: RESULT_SUMMARY[status] };
}

export interface WaitForResultOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * After the call ends the transcript reaches us a few seconds later (Dograh's
 * webhook). Polls until the attempt is no longer "processing". At the timeout
 * it returns the last "processing" result so the screen can say so; it throws
 * only when every poll failed.
 */
export async function waitForResult(
  attemptId: string,
  options: WaitForResultOptions = {},
): Promise<AttemptResult> {
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 60_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const start = now();
  let last: AttemptResult | null = null;
  let lastError: unknown = null;

  for (;;) {
    if (options.signal?.aborted) throw new ApiError("ABORTED", "Cancelled.");
    try {
      last = await getResult(attemptId, options.fetchImpl, options.signal);
      lastError = null;
      if (last.status !== "processing") return last;
    } catch (err) {
      if (options.signal?.aborted) throw new ApiError("ABORTED", "Cancelled.");
      lastError = err;
    }
    if (now() - start + interval >= timeout) break;
    await sleep(interval);
  }
  if (last) return last;
  throw lastError ?? new ApiError("RESULT_FAILED", "Could not load the result.");
}
