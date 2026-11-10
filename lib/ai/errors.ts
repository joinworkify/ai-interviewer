import type { LlmError } from "./client";

export type LlmFailureCode =
  | "llm_auth_failed"
  | "llm_rate_limited"
  | "llm_timeout"
  | "llm_failed";

/** HTTP mapping for LLM failures. Messages are safe to show to end users. */
export function describeLlmError(err: LlmError): {
  status: number;
  code: LlmFailureCode;
  message: string;
} {
  switch (err.kind) {
    case "auth":
      return {
        status: 502,
        code: "llm_auth_failed",
        message: "The AI provider rejected the server's credentials.",
      };
    case "rate_limited":
      return {
        status: 503,
        code: "llm_rate_limited",
        message: "The AI provider is busy. Please try again shortly.",
      };
    case "timeout":
      return {
        status: 504,
        code: "llm_timeout",
        message: "The AI provider timed out. Please try again.",
      };
    default:
      return {
        status: 502,
        code: "llm_failed",
        message: "The AI provider failed to produce a usable result.",
      };
  }
}
