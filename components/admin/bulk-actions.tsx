"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS, type ReviewStatus } from "@/lib/admin/access";

const BOX = 'input[name="select-session"]';

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>(`${BOX}:checked`)].map((b) => b.value);
}

/**
 * Acts on the rows ticked in the interviews table (plain checkboxes rendered
 * by the server page): change their status together, or open a side-by-side
 * comparison. Emailing candidates is a separate, explicit tick, off by default.
 */
export function BulkActions({ exportHref }: { exportHref: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<ReviewStatus>("in_progress");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function toggleAll(checked: boolean) {
    for (const b of document.querySelectorAll<HTMLInputElement>(BOX)) b.checked = checked;
  }

  async function apply() {
    const ids = selectedIds();
    if (ids.length === 0) return setMessage({ ok: false, text: "Tick at least one interview." });
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sessions/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, status, notify: notify && status !== "pending" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setMessage({ ok: false, text: body?.message ?? "Could not update." });
      setMessage({ ok: true, text: `Updated ${body.updated}.` });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not update." });
    } finally {
      setBusy(false);
    }
  }

  function compare() {
    const ids = selectedIds();
    if (ids.length < 2 || ids.length > 4) return setMessage({ ok: false, text: "Tick 2 to 4 interviews to compare." });
    router.push(`/admin/compare?ids=${ids.join(",")}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-3 text-sm dark:bg-card">
      <label className="flex items-center gap-2">
        <input type="checkbox" aria-label="Select all on this page" onChange={(e) => toggleAll(e.target.checked)} />
        All on page
      </label>
      <select
        aria-label="Set status of selected"
        value={status}
        onChange={(e) => {
          const next = e.target.value as ReviewStatus;
          setStatus(next);
          setNotify(false);
        }}
        className="h-9 rounded-md border bg-white px-2 dark:bg-background"
      >
        {REVIEW_STATUSES.map((s) => (
          <option key={s} value={s}>
            Set to {REVIEW_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {status !== "pending" && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email candidates
        </label>
      )}
      <button onClick={apply} disabled={busy} className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground disabled:opacity-50">
        {busy ? "Applying…" : "Apply"}
      </button>
      <button onClick={compare} className="h-9 rounded-md border bg-white px-3 font-medium hover:border-primary dark:bg-background">
        Compare
      </button>
      <a href={exportHref} className="ml-auto h-9 rounded-md border bg-white px-3 font-medium leading-9 hover:border-primary dark:bg-background">
        Export CSV
      </a>
      {message && (
        <span role="status" className={message.ok ? "text-green-700" : "text-red-700"}>
          {message.text}
        </span>
      )}
    </div>
  );
}
