"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INTERVIEW_LEVELS,
  MAX_ROLE_LENGTH,
  validateLiveInterviewBody,
  type InterviewLevel,
} from "@/lib/gemini-live/interview-details";
import {
  loadDograhWidget,
  requestDograhSession,
  waitForSessionSaved,
  type DograhWidgetApi,
} from "@/lib/dograh/widget-client";

type Phase =
  | "idle"
  | "preparing"
  | "connecting"
  | "active"
  | "saving"
  | "saved"
  | "save_timeout"
  | "error";

const STATUS_LABEL: Record<Phase, string> = {
  idle: "Ready",
  preparing: "Preparing a secure session…",
  connecting: "Connecting to the interviewer…",
  active: "Interview in progress",
  saving: "Interview ended. Waiting for the transcript…",
  saved: "Transcript saved.",
  save_timeout:
    "Interview ended. The transcript has not arrived yet. Reload this page in a minute to check.",
  error: "Error",
};

const BUSY: ReadonlySet<Phase> = new Set(["preparing", "connecting", "active", "saving"]);

interface Props {
  /** Interview session the transcript is saved to. Required: the call is tied to it. */
  sessionId: string | null;
  /** Dograh widget script URL, or null when the server is not configured. */
  widgetSrc: string | null;
}

export function DograhInterview({ sessionId, widgetSrc }: Props) {
  const [role, setRole] = useState("");
  const [level, setLevel] = useState<InterviewLevel>("mid");
  const [techstack, setTechstack] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const widgetRef = useRef<DograhWidgetApi | null>(null);
  const subscribedRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const update = useCallback((next: Phase, message: string | null = null) => {
    phaseRef.current = next;
    if (!mountedRef.current) return;
    setPhase(next);
    setError(message);
  }, []);

  const afterCall = useCallback(() => {
    // Disconnect and end callbacks can both fire; only the first one counts.
    if (phaseRef.current !== "active" && phaseRef.current !== "connecting") return;
    if (!sessionId) return update("idle");
    update("saving");
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void waitForSessionSaved(sessionId, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || !mountedRef.current) return;
      update(result === "saved" ? "saved" : "save_timeout");
    });
  }, [sessionId, update]);

  const subscribe = useCallback(
    (widget: DograhWidgetApi) => {
      if (subscribedRef.current) return;
      subscribedRef.current = true;
      widget.onCallConnected?.(() => {
        if (phaseRef.current === "connecting") update("active");
      });
      widget.onCallDisconnected?.(afterCall);
      widget.onCallEnd?.(() => {
        // onCallEnd also fires for attempts that never connected.
        if (phaseRef.current === "active") afterCall();
        else if (phaseRef.current === "connecting") {
          update("error", "The call could not be started. Check your microphone and try again.");
        }
      });
      widget.onStatusChange?.((status) => {
        if (status === "failed" && BUSY.has(phaseRef.current)) {
          update("error", "The voice connection failed. Try again.");
        }
      });
      // The raw error can quote request details; show a fixed message.
      widget.onError?.(() => {
        if (BUSY.has(phaseRef.current)) update("error", "The voice call failed. Try again.");
      });
    },
    [afterCall, update],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (phaseRef.current === "active" || phaseRef.current === "connecting") {
        try {
          widgetRef.current?.end();
        } catch {
          // The page is going away; nothing to report.
        }
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (BUSY.has(phaseRef.current) || !sessionId || !widgetSrc) return;
    const checked = validateLiveInterviewBody({ role, level, techstack, sessionId });
    if (!checked.ok) {
      update("error", checked.errors.join(" "));
      return;
    }
    update("preparing");
    const session = await requestDograhSession({ sessionId, role, level, techstack });
    if (!session.ok) {
      update("error", session.message);
      return;
    }
    let widget: DograhWidgetApi;
    try {
      widget = await loadDograhWidget(widgetSrc);
    } catch {
      update("error", "Could not load the voice widget. Check that Dograh is running.");
      return;
    }
    widgetRef.current = widget;
    subscribe(widget);
    update("connecting");
    try {
      widget.setContext(session.contextVariables);
      await widget.start();
    } catch {
      update("error", "The call could not be started. Check your microphone and try again.");
    }
  }, [level, role, sessionId, subscribe, techstack, update, widgetSrc]);

  const end = useCallback(() => {
    try {
      widgetRef.current?.end();
    } catch {
      update("error", "Could not end the call cleanly. Close this tab to stop it.");
    }
  }, [update]);

  const busy = BUSY.has(phase);
  const ready = Boolean(sessionId && widgetSrc);

  return (
    <div className="flex flex-col gap-6">
      <div
        role="note"
        className="flex flex-col gap-1 rounded-md border border-yellow-500/50 bg-yellow-500/10 p-4 text-sm"
      >
        <p className="font-semibold">Before you start</p>
        <ul className="list-disc pl-5 flex flex-col gap-1">
          <li>
            Your voice goes to the Dograh service this app is connected to. Dograh keeps its own copy of the
            call transcript and may keep a recording.
          </li>
          <li>
            The transcript is saved to your interview session when the call ends. It is machine generated and
            may be inaccurate. This is practice only, not authoritative hiring evidence.
          </li>
          <li>Headphones are recommended to avoid echo.</li>
        </ul>
      </div>

      {!sessionId && (
        <p role="alert" className="text-sm text-destructive">
          Open this page with a session link (<code>?sessionId=…</code>). The call is tied to one of your
          interview sessions.
        </p>
      )}

      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="dg-role">Role</Label>
          <Input
            id="dg-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Backend Engineer"
            maxLength={MAX_ROLE_LENGTH}
            required
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dg-level">Experience level</Label>
          <select
            id="dg-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as InterviewLevel)}
            disabled={busy}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {INTERVIEW_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="dg-stack">Tech stack (comma-separated)</Label>
          <Input
            id="dg-stack"
            value={techstack}
            onChange={(e) => setTechstack(e.target.value)}
            placeholder="e.g. Go, PostgreSQL, Kubernetes"
            maxLength={400}
            required
            disabled={busy}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
          {/* Distinct keys so React never turns the End button into the submit button. */}
          {phase === "active" || phase === "connecting" ? (
            <Button key="end" type="button" variant="destructive" onClick={end}>
              End interview
            </Button>
          ) : (
            <Button key="start" type="submit" disabled={!ready || busy}>
              {phase === "idle" ? "Start interview" : "Start again"}
            </Button>
          )}
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {STATUS_LABEL[phase]}
          </span>
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </div>
  );
}
