import {
  chat,
  LlmError,
  readLlmConfig,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  type LlmConfig,
  type LlmConfigResult,
  type LlmErrorKind,
} from "@/lib/ai/client";
import { parseJsonContent } from "@/lib/ai/json";
import {
  buildGenerateQuestionsMessages,
  parseGeneratedQuestions,
} from "@/lib/ai/prompts/generate-questions";
import type { GenerateInterviewInput } from "./validation";

/**
 * Question generation for the Vapi tool endpoint. The provider client, JSON
 * handling and prompt now live in `lib/ai/`; this module keeps the original
 * public API so the handler and its callers are unchanged.
 */

export {
  LlmError,
  readLlmConfig,
  DEFAULT_LLM_BASE_URL,
  DEFAULT_LLM_TIMEOUT_MS,
  type LlmConfig,
  type LlmConfigResult,
  type LlmErrorKind,
};

export const buildMessages = buildGenerateQuestionsMessages;

/** Extracts and validates the question list from the model's text output. */
export function parseQuestions(content: unknown, amount: number): string[] {
  return parseGeneratedQuestions(parseJsonContent(content), amount);
}

export async function generateQuestions(
  input: GenerateInterviewInput,
  config: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  // No retries: Vapi's tool call has a tight deadline, so a slow retry would
  // time the call out anyway. Failures are mapped to a clear error instead.
  const result = await chat(config, buildMessages(input), {
    fetch: fetchImpl,
    retries: 0,
    logTag: "generate-interview",
  });
  return parseQuestions(result.content, input.amount);
}
