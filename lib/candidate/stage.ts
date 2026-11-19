import type { ReviewStatus } from "@/lib/admin/access";

import type { AttemptProgress } from "./attempts";

/**
 * The stage of an application as the candidate sees it. It combines how the
 * interview itself went (AttemptProgress) with the reviewer's status. Only
 * this stage ever reaches the candidate: the reviewer's raw status, notes and
 * AI score stay on the admin side.
 *
 * Client-safe (no server imports): the API route and the page both use it.
 */

export type ApplicationStage =
  | "processing"
  | "incomplete"
  | "applied"
  | "in_review"
  | "accepted"
  | "not_selected";

export const APPLICATION_STAGES: readonly ApplicationStage[] = [
  "applied",
  "in_review",
  "accepted",
  "not_selected",
  "processing",
  "incomplete",
];

/**
 * A reviewer's decision wins. Otherwise a failed or unfinished interview
 * comes first, then "in review" once a person has started, else "applied".
 */
export function applicationStage(progress: AttemptProgress, review: ReviewStatus | null): ApplicationStage {
  if (review === "accepted") return "accepted";
  if (review === "rejected") return "not_selected";
  if (progress === "incomplete") return "incomplete";
  if (progress === "processing") return "processing";
  if (review === "in_progress" || review === "completed") return "in_review";
  return "applied";
}

export const STAGE_LABELS: Record<ApplicationStage, string> = {
  processing: "Processing",
  incomplete: "Incomplete",
  applied: "Applied",
  in_review: "In review",
  accepted: "Accepted",
  not_selected: "Not selected",
};

export const STAGE_DESCRIPTIONS: Record<ApplicationStage, string> = {
  processing: "Your interview was received and is being processed.",
  incomplete: "No interview answer was received.",
  applied: "Your interview was submitted. A person at DataSea will review it.",
  in_review: "A person at DataSea is reviewing your interview.",
  accepted: "Congratulations, you were accepted. DataSea will contact you with the next steps.",
  not_selected: "DataSea decided not to move forward with this application.",
};

/** The review statuses that can email the candidate, and the stage each means. */
export function notifiableStage(status: ReviewStatus): "in_review" | "accepted" | "not_selected" | null {
  if (status === "in_progress" || status === "completed") return "in_review";
  if (status === "accepted") return "accepted";
  if (status === "rejected") return "not_selected";
  return null;
}
