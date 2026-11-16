import type { Progress } from "./steps";

/**
 * Browser side of GET /api/candidate/progress (see lib/candidate/progress.ts).
 * `fetch` is injected so it can be unit-tested without a network.
 */
export class ProgressError extends Error {}

export async function getProgress(
  roleId: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Progress> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/candidate/progress?role=${encodeURIComponent(roleId)}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
  } catch {
    throw new ProgressError("Network error. Check your connection and try again.");
  }
  const json: unknown = await res.json().catch(() => null);
  const progress = (json as { progress?: Progress } | null)?.progress;
  if (!res.ok || !progress || typeof progress.roleId !== "string") {
    throw new ProgressError("Could not check your progress.");
  }
  return progress;
}
