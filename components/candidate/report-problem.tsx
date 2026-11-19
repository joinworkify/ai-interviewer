"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ProblemKind } from "@/lib/candidate/problem-reports";
import { whenOnline } from "@/lib/http/online";

const KINDS: { value: ProblemKind; label: string }[] = [
  { value: "lost_internet", label: "Lost internet" },
  { value: "microphone", label: "Microphone problem" },
  { value: "audio", label: "Couldn't hear the interviewer" },
  { value: "other", label: "Other" },
];

type Status = "idle" | "waiting" | "sending" | "sent" | "failed";

/**
 * Lets the candidate tell DataSea about a problem with this interview. If the
 * browser is offline, the report waits and is sent when the connection is back.
 */
export function ReportProblem({
  sessionId,
  initialKind = "lost_internet",
  defaultOpen = false,
}: {
  sessionId: string;
  initialKind?: ProblemKind;
  defaultOpen?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [kind, setKind] = useState<ProblemKind>(initialKind);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function send() {
    setError("");
    for (let tries = 0; tries < 3; tries++) {
      if (!navigator.onLine) setStatus("waiting");
      await whenOnline();
      setStatus("sending");
      try {
        const res = await fetch(`/api/candidate/attempts/${encodeURIComponent(sessionId)}/report`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, message }),
        });
        if (res.ok) return setStatus("sent");
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "Could not send your report. Please try again.");
        return setStatus("failed");
      } catch {
        // Network error: wait for the connection and try again.
      }
    }
    setError("Could not send your report. Please check your connection and try again.");
    setStatus("failed");
  }

  if (status === "sent") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Thanks, the DataSea team will review this.
      </p>
    );
  }
  if (!open) {
    return (
      <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    );
  }
  const busy = status === "sending" || status === "waiting";
  return (
    <form
      className="flex w-full flex-col gap-2 rounded-md border p-3 text-left text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label htmlFor={`${id}-kind`} className="font-medium">
        What went wrong?
      </label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(e) => setKind(e.target.value as ProblemKind)}
        className="rounded-md border bg-background px-2 py-1.5"
      >
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-message`} className="font-medium">
        Tell us more (optional)
      </label>
      <textarea
        id={`${id}-message`}
        value={message}
        maxLength={1000}
        rows={3}
        onChange={(e) => setMessage(e.target.value)}
        className="rounded-md border bg-background px-2 py-1.5"
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {status === "waiting" && (
        <p role="status" className="text-muted-foreground">
          You&apos;re offline. We&apos;ll send this when your internet is back.
        </p>
      )}
      <Button type="submit" size="sm" disabled={busy} className="self-start">
        {status === "sending" ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}
