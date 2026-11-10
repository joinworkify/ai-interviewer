import type { TokenGrant } from "./controller";
import { TokenRequestError } from "./errors";
import { MAX_SESSION_SECONDS, type LiveInterviewDetails } from "./interview-details";

/** Browser call to our own server route; never talks to Google directly. */
export async function requestLiveToken(
  details: LiveInterviewDetails,
  signal?: AbortSignal,
): Promise<TokenGrant> {
  let res: Response;
  try {
    res = await fetch("/api/gemini-live/token", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(details),
      signal,
    });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") throw err;
    throw new TokenRequestError(
      "Could not reach the server to start the interview. Check your connection.",
      0,
    );
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    // The auth proxy redirects signed-out requests to the login page (HTML).
    throw new TokenRequestError(
      res.ok || res.redirected
        ? "Your session may have expired. Sign in again, then retry."
        : `Could not start the interview (HTTP ${res.status}).`,
      res.status,
    );
  }
  if (!res.ok) {
    const message =
      typeof body.message === "string" && body.message
        ? body.message.slice(0, 300)
        : `Could not start the interview (HTTP ${res.status}).`;
    throw new TokenRequestError(message, res.status);
  }

  const { token, model, maxSessionSeconds } = body;
  if (
    typeof token !== "string" ||
    !token.startsWith("auth_tokens/") ||
    typeof model !== "string" ||
    !model
  ) {
    throw new TokenRequestError("The server returned an invalid session token.", res.status);
  }
  return {
    token,
    model,
    maxSessionSeconds:
      typeof maxSessionSeconds === "number" && maxSessionSeconds > 0
        ? maxSessionSeconds
        : MAX_SESSION_SECONDS,
  };
}
