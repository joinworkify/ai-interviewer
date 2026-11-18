
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "@/lib/admin/access";

export default function AdminFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());

      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");

      if (status) params.set("status", status);
      else params.delete("status");

      params.delete("page");

      const nextUrl = params.toString()
        ? `${pathname}?${params.toString()}`
        : pathname;

      const currentUrl = searchParams.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;

      if (nextUrl !== currentUrl) {
        startTransition(() => router.replace(nextUrl, { scroll: false }));
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, status, pathname, router, searchParams]);

  function handleManualFilter() {
    const params = new URLSearchParams(searchParams.toString());

    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");

    if (status) params.set("status", status);
    else params.delete("status");

    params.delete("page");

    const nextUrl = params.toString()
      ? `${pathname}?${params.toString()}`
      : pathname;

    startTransition(() => router.push(nextUrl, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap gap-2">
      <input
        name="q"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name or email"
        aria-label="Search name or email"
        className="h-10 min-w-0 flex-1 rounded-md border bg-white px-3 text-sm"
      />

      <select
        name="status"
        value={status}
        onChange={(event) => setStatus(event.target.value)}
        aria-label="Filter by status"
        className="h-10 rounded-md border bg-white px-3 text-sm"
      >
        <option value="">All statuses</option>
        {REVIEW_STATUSES.map((item) => (
          <option key={item} value={item}>
            {REVIEW_STATUS_LABELS[item]}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={handleManualFilter}
        disabled={isPending}
        className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        Filter
      </button>
    </div>
  );
}
