/** User-facing error helpers for the Gemini Live browser client. */

export class TokenRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TokenRequestError";
  }
}

/** Thrown when the page cannot use getUserMedia (non-secure context, old browser). */
export class MicUnavailableError extends Error {
  constructor() {
    super("Microphone API unavailable.");
    this.name = "MicUnavailableError";
  }
}

export function describeMicError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return "Microphone permission was denied. Allow microphone access for this site in your browser settings, then press Start again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Connect a microphone and try again.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "The microphone is in use by another application or could not be opened.";
    case "MicUnavailableError":
      return "Microphone access requires a secure page: open the app over HTTPS or localhost (http://localhost:3000).";
    default:
      return "Could not start the microphone. Check your browser's microphone settings and try again.";
  }
}

/** Removes anything that looks like an ephemeral token and caps length. */
export function sanitizeProviderText(text: string, max = 160): string {
  const cleaned = text
    .replace(/auth_tokens\/[A-Za-z0-9._-]+/g, "[token]")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export function describeCloseEvent(e: { code?: number; reason?: string }): string {
  const code = typeof e.code === "number" ? e.code : 1006;
  const reason = e.reason ? sanitizeProviderText(e.reason) : "";
  return `Gemini closed the connection (code ${code})${reason ? `: ${reason}` : "."}`;
}
