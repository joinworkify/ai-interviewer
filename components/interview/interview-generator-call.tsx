"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type VapiClient from "@vapi-ai/web";
import { Button } from "@/components/ui/button";
import { describeVapiError } from "@/lib/interviews/vapi-errors";

type CallStatus =
  | "idle"
  | "authorizing" // fetching a capability from our server
  | "connecting" // vapi.start() in flight
  | "active"
  | "ending"
  | "ended"
  | "error";

interface TranscriptLine {
  role: "assistant" | "user";
  text: string;
}

interface Props {
  publicKey: string;
  assistantId: string;
}

const STATUS_LABEL: Record<CallStatus, string> = {
  idle: "Ready",
  authorizing: "Preparing session…",
  connecting: "Connecting…",
  active: "In call",
  ending: "Ending…",
  ended: "Call ended",
  error: "Error",
};

/**
 * Starts a web call with the saved Vapi Generator Assistant. The assistant
 * collects role/level/type/techstack/amount by voice and calls our API
 * Request tool, which receives the signed capability via the
 * `{{generationToken}}` dynamic variable.
 */
export function InterviewGeneratorCall({ publicKey, assistantId }: Props) {
  const router = useRouter();
  const vapiRef = useRef<VapiClient | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);
  const statusRef = useRef<CallStatus>("idle");

  const [status, setStatusState] = useState<CallStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<TranscriptLine | null>(null);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);

  // Read through a function so TypeScript doesn't narrow a value that
  // changes across awaits (listeners/stop() mutate it concurrently).
  const currentStatus = useCallback((): CallStatus => statusRef.current, []);

  const setStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatusState(next);
  }, []);

  const teardown = useCallback(async () => {
    detachRef.current?.();
    detachRef.current = null;
    const vapi = vapiRef.current;
    vapiRef.current = null;
    if (vapi) {
      try {
        await vapi.stop();
      } catch {
        // Already stopped / never connected.
      }
    }
  }, []);

  // Stop the call and remove listeners when the page unmounts.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void teardown();
    };
  }, [teardown]);

  const fail = useCallback(
    (message: string) => {
      if (!mountedRef.current) return;
      setError(message);
      setAssistantSpeaking(false);
      setPartial(null);
      setStatus("error");
      void teardown();
    },
    [setStatus, teardown],
  );

  const start = useCallback(async () => {
    if (!["idle", "ended", "error"].includes(statusRef.current)) return;
    setError(null);
    setLines([]);
    setPartial(null);
    setStatus("authorizing");

    // 1. Ask our server for a short-lived capability bound to this session.
    let token: string;
    try {
      const res = await fetch("/api/interviews/capability", {
        method: "POST",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as {
        token?: string;
        message?: string;
      } | null;
      if (!res.ok || !body?.token) {
        fail(
          body?.message ??
            `Could not start the interview session (HTTP ${res.status}).`,
        );
        return;
      }
      token = body.token;
    } catch {
      fail("Could not reach the server to start the interview session.");
      return;
    }
    if (!mountedRef.current || statusRef.current !== "authorizing") return;

    // 2. Create the Vapi client lazily (browser-only SDK) and attach listeners.
    let vapi: VapiClient;
    try {
      const { default: Vapi } = await import("@vapi-ai/web");
      vapi = new Vapi(publicKey);
    } catch (err) {
      fail(`Could not load the Vapi Web SDK: ${describeVapiError(err)}`);
      return;
    }
    if (!mountedRef.current || statusRef.current !== "authorizing") return;

    const onCallStart = () => setStatus("active");
    const onCallEnd = () => {
      detachRef.current?.();
      detachRef.current = null;
      vapiRef.current = null;
      setAssistantSpeaking(false);
      setPartial(null);
      if (statusRef.current !== "error") setStatus("ended");
      // Show any interview the tool saved during the call.
      router.refresh();
    };
    const onSpeechStart = () => setAssistantSpeaking(true);
    const onSpeechEnd = () => setAssistantSpeaking(false);
    const onMessage = (message: unknown) => {
      const m = message as {
        type?: string;
        role?: string;
        transcriptType?: string;
        transcript?: string;
      };
      if (m?.type !== "transcript" || typeof m.transcript !== "string") return;
      const role = m.role === "user" ? "user" : "assistant";
      if (m.transcriptType === "final") {
        setPartial(null);
        setLines((prev) => [...prev, { role, text: m.transcript as string }]);
      } else {
        setPartial({ role, text: m.transcript });
      }
    };
    const onError = (err: unknown) => fail(describeVapiError(err));

    vapi.on("call-start", onCallStart);
    vapi.on("call-end", onCallEnd);
    vapi.on("speech-start", onSpeechStart);
    vapi.on("speech-end", onSpeechEnd);
    vapi.on("message", onMessage);
    vapi.on("error", onError);
    detachRef.current = () => {
      vapi.removeListener("call-start", onCallStart);
      vapi.removeListener("call-end", onCallEnd);
      vapi.removeListener("speech-start", onSpeechStart);
      vapi.removeListener("speech-end", onSpeechEnd);
      vapi.removeListener("message", onMessage);
      vapi.removeListener("error", onError);
    };
    vapiRef.current = vapi;

    // 3. Start the saved assistant. The token reaches the API Request tool
    //    via the {{generationToken}} variable; no user id is sent.
    setStatus("connecting");
    try {
      const call = await vapi.start(assistantId, {
        variableValues: { generationToken: token },
      });
      if (!call && currentStatus() === "connecting") {
        fail(
          "Vapi did not start the call. Check the assistant ID and public key.",
        );
      }
    } catch (err) {
      // Ignore rejections caused by the user ending the call mid-connect.
      const s = currentStatus();
      if (s === "connecting" || s === "active") {
        fail(describeVapiError(err));
      }
    }
  }, [assistantId, currentStatus, fail, publicKey, router, setStatus]);

  const stop = useCallback(async () => {
    if (!["connecting", "active"].includes(statusRef.current)) return;
    setStatus("ending");
    const vapi = vapiRef.current;
    try {
      await vapi?.stop();
    } catch (err) {
      fail(describeVapiError(err));
      return;
    }
    // If the SDK didn't emit call-end (e.g. stopped while connecting),
    // finalize locally.
    if (currentStatus() === "ending") {
      await teardown();
      setAssistantSpeaking(false);
      setPartial(null);
      setStatus("ended");
      router.refresh();
    }
  }, [currentStatus, fail, router, setStatus, teardown]);

  const busy = ["authorizing", "connecting", "active", "ending"].includes(
    status,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button
            variant="destructive"
            onClick={stop}
            disabled={status === "authorizing" || status === "ending"}
          >
            End call
          </Button>
        ) : (
          <Button onClick={start}>
            {status === "idle" ? "Start interview setup call" : "Start again"}
          </Button>
        )}
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {STATUS_LABEL[status]}
          {status === "active" && (assistantSpeaking ? " · assistant speaking" : " · listening")}
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {(lines.length > 0 || partial) && (
        <div className="max-h-80 overflow-y-auto rounded-md border p-3 text-sm flex flex-col gap-2">
          {lines.map((line, i) => (
            <p key={i}>
              <span className="font-semibold">
                {line.role === "assistant" ? "Assistant" : "You"}:
              </span>{" "}
              {line.text}
            </p>
          ))}
          {partial && (
            <p className="text-muted-foreground italic">
              <span className="font-semibold">
                {partial.role === "assistant" ? "Assistant" : "You"}:
              </span>{" "}
              {partial.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
