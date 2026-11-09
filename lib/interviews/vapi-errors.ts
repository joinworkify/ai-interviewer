/**
 * Turns the varied error shapes emitted by the Vapi Web SDK (Error objects,
 * API error bodies, Daily.co events, plain strings) into a readable message.
 */
export function describeVapiError(err: unknown): string {
  const fallback = "The voice call failed. Check your microphone and Vapi setup.";
  const raw = extractMessage(err, 0);
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  if (
    lower.includes("permission") ||
    lower.includes("notallowederror") ||
    lower.includes("not allowed")
  ) {
    return "Microphone access was blocked. Allow microphone access for this site and try again.";
  }
  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("invalid key")) {
    return `Vapi rejected the request: ${raw}. Check NEXT_PUBLIC_VAPI_PUBLIC_KEY (it must be the PUBLIC key).`;
  }
  if (lower.includes("assistant") && (lower.includes("not found") || lower.includes("404"))) {
    return `Vapi could not find the assistant: ${raw}. Check NEXT_PUBLIC_VAPI_GENERATOR_ASSISTANT_ID.`;
  }
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

function extractMessage(value: unknown, depth: number): string | null {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (value instanceof Error && value.message) {
    return `${value.name && value.name !== "Error" ? `${value.name}: ` : ""}${value.message}`;
  }
  if (typeof value !== "object") return String(value);

  const v = value as Record<string, unknown>;
  for (const key of ["errorMsg", "message", "error", "msg"]) {
    const nested = v[key];
    if (Array.isArray(nested)) {
      const parts = nested
        .map((n) => extractMessage(n, depth + 1))
        .filter(Boolean);
      if (parts.length) return parts.join("; ");
    } else {
      const found = extractMessage(nested, depth + 1);
      if (found) return found;
    }
  }
  return null;
}
