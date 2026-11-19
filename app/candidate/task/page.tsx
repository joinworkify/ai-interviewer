"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MAX_ANSWER_CHARS, TASK_KIND_LABELS, type CandidateTask } from "@/lib/tasks/tasks";

function clock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The work-sample tasks for a role, done after the voice interview, against a server-side clock. */
export default function TaskPage() {
  const attemptId = useSearchParams().get("attempt") ?? "";
  const base = `/api/candidate/attempts/${encodeURIComponent(attemptId)}/tasks`;
  const [tasks, setTasks] = useState<CandidateTask[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { credentials: "same-origin", cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !Array.isArray(json.tasks)) throw new Error("failed");
      setTasks(json.tasks as CandidateTask[]);
    } catch {
      setFailed(true);
    }
  }, [base]);
  useEffect(() => {
    if (attemptId) void load();
  }, [attemptId, load]);

  if (!attemptId) {
    return (
      <p className="text-center text-sm">
        No interview selected.{" "}
        <Link href="/candidate/roles" className="underline">
          Go to roles
        </Link>
      </p>
    );
  }
  if (failed) {
    return (
      <p role="alert" className="text-center text-sm text-destructive">
        The tasks could not be loaded.
      </p>
    );
  }
  if (tasks === null) return <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />;

  const open = tasks.find((t) => t.id === openId) ?? null;
  const allDone = tasks.length > 0 && tasks.every((t) => t.status === "submitted");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Work sample</h1>
        <p className="text-sm text-muted-foreground">
          Answer in your own words, from your own knowledge. Each task has a time limit that starts when you open it. A reviewer sees your answer, and
          whether text was pasted or you left this page.
        </p>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm">This role has no extra tasks. You&apos;re done.</p>
      ) : open ? (
        <TaskPanel
          key={open.id}
          base={base}
          task={open}
          onClose={() => {
            setOpenId(null);
            void load();
          }}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
              <div>
                <p className="font-semibold">{t.title}</p>
                <p className="text-xs text-muted-foreground">
                  {TASK_KIND_LABELS[t.kind]} · {t.minutes} minutes
                </p>
              </div>
              {t.status === "submitted" ? (
                <span className="rounded-full bg-green-600/10 px-3 py-1 text-xs font-medium text-green-700">Submitted</span>
              ) : (
                <Button size="sm" onClick={() => setOpenId(t.id)}>
                  {t.status === "started" ? "Continue" : "Start"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {allDone && (
          <Button asChild>
            <Link href="/candidate/applications">View application status</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={`/candidate/result?attempt=${encodeURIComponent(attemptId)}`}>{allDone ? "Back to result" : "Skip for now"}</Link>
        </Button>
      </div>
    </div>
  );
}

function TaskPanel({ base, task, onClose }: { base: string; task: CandidateTask; onClose: () => void }) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pastes = useRef(0);
  const awayMs = useRef(0);
  const hiddenAt = useRef<number | null>(null);

  // Start (or rejoin) the server-side clock.
  useEffect(() => {
    let cancelled = false;
    fetch(`${base}/${encodeURIComponent(task.id)}/start`, { method: "POST", credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled && typeof j.startedAt === "string") setDeadline(new Date(j.startedAt).getTime() + task.minutes * 60_000);
        else if (!cancelled) setError("Could not start this task. Go back and try again.");
      })
      .catch(() => !cancelled && setError("Could not start this task. Go back and try again."));
    return () => {
      cancelled = true;
    };
  }, [base, task.id, task.minutes]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Time spent on another tab, for the reviewer to weigh.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null) {
        awayMs.current += Date.now() - hiddenAt.current;
        hiddenAt.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const remaining = deadline === null ? null : Math.ceil((deadline - now) / 1000);
  const timeUp = remaining !== null && remaining <= 0;

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(task.id)}/submit`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer, pasteCount: pastes.current, awayMs: awayMs.current + (hiddenAt.current ? Date.now() - hiddenAt.current : 0) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.message ?? "Could not save your answer.");
      onClose();
    } catch {
      setError("Could not save your answer.");
    } finally {
      setBusy(false);
    }
  }, [answer, base, onClose, task.id]);

  // When time runs out, send what is there (if anything) so it is not lost.
  const autoSent = useRef(false);
  useEffect(() => {
    if (timeUp && !autoSent.current && answer.trim()) {
      autoSent.current = true;
      void submit();
    }
  }, [timeUp, answer, submit]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{task.title}</h2>
        <span className={`font-mono text-sm ${remaining !== null && remaining <= 60 ? "text-destructive" : "text-muted-foreground"}`} aria-live="off">
          {remaining === null ? "Starting…" : timeUp ? "Time is up" : clock(remaining)}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm">{task.prompt}</p>
      <textarea
        aria-label="Your answer"
        rows={14}
        value={answer}
        maxLength={MAX_ANSWER_CHARS}
        spellCheck={task.kind !== "coding"}
        onChange={(e) => setAnswer(e.target.value)}
        onPaste={() => {
          pastes.current += 1;
        }}
        className={`rounded-md border bg-white px-3 py-2 text-sm ${task.kind === "coding" ? "font-mono" : ""}`}
        placeholder={task.kind === "coding" ? "Write your code here." : "Write your answer here."}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || deadline === null || answer.trim() === ""} onClick={() => void submit()}>
          {busy ? "Saving…" : "Submit answer"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Back to tasks
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">You can leave and come back: the clock keeps running. An answer can be submitted once.</p>
    </section>
  );
}
