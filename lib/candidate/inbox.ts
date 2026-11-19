import { jsonResponse } from "@/lib/http/json";

/**
 * The candidate's in-app notifications.
 *   GET  /api/candidate/notifications        latest items and the unread count
 *   POST /api/candidate/notifications/read   mark all as read
 * The user id comes only from verified Supabase claims.
 */

export interface InboxEntry {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export const INBOX_LIMIT = 30;

export interface InboxReadStore {
  list(userId: string, limit: number): Promise<InboxEntry[]>;
  unreadCount(userId: string): Promise<number>;
  markAllRead(userId: string): Promise<void>;
}

export interface InboxHandlerDeps {
  getUserId: () => Promise<string | null>;
  store: InboxReadStore;
}

const unauthorized = () => jsonResponse(401, { success: false, error: "unauthorized", message: "Sign in required." });
const storageFailed = () => jsonResponse(500, { success: false, error: "storage_failed", message: "Could not load your notifications." });

export async function handleListInbox(deps: InboxHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();
  try {
    const [items, unread] = await Promise.all([deps.store.list(userId, INBOX_LIMIT), deps.store.unreadCount(userId)]);
    return jsonResponse(200, { success: true, notifications: items, unread });
  } catch {
    return storageFailed();
  }
}

export async function handleMarkInboxRead(deps: InboxHandlerDeps): Promise<Response> {
  const userId = await deps.getUserId();
  if (!userId) return unauthorized();
  try {
    await deps.store.markAllRead(userId);
    return jsonResponse(200, { success: true });
  } catch {
    return storageFailed();
  }
}
