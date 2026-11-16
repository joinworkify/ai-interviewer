"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getProgress } from "@/lib/candidate/progress-client";
import { redirectFor, type GuardedStep } from "@/lib/candidate/steps";

type GateState = "checking" | "open" | "failed";

/**
 * Opens a step only when the server agrees it is the candidate's turn: a step
 * opened out of order redirects instead of rendering, so nothing (mic, call,
 * second attempt) starts early. Fails closed: if progress cannot be checked the
 * step does not open.
 */
export function StepGate({ step, children }: { step: GuardedStep; children: React.ReactNode }) {
  const params = useSearchParams();
  const roleId = params.get("role");
  const attemptId = params.get("attempt");
  const router = useRouter();
  const [state, setState] = useState<GateState>("checking");
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState("checking");
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const decide = (target: string | null) => {
      if (controller.signal.aborted) return;
      if (target) router.replace(target);
      else setState("open");
    };

    if (!roleId) {
      // Nothing to look up; the page itself explains a missing role.
      decide(redirectFor(step, null, attemptId));
    } else {
      getProgress(roleId, fetch, controller.signal).then(
        (progress) => decide(redirectFor(step, progress, attemptId)),
        () => {
          if (!controller.signal.aborted) setState("failed");
        },
      );
    }
    return () => controller.abort();
  }, [step, roleId, attemptId, router, attempt]);

  if (state === "failed") {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-sm">
        <p className="text-destructive">We couldn&apos;t check where you are in the application.</p>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
          <Link href="/candidate/roles" className="underline">
            Back to roles
          </Link>
        </div>
      </div>
    );
  }
  if (state === "checking") {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" aria-label="Checking your progress" />;
  }
  return <>{children}</>;
}
