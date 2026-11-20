import { isReviewStatus, type ReviewStatus } from "./access";

/**
 * Filtering and sorting of the admin interviews list. Pure, so the page and
 * the CSV export apply exactly the same rules to the same query string.
 */

export type SortKey = "newest" | "score_desc" | "score_asc";

export interface ListQuery {
  status: ReviewStatus | null;
  q: string;
  /** Only interviews scored at or above this (unscored ones are hidden). */
  minScore: number | null;
  sort: SortKey;
  /** "me" = assigned to the signed-in admin; "none" = unassigned; an id = that admin. */
  assigned: string | null;
}

export interface ListRow {
  name: string | null;
  email: string | null;
  reviewStatus: ReviewStatus;
  score: number | null;
  assignedTo: string | null;
  startedAt: string;
}

const SORTS: readonly SortKey[] = ["newest", "score_desc", "score_asc"];

export function parseListQuery(params: Record<string, string | undefined>): ListQuery {
  const min = Number.parseInt(params.minScore ?? "", 10);
  return {
    status: isReviewStatus(params.status) ? params.status : null,
    q: (params.q ?? "").trim().toLowerCase(),
    minScore: Number.isFinite(min) ? Math.min(Math.max(min, 0), 100) : null,
    sort: (SORTS as readonly string[]).includes(params.sort ?? "") ? (params.sort as SortKey) : "newest",
    assigned: params.assigned?.trim() ? params.assigned.trim() : null,
  };
}

function matchesAssignee(assignedTo: string | null, filter: string | null, meId: string | null): boolean {
  if (filter === null) return true;
  if (filter === "none") return assignedTo === null;
  const wanted = filter === "me" ? meId : filter;
  // "me" with no known id matches nothing (not every unassigned row).
  return wanted !== null && assignedTo === wanted;
}

export function applyListQuery<T extends ListRow>(rows: readonly T[], query: ListQuery, meId: string | null): T[] {
  const out = rows.filter(
    (r) =>
      (!query.status || r.reviewStatus === query.status) &&
      (!query.q || (r.name ?? "").toLowerCase().includes(query.q) || (r.email ?? "").toLowerCase().includes(query.q)) &&
      (query.minScore === null || (r.score !== null && r.score >= query.minScore)) &&
      matchesAssignee(r.assignedTo, query.assigned, meId),
  );
  if (query.sort === "newest") return out; // already newest first
  const dir = query.sort === "score_desc" ? -1 : 1;
  // Unscored interviews always go last, whichever way scores sort.
  return [...out].sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return (a.score - b.score) * dir;
  });
}

/** The query string for a list state, omitting defaults. */
export function listQueryString(raw: Record<string, string | undefined>, overrides: Record<string, string | null> = {}): string {
  const params = new URLSearchParams();
  for (const key of ["q", "status", "minScore", "sort", "assigned"]) {
    const value = key in overrides ? overrides[key] : raw[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}
