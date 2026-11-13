import { handleSubmitFeedback, type SessionHandlerDeps } from "./handlers";

/**
 * Runs the AI evaluation for a session whose transcript was just stored, with
 * no browser involved. It goes through the same handler as
 * `POST /api/sessions/:id/feedback`, so the ownership check, the daily quota,
 * the "already evaluated" guard and the prompt-injection handling all apply
 * unchanged. The feedback is stored for reviewers; nothing here returns it.
 *
 * `userId` must come from a verified source (the signed Dograh session token),
 * never from a request body. Errors are reported as a short code only: model
 * output, transcript text and provider messages are never logged.
 */

export type AutoEvaluateOutcome =
  | { kind: "evaluated" }
  | { kind: "already_evaluated" }
  | { kind: "failed"; status: number; code: string };

export type SubmitFeedback = typeof handleSubmitFeedback;

const CODE_RE = /^[a-z_]{1,40}$/;

export async function evaluateStoredSession(
  userId: string,
  sessionId: string,
  deps: Omit<SessionHandlerDeps, "getUserId">,
  submit: SubmitFeedback = handleSubmitFeedback,
): Promise<AutoEvaluateOutcome> {
  let res: Response;
  try {
    // An empty body is valid: a stored transcript is what gets evaluated.
    res = await submit(
      new Request("http://internal.invalid/evaluate", { method: "POST" }),
      sessionId,
      { ...deps, getUserId: async () => userId },
    );
  } catch {
    console.error("[auto-evaluate] unexpected error");
    return { kind: "failed", status: 0, code: "exception" };
  }

  if (res.status === 201) return { kind: "evaluated" };

  let code = "unknown";
  try {
    const body: unknown = await res.json();
    const raw = (body as { error?: unknown } | null)?.error;
    if (typeof raw === "string" && CODE_RE.test(raw)) code = raw;
  } catch {
    // Keep "unknown".
  }
  if (res.status === 409 && code === "already_evaluated") return { kind: "already_evaluated" };
  console.error(`[auto-evaluate] not evaluated status=${res.status} code=${code}`);
  return { kind: "failed", status: res.status, code };
}
