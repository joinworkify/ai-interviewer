import type { TranscriptAdapter, TranscriptSource } from "../types";
import { geminiLiveClientAdapter } from "./gemini-live-client";

/** Add a provider's adapter here; see TranscriptAdapter in ../types.ts. */
export const defaultAdapters: Partial<Record<TranscriptSource, TranscriptAdapter>> = {
  client_gemini_live: geminiLiveClientAdapter,
};
