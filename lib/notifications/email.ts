/**
 * Minimal transactional email through the Resend HTTP API (no extra
 * dependency). Needs RESEND_API_KEY and EMAIL_FROM (a sender Resend has
 * verified, e.g. "DataSea <interviews@yourdomain.com>"). Without both,
 * `createEmailSender` returns null and callers simply skip emailing.
 *
 * Never throws and never logs the recipient, subject or body.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendEmail = (message: EmailMessage) => Promise<boolean>;

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function createEmailSender(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): SendEmail | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return async ({ to, subject, text }) => {
    try {
      const res = await fetchImpl(RESEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) console.error(`[email] provider answered ${res.status}`);
      return res.ok;
    } catch {
      console.error("[email] send failed");
      return false;
    }
  };
}
