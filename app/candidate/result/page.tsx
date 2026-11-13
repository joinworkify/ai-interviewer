"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { waitForResult, type AttemptResult } from "@/lib/candidate/api";

const STATUS_TEXT: Partial<Record<AttemptResult["status"], string>> = {
  submitted: "Submitted",
  under_review: "Under review",
  reviewed: "Reviewed",
  incomplete: "Incomplete",
};

export default function ResultPage() {
  const attemptId = useSearchParams().get("attempt") ?? "";
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [failed, setFailed] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // The result is the real state of the stored attempt. The transcript reaches
  // us a few seconds after the call ends, so this waits for it.
  const load = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFailed(false);
    setResult(null);
    waitForResult(attemptId, { signal: controller.signal }).then(
      (r) => {
        if (!controller.signal.aborted) setResult(r);
      },
      () => {
        if (!controller.signal.aborted) setFailed(true);
      },
    );
  }, [attemptId]);
  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-xl border bg-card p-8 text-center shadow-sm">
      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 text-sm">
          <p className="text-destructive">Could not load the result. Your attempt is already saved.</p>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      ) : !result ? (
        <p className="text-sm text-muted-foreground" aria-busy="true" aria-live="polite">
          Finishing up. This can take a minute...
        </p>
      ) : result.status === "processing" ? (
        <div className="flex flex-col items-center gap-3 text-sm" aria-live="polite">
          <h1 className="text-3xl font-bold tracking-tight">Still processing</h1>
          <p>
            Your interview ended and your answers are saved. Processing is taking longer than usual; you
            can leave this page or check again.
          </p>
          <Button variant="outline" onClick={load}>
            Check again
          </Button>
        </div>
      ) : result.status === "incomplete" ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Your interview didn&apos;t finish</h1>
          <p className="text-sm">{result.summary}</p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Interview complete</h1>
          <p className="text-sm">Thank you. Your interview was submitted.</p>
          <div className="w-full rounded-md border p-4 text-left text-sm">
            <p>Status: {STATUS_TEXT[result.status] ?? result.status}</p>
            <p>Summary: {result.summary}</p>
          </div>
          <p className="text-xs text-muted-foreground">A person at DataSea will review it.</p>
        </>
      )}
      <Button asChild className="w-32">
        <Link href="/candidate/roles">Done</Link>
      </Button>
    </div>
  );
}
