"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Has the model listen to the recording (or listen again), then refreshes the page. */
export function RunAudioReviewButton({ sessionId, hasReview }: { sessionId: string; hasReview: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/audio-review`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? "Could not review the audio.");
      else router.refresh();
    } catch {
      setError("Could not review the audio.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={run}
        disabled={busy}
        className="h-9 rounded-md border bg-white px-3 font-ui text-sm font-medium hover:border-primary disabled:opacity-50 dark:bg-background"
      >
        {busy ? "Listening…" : hasReview ? "Review audio again" : "Review audio now"}
      </button>
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
