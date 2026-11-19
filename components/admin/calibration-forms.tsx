"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DEFAULT_RUBRIC } from "@/lib/evaluation/rubric";

/** Adds a calibration case: a transcript and the scores a person gave it (default rubric). */
export function NewCaseForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [scores, setScores] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/calibration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title,
          roleTitle,
          transcript,
          humanScores: Object.fromEntries(DEFAULT_RUBRIC.map((c) => [c.name, scores[c.name] === undefined || scores[c.name] === "" ? NaN : Number(scores[c.name])])),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? "Could not save the case.");
        return;
      }
      setTitle("");
      setRoleTitle("");
      setTranscript("");
      setScores({});
      router.refresh();
    } catch {
      setError("Could not save the case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-xl border bg-white p-4 dark:bg-card">
      <summary className="cursor-pointer text-sm font-semibold">Add a case</summary>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input aria-label="Case title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. Strong SQL, weak communication)" className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-background" />
          <input aria-label="Role" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Role (e.g. Data Analyst)" className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-background" />
        </div>
        <textarea
          aria-label="Transcript"
          rows={8}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={"Interviewer: How would you total sales by region?\nCandidate: I would join orders to customers and group by region."}
          className="rounded-md border bg-white px-3 py-2 text-sm dark:bg-background"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          {DEFAULT_RUBRIC.map((c) => (
            <label key={c.name} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {c.name} <span className="text-xs text-muted-foreground">(human score)</span>
              </span>
              <input
                inputMode="numeric"
                value={scores[c.name] ?? ""}
                onChange={(e) => setScores((s) => ({ ...s, [c.name]: e.target.value.replace(/\D/g, "").slice(0, 3) }))}
                className="h-9 w-20 rounded-md border bg-white px-2 dark:bg-background"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Cases use the default rubric. Use real interviews your reviewers have already judged, without names or contact details.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button onClick={save} disabled={busy} className="h-10 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {busy ? "Saving…" : "Save case"}
        </button>
      </div>
    </details>
  );
}

/** Run the AI on a case (optionally 3 times to see how stable it is), or delete the case. */
export function CaseActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "run" | "run3" | "delete") {
    setBusy(kind);
    setError(null);
    try {
      const res =
        kind === "delete"
          ? await fetch(`/api/admin/calibration/${id}`, { method: "DELETE" })
          : await fetch(`/api/admin/calibration/${id}/run?repeats=${kind === "run3" ? 3 : 1}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.message ?? "Failed.");
      else router.refresh();
    } catch {
      setError("Failed.");
    } finally {
      setBusy(null);
    }
  }

  const btn = "h-8 rounded-md border bg-white px-3 text-xs font-medium hover:border-primary disabled:opacity-50 dark:bg-background";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className={btn} disabled={busy !== null} onClick={() => void act("run")}>
        {busy === "run" ? "Scoring…" : "Run AI"}
      </button>
      <button className={btn} disabled={busy !== null} onClick={() => void act("run3")}>
        {busy === "run3" ? "Scoring ×3…" : "Run ×3 (stability)"}
      </button>
      <button className={`${btn} text-red-700`} disabled={busy !== null} onClick={() => void act("delete")}>
        Delete
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
