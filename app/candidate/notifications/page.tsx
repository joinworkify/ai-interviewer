"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

import type { InboxEntry } from "@/lib/candidate/inbox";

/** The candidate's notifications. Opening the page marks them read. */
export default function NotificationsPage() {
  const [items, setItems] = useState<InboxEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/candidate/notifications", { credentials: "same-origin", cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !Array.isArray(json.notifications)) throw new Error("failed");
        if (cancelled) return;
        setItems(json.notifications as InboxEntry[]);
        if (json.unread > 0) {
          await fetch("/api/candidate/notifications/read", { method: "POST", credentials: "same-origin" });
          window.dispatchEvent(new Event("notifications-read"));
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Notifications failed to load.
        </p>
      ) : items === null ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
          <Bell className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">Nothing yet</p>
          <p className="text-sm text-muted-foreground">We&apos;ll tell you here when your application moves forward.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.id} className={`rounded-xl border bg-white p-4 ${n.read ? "" : "border-primary/40"}`}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">{n.title}</p>
                <time className="text-xs text-muted-foreground" dateTime={n.createdAt}>
                  {new Date(n.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                </time>
              </div>
              <p className="text-sm text-muted-foreground">{n.body}</p>
              {n.link && (
                <Link href={n.link} className="mt-1 inline-block text-sm font-medium text-primary hover:underline">
                  View
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
