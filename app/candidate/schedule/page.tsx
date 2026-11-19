"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { getRole, type Role } from "@/lib/candidate/api";
import { MAX_AHEAD_DAYS, MIN_LEAD_MINUTES } from "@/lib/candidate/booking";

interface Booking {
  id: string;
  roleId: string;
  roleTitle: string | null;
  startsAt: string;
}

const SELECT = "h-10 rounded-md border bg-white px-3 text-sm";
const HOURS = Array.from({ length: 25 }, (_, i) => 8 * 60 + i * 30); // 08:00 .. 20:00 local

function fmt(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Book a time to take the interview. The time is in the candidate's own time zone. */
export default function SchedulePage() {
  const roleId = useSearchParams().get("role") ?? "";
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [day, setDay] = useState(0);
  const [minutes, setMinutes] = useState(HOURS[2]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const days = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: MAX_AHEAD_DAYS + 1 }, (_, i) => new Date(base.getTime() + i * 86_400_000));
  }, []);

  const slot = useMemo(() => {
    const d = new Date(days[day]);
    d.setHours(0, minutes, 0, 0);
    return d;
  }, [days, day, minutes]);
  const tooSoon = slot.getTime() < Date.now() + MIN_LEAD_MINUTES * 60_000;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/candidate/bookings", { credentials: "same-origin", cache: "no-store" });
      const json = await res.json();
      setBookings(res.ok && Array.isArray(json.bookings) ? (json.bookings as Booking[]) : []);
    } catch {
      setBookings([]);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (roleId) getRole(roleId).then(setRole, () => setRole(null));
  }, [roleId]);

  async function book() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/candidate/bookings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId, startsAt: slot.toISOString() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return setError(body?.message ?? "Could not book that time.");
      setDone(`Booked for ${fmt(slot.toISOString())}. We emailed you a confirmation.`);
      await load();
    } catch {
      setError("Could not book that time.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/candidate/bookings/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Book an interview time</h1>
        <p className="text-sm text-muted-foreground">
          Not ready to interview now? Pick a time. We&apos;ll email you a confirmation and a reminder. The interview takes about 20 minutes, and you
          can also start it any time from the role page.
        </p>
      </div>

      {!roleId ? (
        <p className="text-sm">
          Choose a role first.{" "}
          <Link href="/candidate/roles" className="text-primary underline">
            Browse roles
          </Link>
        </p>
      ) : (
        <section className="flex flex-col gap-4 rounded-xl border bg-white p-5">
          <p className="text-sm">
            Role: <strong>{role?.title ?? roleId}</strong>
          </p>
          <div className="flex flex-wrap gap-3">
            <select aria-label="Day" className={SELECT} value={day} onChange={(e) => setDay(Number(e.target.value))}>
              {days.map((d, i) => (
                <option key={i} value={i}>
                  {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                </option>
              ))}
            </select>
            <select aria-label="Time" className={SELECT} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {HOURS.map((m) => (
                <option key={m} value={m}>
                  {new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Times are in your own time zone. Book at least {MIN_LEAD_MINUTES} minutes ahead, up to {MAX_AHEAD_DAYS} days.</p>
          {tooSoon && <p className="text-sm text-destructive">That time has passed or is too soon.</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="text-sm text-green-700">
              {done}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || tooSoon} onClick={() => void book()}>
              {busy ? "Saving…" : "Book this time"}
            </Button>
            <Button variant="outline" onClick={() => router.push(`/candidate/roles/${encodeURIComponent(roleId)}`)}>
              Back to the role
            </Button>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Your upcoming bookings</h2>
        {bookings === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : bookings.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing booked.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border bg-white p-3 text-sm">
                <span>
                  <strong>{b.roleTitle ?? b.roleId}</strong> · {fmt(b.startsAt)}
                </span>
                <span className="flex gap-3">
                  <Link href={`/candidate/roles/${encodeURIComponent(b.roleId)}`} className="text-primary hover:underline">
                    Open role
                  </Link>
                  <button type="button" disabled={busy} onClick={() => void cancel(b.id)} className="text-muted-foreground hover:underline">
                    Cancel
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
