"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

/** Bell with the unread count. Quietly shows nothing extra if the count cannot load. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/candidate/notifications", { credentials: "same-origin", cache: "no-store" })
        .then((r) => r.json())
        .then((j) => !cancelled && typeof j.unread === "number" && setUnread(j.unread))
        .catch(() => {});
    void load();
    const onRead = () => setUnread(0);
    window.addEventListener("notifications-read", onRead);
    // Pick up new notices without a reload.
    const timer = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("notifications-read", onRead);
    };
  }, []);

  return (
    <Link
      href="/candidate/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative rounded-md p-1.5 text-muted-foreground hover:text-primary"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
