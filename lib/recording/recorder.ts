/**
 * Browser-only: records the whole interview (the candidate's microphone and
 * the interviewer's voice, mixed to one track) with MediaRecorder, then hands
 * back one small audio Blob. Nothing here runs at module load.
 *
 * The recorder mixes the two streams in its own AudioContext, so it never
 * touches the audio the interview itself uses.
 */

/** Opus keeps speech clear at a size that uploads quickly (about 0.4 MB/min). */
const AUDIO_BITS_PER_SECOND = 48_000;
const TIMESLICE_MS = 5_000;

/** Best supported type first. Safari only does mp4; the rest do webm/ogg. */
const CANDIDATE_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

/** `audio/webm;codecs=opus` -> `audio/webm` (what the server stores and checks). */
export function baseMimeType(type: string): string {
  return type.split(";")[0].trim().toLowerCase();
}

export function pickRecordingType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATE_TYPES.find((t) => isSupported(t)) ?? null;
}

export interface InterviewRecorder {
  /** Stops recording and resolves the audio, or null when nothing was captured. */
  stop(): Promise<Blob | null>;
}

/** Starts recording the given streams; null when the browser cannot record. */
export function startInterviewRecorder(streams: readonly MediaStream[]): InterviewRecorder | null {
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined" ||
    typeof window.AudioContext !== "function"
  ) {
    return null;
  }
  const withAudio = streams.filter((s) => s.getAudioTracks().length > 0);
  if (withAudio.length === 0) return null;
  const mimeType = pickRecordingType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) return null;

  let ctx: AudioContext | undefined;
  try {
    ctx = new AudioContext();
    const mix = ctx.createMediaStreamDestination();
    const sources = withAudio.map((s) => {
      const node = ctx!.createMediaStreamSource(s);
      node.connect(mix);
      return node;
    });
    void ctx.resume().catch(() => {});

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(mix.stream, { mimeType, audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.start(TIMESLICE_MS);

    const context = ctx;
    let result: Promise<Blob | null> | undefined;
    return {
      stop() {
        result ??= new Promise<Blob | null>((resolve) => {
          const finish = () => {
            for (const s of sources) {
              try {
                s.disconnect();
              } catch {
                // already disconnected
              }
            }
            void context.close().catch(() => {});
            resolve(chunks.length > 0 ? new Blob(chunks, { type: baseMimeType(mimeType) }) : null);
          };
          if (recorder.state === "inactive") return finish();
          recorder.onstop = finish;
          try {
            recorder.stop();
          } catch {
            finish();
          }
        });
        return result;
      },
    };
  } catch {
    void ctx?.close().catch(() => {});
    return null;
  }
}
