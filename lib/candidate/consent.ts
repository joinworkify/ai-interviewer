/**
 * The consent a candidate agrees to before an interview attempt exists.
 *
 * `CONSENT_VERSION` is stored with every attempt (public.candidate_consents),
 * so it must change whenever the wording below changes: the stored version is
 * the only record of what the candidate read. tests/candidate-consent.test.ts
 * fails when this text changes without a new version.
 *
 * Client-safe (no server imports): the consent page renders it and the server
 * checks the version the page sent against it.
 *
 * shortcut: placeholder wording written by engineering. PSK supplies the final
 * reviewed text; change it here and bump the version.
 */

export const CONSENT_VERSION = "2026-11-18";

/** What the candidate is told, one point per line. */
export const CONSENT_POINTS: readonly string[] = [
  "Your voice is processed during the interview and turned into a written transcript. DataSea keeps the transcript, not an audio recording.",
  "The interview runs on Google Gemini, an AI voice service. It processes your audio live to hold the conversation.",
  "The interview is in English only. Please answer in English.",
  "An AI model reads the transcript and writes feedback. A person at DataSea reviews your interview and that feedback.",
  "You can ask DataSea to delete your interview data.",
];

/** The label next to the checkbox. */
export const CONSENT_LABEL =
  "I have read this and agree to the AI interview and to my voice being processed into a written transcript.";
