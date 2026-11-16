/**
 * Browser side of POST /api/candidate/profile (see lib/candidate/profile.ts).
 * `fetch` is injected so it can be unit-tested without a network.
 */

export interface ProfileUpdate {
  name?: string;
  phone?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
}

export class ProfileSaveError extends Error {}

/** Fired on `window` after a save so other parts of the page (the header name) can refresh. */
export const PROFILE_UPDATED_EVENT = "candidate-profile-updated";

/** Saves the given fields. Throws ProfileSaveError with a message fit to show. */
export async function saveProfile(
  update: ProfileUpdate,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl("/api/candidate/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
  } catch {
    throw new ProfileSaveError(
      "Could not save your details. Check your connection and try again.",
    );
  }
  if (res.ok) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
    return;
  }
  let message = "Could not save your details. Please try again.";
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {
    // keep the fallback
  }
  throw new ProfileSaveError(message);
}
