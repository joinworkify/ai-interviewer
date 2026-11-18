/**
 * The steps of a candidate application, in order. One list feeds the stepper,
 * the introduction on the role page and the guard, so they cannot drift apart.
 * Client-safe: no server-only imports.
 */

export type StepId = "role" | "resume" | "consent" | "setup" | "interview";

export interface ApplicationStep {
  id: StepId;
  label: string;
  /** One line for the introduction. */
  description: string;
}

export const APPLICATION_STEPS: readonly ApplicationStep[] = [
  {
    id: "role",
    label: "Role details",
    description: "Read about the role and confirm you want to apply.",
  },
  {
    id: "resume",
    label: "Resume (optional)",
    description: "Add your name, contact details and a PDF or DOCX resume.",
  },
  {
    id: "consent",
    label: "Consent",
    description: "Read and accept how your interview is recorded and reviewed.",
  },
  {
    id: "setup",
    label: "Mic check",
    description: "Test your microphone and speaker before you start.",
  },
  {
    id: "interview",
    label: "Interview",
    description: "Have a short voice interview with the AI interviewer.",
  },
];

/** Where the stepper says the candidate is: a step, or "done" once the interview is over. */
export type StepPosition = StepId | "done";

const PATH_STEPS: Record<string, StepPosition> = {
  "/candidate/resume": "resume",
  "/candidate/consent": "consent",
  "/candidate/setup": "setup",
  "/candidate/live": "interview",
  "/candidate/result": "done",
};

/** The step a pathname belongs to, or null for pages that are not part of an application. */
export function stepFromPathname(pathname: string): StepPosition | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (/^\/candidate\/roles\/[^/]+$/.test(path)) return "role";
  return PATH_STEPS[path] ?? null;
}

/** What the server knows about the candidate's application for one role (GET /api/candidate/progress). */
export interface Progress {
  roleId: string;
  resume: { uploaded: boolean };
  /** The attempt that is still open, or null. See `findOpenAttempt` in progress-store.ts. */
  attempt: { id: string } | null;
}

export type GuardedStep = "resume" | "consent" | "setup" | "interview";

/**
 * Where "Apply" on a role page goes: straight to the resume step when signed
 * in, otherwise to login, which comes back to the resume step afterwards.
 */
export function applyHref(roleId: string, signedIn: boolean): string {
  const resume = `/candidate/resume?role=${encodeURIComponent(roleId)}`;
  return signedIn ? resume : `/auth/login?next=${encodeURIComponent(resume)}`;
}

export function setupPath(attemptId: string, roleId: string): string {
  return `/candidate/setup?attempt=${encodeURIComponent(attemptId)}&role=${encodeURIComponent(roleId)}`;
}

/**
 * Link back to an earlier step, keeping the open attempt in the URL so the
 * step opens again instead of skipping forward. Null when the step cannot be
 * revisited (the interview itself) or there is not enough to build the link.
 */
export function stepHref(
  step: StepId,
  roleId: string | null,
  attemptId: string | null,
): string | null {
  if (!roleId) return null;
  const role = encodeURIComponent(roleId);
  const attempt = attemptId ? `&attempt=${encodeURIComponent(attemptId)}` : "";
  switch (step) {
    case "role":
      return `/candidate/roles/${role}`;
    case "resume":
      return `/candidate/resume?role=${role}${attempt}`;
    case "consent":
      return `/candidate/consent?role=${role}${attempt}`;
    case "setup":
      return attemptId ? setupPath(attemptId, roleId) : null;
    case "interview":
      return null;
  }
}

/**
 * Where to send a candidate who opened `step` out of order, or null when the
 * step may open. `progress` is null when the URL has no role, so there is
 * nothing to look up.
 *
 *  - resume and consent are done once an attempt is open (consent created it),
 *    and must not run again: consent would create a second attempt. Opened
 *    without an attempt in the URL they skip forward to setup. Opened with
 *    the open attempt in the URL (a deliberate "go back", see stepHref) they
 *    stay open, and the pages continue that attempt instead of making one.
 *  - setup and interview need the open attempt named in the URL.
 */
export function redirectFor(
  step: GuardedStep,
  progress: Progress | null,
  attemptId: string | null,
): string | null {
  const needsAttempt = step === "setup" || step === "interview";
  if (progress === null) return needsAttempt ? "/candidate/roles" : null;

  const open = progress.attempt;
  if (!needsAttempt) {
    if (open) return open.id === attemptId ? null : setupPath(open.id, progress.roleId);
    // The attempt in the URL is over: open the step fresh, without it.
    return attemptId ? stepHref(step, progress.roleId, null) : null;
  }

  if (open && open.id === attemptId) return null;
  if (open) return setupPath(open.id, progress.roleId);
  // No open attempt: a finished, abandoned or unknown one. The result page says which.
  if (attemptId) return `/candidate/result?attempt=${encodeURIComponent(attemptId)}`;
  return `/candidate/roles/${encodeURIComponent(progress.roleId)}`;
}
