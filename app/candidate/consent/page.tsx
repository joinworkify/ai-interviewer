"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { StepGate } from "@/components/candidate/step-gate";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ApiError, getInstructions, giveConsentAndCreateAttempt } from "@/lib/candidate/api";
import { CONSENT_LABEL, CONSENT_POINTS } from "@/lib/candidate/consent";
import { setupPath, stepHref } from "@/lib/candidate/steps";

export default function ConsentPage() {
  return (
    <StepGate step="consent">
      <ConsentStep />
    </StepGate>
  );
}

function ConsentStep() {
  const params = useSearchParams();
  const roleId = params.get("role") ?? "";
  // Set when the candidate came back here after consenting: the gate only lets
  // this page open with the attempt that is still open.
  const acceptedAttempt = params.get("attempt");
  const router = useRouter();
  const [instructions, setInstructions] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [agreedNow, setAgreed] = useState(false);
  // Derived, not stored: Next can keep this page mounted between visits, so
  // state from an earlier visit (e.g. "saving") must not leak into this one.
  const agreed = acceptedAttempt !== null || agreedNow;
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    getInstructions(roleId).then(setInstructions, () => setLoadError(true));
  }, [roleId]);

  async function onContinue() {
    // Already agreed: carry on with that attempt; never create a second one.
    if (acceptedAttempt) {
      router.push(setupPath(acceptedAttempt, roleId));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const { attemptId } = await giveConsentAndCreateAttempt(roleId);
      router.push(
        `/candidate/setup?attempt=${encodeURIComponent(attemptId)}&role=${encodeURIComponent(roleId)}`,
      );
    } catch (err) {
      // Keep the tick so they can just retry. An outdated page needs a reload instead.
      setSaveError(
        err instanceof ApiError && (err.code === "CONSENT_OUTDATED" || err.code === "ATTEMPT_LIMIT")
          ? err.message
          : "Couldn't save your consent. Please try again.",
      );
      setSaving(false);
    }
  }

  // Instructions are required: you can't consent to text you haven't seen.
  if (loadError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 text-sm">
        <p className="text-destructive">Couldn&apos;t load the instructions for this role.</p>
        <Link href="/candidate/roles" className="underline">
          Back to roles
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 rounded-xl border bg-card p-8 shadow-sm">
      <h1 className="text-center text-3xl font-bold tracking-tight">Before we start</h1>
      {instructions === null ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : (
        <div className="rounded-lg border bg-muted/40 p-5 text-[15px] leading-7">
          {instructions}
        </div>
      )}
      <ul className="ml-5 list-disc space-y-3 pl-5 text-[15px] leading-7 marker:text-muted-foreground">
        {CONSENT_POINTS.map((point) => (
          <li key={point} className="pl-1">
            {point}
          </li>
        ))}
      </ul>
      <div className="flex items-start gap-3 rounded-lg border p-5">
        <Checkbox
          id="consent"
          className="mt-1"
          checked={agreed}
          disabled={instructions === null || acceptedAttempt !== null}
          onCheckedChange={(v) => setAgreed(v === true)}
        />
        <Label
          htmlFor="consent"
          className="text-[15px] font-medium leading-6 [font-family:inherit]"
        >
          {CONSENT_LABEL}
          {acceptedAttempt && (
            <span className="mt-1 block text-sm font-normal text-green-700">
              Already accepted ✓
            </span>
          )}
        </Label>
      </div>
      <div className="flex flex-col items-center gap-4">
        <Button
          className="w-40"
          disabled={!agreed || (saving && !acceptedAttempt)}
          onClick={onContinue}
        >
          {saving && !acceptedAttempt && <Loader2 className="animate-spin" />}
          Continue
        </Button>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        )}
        <div className="flex items-center gap-5 text-xs text-muted-foreground/80">
          <Link
            href={stepHref("resume", roleId, acceptedAttempt) ?? "/candidate/roles"}
            className="hover:text-foreground hover:underline"
          >
            Back
          </Link>
          <Link href="/candidate/roles" className="hover:text-foreground hover:underline">
            I don&apos;t agree, back to roles
          </Link>
        </div>
      </div>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        No microphone or recording before consent. Continue is enabled only after the checkbox is
        ticked.
      </p>
    </div>
  );
}
