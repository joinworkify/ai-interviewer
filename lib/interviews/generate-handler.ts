import {
  SigningSecretError,
  verifyCapability,
  type CapabilityErrorCode,
} from "./capability";
import { generateQuestions, LlmError, readLlmConfig } from "./llm";
import {
  createSupabaseInterviewStore,
  readStoreConfig,
  type InterviewStore,
} from "./store";
import { validateGenerateInterviewBody } from "./validation";

/**
 * Handler for `POST /api/vapi/generate-interview`, the URL configured on the
 * Vapi API Request tool. Kept framework-agnostic (Request -> Response) with
 * injectable dependencies so it can be unit-tested without network access.
 *
 * Check order is intentional:
 *   content-type/size -> JSON -> capability signature/expiry -> field
 *   validation -> server config -> LLM -> insert
 * so callers without a valid capability learn nothing about server config.
 */

export const MAX_BODY_BYTES = 8 * 1024;

export interface GenerateHandlerDeps {
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Override for tests; defaults to a Supabase secret-key store from env. */
  createStore?: (env: Record<string, string | undefined>) => InterviewStore;
}

type ErrorCode =
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "unauthorized"
  | "server_misconfigured"
  | "llm_auth_failed"
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_failed"
  | "storage_failed";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function fail(
  status: number,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  // `message` is phrased so the voice assistant can relay it sensibly.
  return json(status, { success: false, error, message, ...extra });
}

const CAPABILITY_MESSAGES: Record<CapabilityErrorCode, string> = {
  missing: "Missing generation capability.",
  malformed: "Invalid generation capability.",
  bad_signature: "Invalid generation capability.",
  invalid_claims: "Invalid generation capability.",
  not_yet_valid: "Invalid generation capability.",
  expired:
    "The generation session expired. Ask the user to restart the call from the app.",
};

async function readBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return {
      ok: false,
      response: fail(
        415,
        "unsupported_media_type",
        "Content-Type must be application/json.",
      ),
    };
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail(413, "payload_too_large", "Request body too large."),
    };
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail(413, "payload_too_large", "Request body too large."),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: fail(400, "invalid_json", "Request body must be valid JSON."),
    };
  }
}

export async function handleGenerateInterview(
  request: Request,
  deps: GenerateHandlerDeps,
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetch ?? fetch;
  const env = deps.env;

  const body = await readBody(request);
  if (!body.ok) return body.response;

  if (
    !body.value ||
    typeof body.value !== "object" ||
    Array.isArray(body.value)
  ) {
    return fail(400, "invalid_request", "Request body must be a JSON object.");
  }

  // 1. Capability first. Body field is the documented path; the header is an
  //    optional alternative if you prefer configuring it as a tool header.
  const record = body.value as Record<string, unknown>;
  const headerToken = request.headers.get("x-interview-capability");
  const bodyToken = record.capability;
  if (
    headerToken !== null &&
    bodyToken !== undefined &&
    headerToken !== bodyToken
  ) {
    return fail(401, "unauthorized", "Conflicting generation capabilities.");
  }
  const token = bodyToken ?? headerToken ?? undefined;

  let verified;
  try {
    verified = verifyCapability(token, env.VAPI_TOOL_SIGNING_SECRET, now());
  } catch (err) {
    if (err instanceof SigningSecretError) {
      console.error(`[generate-interview] ${err.message}`);
      return fail(
        503,
        "server_misconfigured",
        "Interview generation is not configured on the server.",
      );
    }
    throw err;
  }
  if (!verified.ok) {
    return fail(401, "unauthorized", CAPABILITY_MESSAGES[verified.code]);
  }
  const { sub: userId } = verified.payload;

  // 2. Strict field validation.
  const validation = validateGenerateInterviewBody(record);
  if (!validation.ok) {
    return fail(400, "invalid_request", "Invalid interview details.", {
      details: validation.errors,
    });
  }
  const input = validation.data;

  // 3. Server configuration (only revealed to valid capability holders).
  const llm = readLlmConfig(env);
  const storeConfig = readStoreConfig(env);
  if (!llm.ok || !storeConfig.ok) {
    const missing = [
      ...(llm.ok ? [] : [...llm.missing, ...llm.invalid]),
      ...(storeConfig.ok ? [] : storeConfig.missing),
    ];
    console.error(
      `[generate-interview] missing/invalid server config: ${missing.join(", ")}`,
    );
    return fail(
      503,
      "server_misconfigured",
      "Interview generation is not configured on the server. Set the missing environment variables and redeploy (see VAPI_SETUP.md).",
      { missing },
    );
  }

  const store = deps.createStore
    ? deps.createStore(env)
    : createSupabaseInterviewStore(storeConfig.url, storeConfig.secretKey);

  // 4. Generate questions with the server-side LLM.
  let questions: string[];
  try {
    questions = await generateQuestions(input, llm.config, fetchImpl);
  } catch (err) {
    if (err instanceof LlmError) {
      console.error(`[generate-interview] LLM ${err.kind}: ${err.message}`);
      switch (err.kind) {
        case "auth":
          return fail(
            502,
            "llm_auth_failed",
            "The question generator rejected the server's LLM credentials.",
          );
        case "rate_limited":
          return fail(
            503,
            "llm_rate_limited",
            "The question generator is busy. Please try again shortly.",
          );
        case "timeout":
          return fail(
            504,
            "llm_timeout",
            "The question generator timed out. Please try again.",
          );
        default:
          return fail(
            502,
            "llm_failed",
            "The question generator failed to produce questions.",
          );
      }
    }
    console.error("[generate-interview] unexpected LLM error", err);
    return fail(502, "llm_failed", "The question generator failed.");
  }

  // 5. Persist, owned by the verified user.
  try {
    const { id } = await store.insert({
      user_id: userId,
      questions,
    });
    return json(201, {
      success: true,
      interviewId: id,
      questionCount: questions.length,
      message: `Saved an interview with ${questions.length} questions.`,
    });
  } catch {
    return fail(500, "storage_failed", "Could not save the interview.");
  }
}
