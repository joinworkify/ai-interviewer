"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS, type ReviewStatus } from "@/lib/admin/access";

export function ReviewStatusForm({ sessionId, status }: { sessionId: string; status: ReviewStatus }) {
  const router = useRouter();
  const [value, setValue] = useState<ReviewStatus>(status);
  const [saving, setSaving] = useState(false);
  // Emailing is the admin's explicit choice. A rejection is never emailed by default.
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/sessions/${sessionId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: value, notify: notify && value !== "pending" }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ ok: false, text: body?.message ?? "Could not save the status." });
        return;
      }
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Could not save the status." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value as ReviewStatus;
          setValue(next);
          setNotify(next !== "rejected");
        }}
        aria-label="Review status"
        className="h-10 rounded-md border bg-background px-3 text-sm"
      >
        {REVIEW_STATUSES.map((s) => (
          <option key={s} value={s}>
            {REVIEW_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {value !== "pending" && value !== status && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the candidate
        </label>
      )}
      <button
        onClick={save}
        disabled={saving || value === status}
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save status"}
      </button>
      {message && (
        <span role="status" className={`text-sm ${message.ok ? "text-green-700" : "text-red-700"}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
