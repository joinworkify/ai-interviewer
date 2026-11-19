"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MAX_NOTE } from "@/lib/admin/workflow";

/** Picks the admin responsible for reviewing this interview. */
export function AssignPicker({
  sessionId,
  assignedTo,
  admins,
}: {
  sessionId: string;
  assignedTo: string | null;
  admins: { id: string; email: string }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(assignedTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminId: next || null }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.message ?? "Could not assign.");
        setValue(assignedTo ?? "");
      } else router.refresh();
    } catch {
      setError("Could not assign.");
      setValue(assignedTo ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Assigned reviewer"
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        className="h-10 rounded-md border bg-white px-3 text-sm dark:bg-background"
      >
        <option value="">Unassigned</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.email}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-sm text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

type Note = { id: string; authorId: string | null; authorName: string; body: string; createdAt: string };

/** Internal reviewer notes. Never shown to candidates. You can delete only your own. */
export function Notes({ sessionId, notes, meId }: { sessionId: string; notes: Note[]; meId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(method: "POST" | "DELETE", body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/notes`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.message ?? "Could not save.");
        return;
      }
      if (method === "POST") setText("");
      router.refresh();
    } catch {
      setError("Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="grid gap-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-white p-3 text-sm dark:bg-background">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {n.authorName} · {new Date(n.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                </span>
                {n.authorId === meId && (
                  <button type="button" onClick={() => void send("DELETE", { noteId: n.id })} disabled={busy} className="hover:underline">
                    Delete
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2">
        <textarea
          aria-label="New note"
          rows={3}
          maxLength={MAX_NOTE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Internal note for other reviewers. The candidate never sees it."
          className="rounded-md border bg-white px-3 py-2 text-sm dark:bg-background"
        />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void send("POST", { body: text })}
          disabled={busy || text.trim() === ""}
          className="h-9 w-fit rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add note"}
        </button>
      </div>
    </div>
  );
}
