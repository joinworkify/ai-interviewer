import { issueSessionToken } from "@/lib/dograh/session-token";

/** Shared fixtures for the Dograh tests. All values are fake. */

export const USER = "11111111-2222-4333-8444-555555555555";
export const OTHER_USER = "99999999-2222-4333-8444-555555555555";
export const SESSION = "22222222-2222-4222-8222-222222222222";

export const WEBHOOK_SECRET = "webhook-secret-0123456789-abcdefghijklmnop";
export const SESSION_SECRET = "session-secret-0123456789-abcdefghijklmnop";
export const API_ORIGIN = "http://localhost:8000";
export const STORAGE_ORIGIN = "http://localhost:9000";
export const TRANSCRIPT_URL = `${API_ORIGIN}/api/v1/public/download/workflow/PUBLIC-TOKEN-xyz/transcript`;

export const ENV: Record<string, string> = {
  DOGRAH_API_URL: API_ORIGIN,
  DOGRAH_STORAGE_URL: STORAGE_ORIGIN,
  DOGRAH_WEBHOOK_SECRET: WEBHOOK_SECRET,
  DOGRAH_SESSION_SIGNING_SECRET: SESSION_SECRET,
};

export const TRANSCRIPT_TEXT = [
  "[2026-11-12T10:00:01.000Z] assistant: Tell me about database indexes.",
  "[2026-11-12T10:00:09.000Z] user: An index speeds up reads at the cost of writes.",
  "[2026-11-12T10:00:15.000Z] assistant: Good. When would you avoid one?",
  "",
].join("\n");

export function makeToken(
  over: { userId?: string; sessionId?: string; secret?: string; nowMs?: number; ttlSeconds?: number } = {},
): string {
  return issueSessionToken(
    over.userId ?? USER,
    over.sessionId ?? SESSION,
    over.secret ?? SESSION_SECRET,
    { nowMs: over.nowMs, ttlSeconds: over.ttlSeconds },
  ).token;
}
