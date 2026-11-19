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

export const CONSENT_VERSION = "2026-11-23";

/** What the candidate is told, one point per line. */
export const CONSENT_POINTS: readonly string[] = [
  "Your voice is processed during the interview and turned into a written transcript. DataSea also saves an audio recording of the interview, which a person at DataSea can listen to when reviewing it.",
  "You can take one photo with your camera before the interview, so a reviewer can confirm who took it. Only DataSea reviewers see it, and you can skip it.",
  "During the interview your browser notes when you switch to another tab or window, so a reviewer can see it. A model may also listen to the recording to check for a second voice and to double-check the score.",
  "Some roles also ask for a short written or coding task after the interview. Your answer, and whether text was pasted into it, are shown to reviewers and used in the score.",
  "The interview runs on Google Gemini, an AI voice service. It processes your audio live to hold the conversation.",
  "The interview is in English only. Please answer in English.",
  "An AI model reads the transcript, scores your answers against the criteria for the role, and writes feedback. A person at DataSea reviews your interview, the score and that feedback. The score is a guide, not an automatic decision.",
  "You can ask DataSea to delete your interview data, including the recording.",
];

/** The label next to the checkbox. */
export const CONSENT_LABEL =
  "I have read this and agree to the AI interview, to my voice being processed into a written transcript, and to the interview being recorded.";
