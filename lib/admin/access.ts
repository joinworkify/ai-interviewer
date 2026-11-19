/**
 * Who is an admin. The role lives in the Supabase user's `app_metadata.role`,
 * which only the service role can set (users can edit `user_metadata`, never
 * `app_metadata`), and it arrives in the verified JWT claims. Set it with
 * scripts/create-admin.mjs.
 */

export const ADMIN_ROLE = "admin";

export const REVIEW_STATUSES = ["pending", "in_progress", "completed", "accepted", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === "string" && (REVIEW_STATUSES as readonly string[]).includes(value);
}

/** True only for verified claims whose app_metadata.role is "admin". */
export function isAdminClaims(claims: unknown): boolean {
  if (typeof claims !== "object" || claims === null) return false;
  const meta = (claims as { app_metadata?: unknown }).app_metadata;
  return (
    typeof meta === "object" &&
    meta !== null &&
    (meta as { role?: unknown }).role === ADMIN_ROLE
  );
}
