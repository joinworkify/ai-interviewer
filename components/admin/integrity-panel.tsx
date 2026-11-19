import type { AttemptDetail } from "@/lib/admin/data";
import { KIND_LABELS, type IntegrityLevel } from "@/lib/integrity/events";

import { RunAudioReviewButton } from "./run-audio-review-button";

const LEVEL: Record<IntegrityLevel, { label: string; className: string }> = {
  none: { label: "No signals", className: "bg-green-100 text-green-800" },
  low: { label: "Low", className: "bg-blue-100 text-blue-800" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-800" },
  high: { label: "High", className: "bg-red-100 text-red-800" },
};

const AUDIO_FAILURE: Record<string, string> = {
  no_recording: "There is no recording to review.",
  too_large: "The recording is too large to review.",
  not_configured: "Audio review is not configured on the server.",
  audio_failed: "The model could not review the audio (the format may be unsupported).",
};

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** What the browser saw, the setup photo and the model's listen to the recording. Hints for a person, not verdicts. */
export function IntegrityPanel({ a }: { a: AttemptDetail }) {
  const { events, summary } = a.integrity;
  const level = LEVEL[summary.level];
  const audio = a.audioReview;
  return (
    <div className="grid gap-5">
      <p className="text-xs text-muted-foreground">
        Signals to weigh, not proof. A notification, a call or a weak connection can all look like leaving the interview.
      </p>

      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-3 py-1 font-ui text-xs font-semibold ${level.className}`}>
            Browser signals: {level.label}
          </span>
          {summary.awayMs > 0 && <span className="text-sm">Away from the tab for {clock(summary.awayMs)} in total</span>}
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing was reported during the call.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {events.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-12 font-mono text-xs text-muted-foreground">{clock(e.atMs)}</span>
                <span>
                  {KIND_LABELS[e.kind]}
                  {e.durationMs ? ` for ${clock(e.durationMs)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Setup photo</h3>
        {a.identityPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not an optimizable asset
          <img src={a.identityPhotoUrl} alt="Candidate setup photo" width={240} className="rounded-md border" />
        ) : (
          <p className="text-sm text-muted-foreground">The candidate skipped the photo, or the camera was unavailable.</p>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Audio review</h3>
        {!audio ? (
          <p className="text-sm text-muted-foreground">
            {a.recording ? "Not reviewed yet. It runs automatically after the recording uploads." : "There is no recording to review."}
          </p>
        ) : audio.status === "failed" ? (
          <p className="text-sm text-muted-foreground">Not reviewed. {AUDIO_FAILURE[audio.errorCode ?? ""] ?? "The review failed."}</p>
        ) : (
          <div className="grid gap-2 text-sm">
            <p>
              Second voice heard: <strong>{audio.secondVoice ? "Possible" : "Not detected"}</strong>
              {" · "}
              Reading aloud: <strong>{audio.readingAloud ? "Possible" : "Not detected"}</strong>
            </p>
            <p className="text-muted-foreground">{audio.notes}</p>
            {audio.overall !== null && a.evaluation?.overallScore != null && (
              <p>
                Score judged from the audio: <strong>{audio.overall}</strong> (transcript-based: {a.evaluation.overallScore}).
                {Math.abs(audio.overall - a.evaluation.overallScore) >= 15 && (
                  <span className="ml-1 font-medium text-amber-800">
                    These differ a lot; the transcript may have misheard the candidate, so read it alongside the recording.
                  </span>
                )}
              </p>
            )}
          </div>
        )}
        {a.recording && <RunAudioReviewButton sessionId={a.sessionId} hasReview={audio?.status === "completed"} />}
      </div>
    </div>
  );
}
