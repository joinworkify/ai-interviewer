"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getRole } from "@/lib/candidate/api";
import { interviewDetailsForRole } from "@/lib/candidate/interview-details";
import { browserControllerDeps } from "@/lib/gemini-live/browser";
import { LiveInterviewController, type SessionPhase } from "@/lib/gemini-live/controller";
import { MAX_SESSION_SECONDS, validateLiveInterviewBody, type LiveInterviewDetails } from "@/lib/gemini-live/interview-details";
import { attachTranscriptSync } from "@/lib/gemini-live/transcript-sync";
import type { SaveTranscriptOutcome } from "@/lib/transcripts/client";

const STATUS_LABEL: Record<SessionPhase, string> = {
  idle: "Ready",
  microphone: "Waiting for your microphone…",
  authorizing: "Preparing your interview…",
  connecting: "Connecting to the interviewer…",
  active: "Interview in progress",
  closing: "Interviewer is wrapping up…",
  ended: "Interview ended",
  error: "Something went wrong",
};

const RUNNING: ReadonlySet<SessionPhase> = new Set(["microphone", "authorizing", "connecting", "active", "closing"]);

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The candidate's voice interview on Gemini Live. The token route builds the
 * interviewer's instructions on the server from this attempt's stored
 * questions (written from the role and the candidate's resume); the browser
 * only sends the role details and the attempt id, which the route checks
 * against the signed-in user. The transcript is saved to the attempt when the
 * call ends, which is what the admin page and the result page read.
 */
export function GeminiInterview() {
  const params = useSearchParams();
  const attemptId = params.get("attempt");
  const roleId = params.get("role");
  const router = useRouter();

  const [controller] = useState(() => new LiveInterviewController(browserControllerDeps));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [details, setDetails] = useState<LiveInterviewDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SaveTranscriptOutcome | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLDivElement>(null);

  // Stop the mic, socket and audio when leaving the page.
  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    if (!attemptId) return;
    return attachTranscriptSync(controller, { sessionId: attemptId, onOutcome: setSaved });
  }, [controller, attemptId]);

  // Tab close: end the call so the transcript is still sent (keepalive).
  useEffect(() => {
    const onPageHide = () => {
      if (RUNNING.has(controller.getSnapshot().phase)) controller.dispose();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [controller]);

  useEffect(() => {
    if (!attemptId || !roleId) return;
    getRole(roleId).then(
      (role) => {
        const result = validateLiveInterviewBody({ ...interviewDetailsForRole(role), sessionId: attemptId });
        if (result.ok) setDetails(result.data);
        else setLoadError("This role can't be interviewed right now. Please contact DataSea.");
      },
      () => setLoadError("Couldn't load this role. Please go back and try again."),
    );
  }, [attemptId, roleId]);

  // Keep the newest words in view as the conversation grows.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [state.transcript]);

  const timing = state.phase === "active" || state.phase === "closing";
  useEffect(() => {
    if (!timing) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [timing]);

  // Ended and the transcript went (or could not go) to the server: show the result.
  useEffect(() => {
    if (state.phase !== "ended" || saved === null || !attemptId) return;
    const t = setTimeout(() => router.push(`/candidate/result?attempt=${encodeURIComponent(attemptId)}`), 1200);
    return () => clearTimeout(t);
  }, [state.phase, saved, attemptId, router]);

  const roleHref = roleId ? `/candidate/roles/${encodeURIComponent(roleId)}` : "/candidate/roles";

  if (!attemptId) {
    return (
      <p className="text-center text-sm">
        No interview in progress.{" "}
        <Link href="/candidate/roles" className="underline">
          Go to roles
        </Link>
      </p>
    );
  }

  const error = loadError ?? state.error;
  if (error) {
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
        <p className="text-lg font-semibold">The interview could not continue.</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild>
          <Link href={roleHref}>Back to the role</Link>
        </Button>
      </div>
    );
  }

  const running = RUNNING.has(state.phase);
  const elapsed = state.startedAt === null ? 0 : (timing ? now : (state.endedAt ?? now)) - state.startedAt;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={state.phase === "active" ? "default" : "secondary"} className="w-fit" aria-live="polite">
          {STATUS_LABEL[state.phase]}
        </Badge>
        {state.startedAt !== null && (
          <span className="font-mono text-sm tabular-nums" aria-label="Elapsed time">
            {clock(elapsed)} / {clock(MAX_SESSION_SECONDS * 1000)}
          </span>
        )}
      </div>

      <div className="flex flex-col items-center gap-6 rounded-xl border bg-card p-8 shadow-sm">
        <div
          className={`flex h-32 w-32 items-center justify-center rounded-full bg-primary/10 ${
            state.interviewerSpeaking ? "animate-pulse ring-4 ring-primary/40" : ""
          }`}
        >
          <Bot className="h-12 w-12" aria-hidden="true" />
        </div>

        {state.phase === "idle" ? (
          <div className="flex max-w-md flex-col items-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">
              The AI interviewer will ask you a few questions about this role and your experience, one at a time. Answer
              out loud, in English. Headphones help avoid echo.
            </p>
            <Button size="lg" disabled={!details} onClick={() => details && void controller.start(details)}>
              {details ? "Start interview" : <Loader2 className="animate-spin" aria-label="Loading" />}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {state.phase === "active"
                ? state.interviewerSpeaking
                  ? "AI interviewer speaking…"
                  : "Your turn to answer"
                : state.phase === "ended"
                  ? saved === "failed"
                    ? "We couldn't save your interview. Please contact DataSea."
                    : "Thank you. Saving your interview…"
                  : STATUS_LABEL[state.phase]}
            </p>
            <div
              ref={logRef}
              role="log"
              aria-label="Conversation"
              className="flex max-h-80 w-full flex-col gap-2 overflow-y-auto rounded-md border bg-muted/40 p-3 text-sm"
            >
              {state.transcript.length === 0 ? (
                <p className="text-muted-foreground">The conversation will appear here as you talk.</p>
              ) : (
                state.transcript.map((entry) => {
                  const mine = entry.speaker === "candidate";
                  return (
                    <div
                      key={entry.id}
                      className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                        mine ? "self-end bg-primary text-primary-foreground" : "self-start bg-background"
                      } ${entry.final ? "" : "opacity-80"}`}
                    >
                      <span className="sr-only">{mine ? "You said: " : "Interviewer said: "}</span>
                      {entry.text}
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {running && (
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("End the interview now? It will count as an attempt.")) controller.end();
            }}
          >
            End interview
          </Button>
        )}
      </div>
    </div>
  );
}
