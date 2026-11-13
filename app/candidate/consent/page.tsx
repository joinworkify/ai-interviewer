"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { getInstructions, giveConsentAndCreateAttempt } from "@/lib/candidate/api";

export default function ConsentPage() {
  const roleId = useSearchParams().get("role") ?? "";
  const router = useRouter();
  const [instructions, setInstructions] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    getInstructions(roleId).then(setInstructions, () => setLoadError(true));
  }, [roleId]);

  async function onContinue() {
    setSaving(true);
    setSaveError(false);
    try {
      const { attemptId } = await giveConsentAndCreateAttempt(roleId);
      router.push(
        `/candidate/setup?attempt=${encodeURIComponent(attemptId)}&role=${encodeURIComponent(roleId)}`,
      );
    } catch {
      setSaveError(true); // keep the tick so they can just retry
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
    <div className="mx-auto flex max-w-2xl flex-col gap-5 rounded-xl border bg-card p-6 shadow-sm">
      <h1 className="text-center text-3xl font-bold tracking-tight">Before we start</h1>
      {instructions === null ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" aria-busy="true" />
      ) : (
        <div className="min-h-40 rounded-lg border bg-muted/40 p-4 text-sm">{instructions}</div>
      )}
      <div className="flex items-center gap-2">
        <Checkbox
          id="consent"
          checked={agreed}
          disabled={instructions === null}
          onCheckedChange={(v) => setAgreed(v === true)}
        />
        <Label htmlFor="consent">I agree to the AI interview and voice recording</Label>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Button className="w-40" disabled={!agreed || saving} onClick={onContinue}>
          {saving && <Loader2 className="animate-spin" />}
          Continue
        </Button>
        {saveError && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&apos;t save your consent. Please try again.
          </p>
        )}
        <Link href="/candidate/roles" className="text-sm text-muted-foreground hover:underline">
          I don&apos;t agree, back to roles
        </Link>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        No microphone or recording before consent. Continue is enabled only after the checkbox is ticked.
      </p>
    </div>
  );
}
