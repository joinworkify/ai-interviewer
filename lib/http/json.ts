/** Small helpers shared by JSON route handlers. */

export function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export type ReadJsonResult =
  | { ok: true; value: unknown }
  | {
      ok: false;
      status: 400 | 413 | 415;
      error: "unsupported_media_type" | "payload_too_large" | "invalid_json";
      message: string;
    };

/**
 * Reads a size-capped JSON body. Never throws. With `allowEmpty`, a request
 * with no body at all yields `{}` (so a bare POST works); a non-empty body is
 * still checked for content type and validated as JSON.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
  options: { allowEmpty?: boolean } = {},
): Promise<ReadJsonResult> {
  const tooLarge = {
    ok: false,
    status: 413,
    error: "payload_too_large",
    message: "Request body too large.",
  } as const;

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return tooLarge;

  const hasType = (request.headers.get("content-type") ?? "")
    .toLowerCase()
    .startsWith("application/json");

  // Without allowEmpty the content type is checked before reading anything.
  if (!options.allowEmpty && !hasType) return unsupported;

  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return tooLarge;

  if (options.allowEmpty) {
    if (text.trim() === "") return { ok: true, value: {} };
    if (!hasType) return unsupported;
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid_json",
      message: "Request body must be valid JSON.",
    };
  }
}

const unsupported = {
  ok: false,
  status: 415,
  error: "unsupported_media_type",
  message: "Content-Type must be application/json.",
} as const;
