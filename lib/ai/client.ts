/**
 * Provider-agnostic LLM client for any OpenAI-compatible Chat Completions
 * endpoint (`POST {LLM_BASE_URL}/chat/completions`).
 *
 * Works with e.g.
 *  - OpenAI:  LLM_BASE_URL=https://api.openai.com/v1
 *  - Gemini:  LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *  - any other provider exposing the same API.
 *
 * Nothing here fabricates output: every failure becomes an LlmError.
 * Upstream error bodies are logged server-side only and never reach callers.
 */

export const DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_LLM_TIMEOUT_MS = 25_000;
const MAX_RETRY_AFTER_MS = 5_000;

export interface LlmConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export type LlmConfigResult =
  | { ok: true; config: LlmConfig }
  | { ok: false; missing: string[]; invalid: string[] };

export function readLlmConfig(
  env: Record<string, string | undefined>,
): LlmConfigResult {
  const missing: string[] = [];
  const invalid: string[] = [];
  const apiKey = env.LLM_API_KEY?.trim();
  const model = env.LLM_MODEL?.trim();
  const baseUrlRaw = env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL;
  const timeoutRaw = env.LLM_TIMEOUT_MS?.trim();

  if (!apiKey) missing.push("LLM_API_KEY");
  if (!model) missing.push("LLM_MODEL");

  let baseUrl = baseUrlRaw.replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost") {
      invalid.push("LLM_BASE_URL (must be https)");
    }
  } catch {
    invalid.push("LLM_BASE_URL (not a valid URL)");
    baseUrl = "";
  }

  let timeoutMs = DEFAULT_LLM_TIMEOUT_MS;
  if (timeoutRaw) {
    const n = Number(timeoutRaw);
    if (!Number.isInteger(n) || n < 1000 || n > 120_000) {
      invalid.push("LLM_TIMEOUT_MS (integer 1000-120000)");
    } else {
      timeoutMs = n;
    }
  }

  if (missing.length || invalid.length || !apiKey || !model) {
    return { ok: false, missing, invalid };
  }
  return { ok: true, config: { apiKey, model, baseUrl, timeoutMs } };
}

export type LlmErrorKind =
  | "auth" // provider rejected credentials (401/403)
  | "rate_limited" // 429
  | "upstream" // other non-2xx
  | "timeout"
  | "network"
  | "bad_output"; // 2xx but unusable content

export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    public readonly upstreamStatus?: number,
    /** From a Retry-After header, when the provider sent one. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface ChatResult {
  content: unknown;
  usage: TokenUsage;
  model: string;
}

export interface ChatOptions {
  fetch?: typeof fetch;
  /**
   * Extra attempts after the first for retryable failures (429, 5xx, network).
   * Default 0: callers on a tight deadline (e.g. a Vapi tool call) must not
   * retry. Background features pass 1-2. Timeouts are never retried.
   */
  retries?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Log prefix, e.g. "generate-interview". */
  logTag?: string;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryable(err: LlmError): boolean {
  return (
    err.kind === "rate_limited" ||
    err.kind === "network" ||
    (err.kind === "upstream" && (err.upstreamStatus ?? 0) >= 500)
  );
}

function retryDelayMs(attempt: number, retryAfter: number | undefined): number {
  const backoff = 500 * 2 ** attempt;
  return Math.min(Math.max(backoff, retryAfter ?? 0), MAX_RETRY_AFTER_MS);
}

async function attemptOnce(
  config: LlmConfig,
  messages: ChatMessage[],
  fetchImpl: typeof fetch,
  logTag: string,
): Promise<ChatResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, messages }),
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new LlmError(
        "timeout",
        `LLM request timed out after ${config.timeoutMs}ms.`,
      );
    }
    throw new LlmError("network", "Could not reach the LLM provider.");
  }

  if (!response.ok) {
    const kind: LlmErrorKind =
      response.status === 401 || response.status === 403
        ? "auth"
        : response.status === 429
          ? "rate_limited"
          : "upstream";
    // Status only: provider error bodies can echo the prompt (transcript) or
    // key fragments, so they are never read or logged. Release the connection.
    response.body?.cancel().catch(() => {});
    console.error(`[${logTag}] LLM provider returned ${response.status}`);
    const retryAfterSec = Number(response.headers.get("retry-after"));
    throw new LlmError(
      kind,
      `LLM provider returned HTTP ${response.status}.`,
      response.status,
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : undefined,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new LlmError("bad_output", "LLM provider returned non-JSON body.");
  }

  const body = data as {
    choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    model?: unknown;
  } | null;

  const toCount = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

  return {
    content: body?.choices?.[0]?.message?.content,
    usage: {
      promptTokens: toCount(body?.usage?.prompt_tokens),
      completionTokens: toCount(body?.usage?.completion_tokens),
    },
    model: typeof body?.model === "string" ? body.model : config.model,
  };
}

/** One chat completion, with optional bounded retry on transient failures. */
export async function chat(
  config: LlmConfig,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<ChatResult> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const logTag = options.logTag ?? "ai";
  const retries = Math.max(0, Math.min(options.retries ?? 0, 3));

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(config, messages, fetchImpl, logTag);
    } catch (err) {
      if (!(err instanceof LlmError) || attempt >= retries || !isRetryable(err)) {
        throw err;
      }
      await sleep(retryDelayMs(attempt, err.retryAfterMs));
    }
  }
}
