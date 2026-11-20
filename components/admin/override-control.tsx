"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_REASON } from "@/lib/evaluation/overrides";

/** A reviewer adjusts one criterion's score and must say why. The AI score stays visible. */
export function OverrideControl({
  sessionId,
  criterion,
  current,
  overridden,
}: {
  sessionId: string;
  criterion: string;
  current: number | null;
  overridden: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(current === null ? "" : String(current));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/overrides`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(method === "POST" ? { criterion, score: Number(score), reason } : { criterion }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? "Could not save.");
        return;
      }
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex gap-3 text-xs">
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-primary hover:underline">
          {overridden ? "Change override" : "Override score"}
        </button>
        {overridden && (
          <button type="button" onClick={() => void send("DELETE")} disabled={busy} className="text-muted-foreground hover:underline">
            Reset to AI score
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded-lg border bg-white p-3 text-sm dark:bg-background">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium" htmlFor={`ov-score-${criterion}`}>
          New score (0-100)
        </label>
        <input
          id={`ov-score-${criterion}`}
          inputMode="numeric"
          value={score}
          onChange={(e) => setScore(e.target.value.replace(/\D/g, "").slice(0, 3))}
          className="h-9 w-20 rounded-md border bg-white px-2 dark:bg-background"
        />
      </div>
      <textarea
        aria-label={`Reason for changing ${criterion}`}
        rows={2}
        maxLength={MAX_REASON}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is the AI score wrong? (required)"
        className="rounded-md border bg-white px-3 py-2 dark:bg-background"
      />
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void send("POST")}
          disabled={busy || score === "" || reason.trim() === ""}
          className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save override"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-md border px-3 text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}
