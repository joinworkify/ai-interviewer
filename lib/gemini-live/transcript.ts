/**
 * Transcript accumulation for Gemini Live `inputTranscription` (candidate) and
 * `outputTranscription` (interviewer) events.
 *
 * The Live API streams transcription as incremental text fragments that are
 * independent of the audio and of each other (input fragments can arrive
 * after the model already started answering). Rules:
 *  - fragments append to the speaker's open (partial) entry, else start one;
 *  - a candidate entry stays open while the interviewer replies, so late
 *    fragments land above the reply instead of creating a misplaced entry;
 *  - turnComplete / interrupted close the interviewer entry and the candidate
 *    entry that preceded it; candidate speech that started *after* the reply
 *    (barge-in) stays open;
 *  - `finished: true` closes that speaker's entry;
 *  - finalized text is whitespace-normalized; empty entries are dropped.
 */

export type Speaker = "candidate" | "interviewer";

export interface TranscriptEntry {
  id: number;
  speaker: Speaker;
  text: string;
  final: boolean;
  interrupted?: boolean;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
  nextId: number;
  openCandidate: number | null;
  openInterviewer: number | null;
}

export type TranscriptEvent =
  | { type: "input"; text: string; finished?: boolean }
  | { type: "output"; text: string; finished?: boolean }
  | { type: "interrupted" }
  | { type: "turnComplete" }
  | { type: "finalizeAll" };

export function initialTranscript(): TranscriptState {
  return { entries: [], nextId: 1, openCandidate: null, openInterviewer: null };
}

type OpenKey = "openCandidate" | "openInterviewer";
const OPEN_KEY: Record<Speaker, OpenKey> = {
  candidate: "openCandidate",
  interviewer: "openInterviewer",
};

function indexOf(state: TranscriptState, id: number | null): number {
  return id === null ? -1 : state.entries.findIndex((e) => e.id === id);
}

/** Returns a new state with the speaker's open entry finalized (or removed if empty). */
function finalize(
  state: TranscriptState,
  speaker: Speaker,
  extra: Partial<TranscriptEntry> = {},
): TranscriptState {
  const key = OPEN_KEY[speaker];
  const idx = indexOf(state, state[key]);
  if (idx < 0) return { ...state, [key]: null };
  const entry = state.entries[idx];
  const text = entry.text.replace(/\s+/g, " ").trim();
  const entries = state.entries.slice();
  if (text.length === 0) {
    entries.splice(idx, 1);
  } else {
    entries[idx] = { ...entry, ...extra, text, final: true };
  }
  return { ...state, entries, [key]: null };
}

function append(
  state: TranscriptState,
  speaker: Speaker,
  text: string,
  finished: boolean | undefined,
): TranscriptState {
  const key = OPEN_KEY[speaker];
  const idx = indexOf(state, state[key]);
  let next = state;
  if (idx >= 0) {
    if (text.length > 0) {
      const entries = state.entries.slice();
      entries[idx] = { ...entries[idx], text: entries[idx].text + text };
      next = { ...state, entries };
    }
  } else if (text.trim().length > 0) {
    const entry: TranscriptEntry = {
      id: state.nextId,
      speaker,
      text,
      final: false,
    };
    next = {
      ...state,
      entries: [...state.entries, entry],
      nextId: state.nextId + 1,
      [key]: entry.id,
    };
  }
  return finished ? finalize(next, speaker) : next;
}

/** Ends the current model turn (normally or by interruption). */
function closeTurn(state: TranscriptState, interrupted: boolean): TranscriptState {
  const interviewerIdx = indexOf(state, state.openInterviewer);
  const candidateIdx = indexOf(state, state.openCandidate);
  let next = state;
  if (interviewerIdx >= 0) {
    next = finalize(next, "interviewer", interrupted ? { interrupted: true } : {});
    // Candidate entry that preceded the reply is complete; a later one is
    // barge-in speech still in progress.
    if (candidateIdx >= 0 && candidateIdx < interviewerIdx) {
      next = finalize(next, "candidate");
    }
  } else if (!interrupted && candidateIdx >= 0) {
    // Turn completed without any spoken output: the candidate turn is over.
    next = finalize(next, "candidate");
  }
  return next;
}

export function reduceTranscript(
  state: TranscriptState,
  event: TranscriptEvent,
): TranscriptState {
  switch (event.type) {
    case "input":
      return append(state, "candidate", event.text, event.finished);
    case "output":
      return append(state, "interviewer", event.text, event.finished);
    case "interrupted":
      return closeTurn(state, true);
    case "turnComplete":
      return closeTurn(state, false);
    case "finalizeAll":
      return finalize(finalize(state, "interviewer"), "candidate");
  }
}
