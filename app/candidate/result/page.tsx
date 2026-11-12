"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getResult, type AttemptResult } from "@/lib/candidate/api";

const STATUS_TEXT: Partial<Record<AttemptResult["status"], string>> = {
  submitted: "Submitted",
  under_review: "Under review",
  reviewed: "Reviewed",
  incomplete: "Incomplete",
};

export default function ResultPage() {
  const params = useSearchParams();
  const attemptId = params.get("attempt") ?? "";
  const ended = params.get("ended") === "early" ? "early" : "complete";
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getResult(attemptId, ended).then(setResult, () => setFailed(true));
  }, [attemptId, ended]);
  useEffect(load, [load]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 rounded-xl border bg-card p-8 text-center shadow-sm">
      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 text-sm">
          <p className="text-destructive">Could not load result. Your attempt is already saved.</p>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      ) : !result ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Submitting...
        </p>
      ) : result.status === "incomplete" ? (
        <>
          <h1 className="text-3xl font-bold tracking-tight">Your interview didn&apos;t finish</h1>
          <p className="text-sm">
            {result.summary}
            {result.nextAttemptOn && ` Next attempt: ${result.nextAttemptOn}.`}
          </p>
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
