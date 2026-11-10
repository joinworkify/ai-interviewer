import {
  chat,
  LlmError,
  type ChatMessage,
  type ChatOptions,
  type LlmConfig,
  type TokenUsage,
} from "./client";

/**
 * Asks the model for JSON, parses it, and validates it with a caller-supplied
 * function (throw `LlmError("bad_output", ...)` to reject). On unusable output
 * the call is repeated up to `repairAttempts` more times; every attempt's token
 * usage is returned so callers can account for retries.
 */

/** Tolerates one fenced code block around the JSON, which many models add. */
export function extractJsonText(content: unknown): string {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new LlmError("bad_output", "Model returned no text content.");
  }
  const text = content.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1] : text;
}

export function parseJsonContent(content: unknown): unknown {
  try {
    return JSON.parse(extractJsonText(content));
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError("bad_output", "Model output was not valid JSON.");
  }
}

export interface ChatJsonOptions extends ChatOptions {
  /** Extra attempts when the output is unusable. Default 1. */
  repairAttempts?: number;
  /**
   * Called once per model call that returned a response, including attempts
   * whose output is then rejected, so spend is accounted for even on failure.
   */
  onUsage?: (usage: TokenUsage, model: string) => void;
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
}

export async function chatJson<T>(
  config: LlmConfig,
  messages: ChatMessage[],
  validate: (value: unknown) => T,
  options: ChatJsonOptions = {},
): Promise<ChatJsonResult<T>> {
  const repairs = Math.max(0, Math.min(options.repairAttempts ?? 1, 3));
  let lastError: LlmError | undefined;

  for (let attempt = 0; attempt <= repairs; attempt++) {
    // Transport failures are not repaired here; chat() already retried what
    // it could, so they propagate.
    const result = await chat(config, messages, options);
    options.onUsage?.(result.usage, result.model);
    try {
      return {
        data: validate(parseJsonContent(result.content)),
        model: result.model,
      };
    } catch (err) {
      if (!(err instanceof LlmError) || err.kind !== "bad_output") throw err;
      lastError = err;
    }
  }
  throw lastError ?? new LlmError("bad_output", "Model output was unusable.");
}
