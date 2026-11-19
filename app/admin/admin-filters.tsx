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
  const [minScore, setMinScore] = useState(searchParams.get("minScore") ?? "");
  const [sort, setSort] = useState(searchParams.get("sort") ?? "");
  const [assigned, setAssigned] = useState(searchParams.get("assigned") ?? "");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());

      if (query.trim()) params.set("q", query.trim());
      else params.delete("q");

      if (status) params.set("status", status);
      else params.delete("status");

      if (minScore) params.set("minScore", minScore);
      else params.delete("minScore");

      if (sort) params.set("sort", sort);
      else params.delete("sort");

      if (assigned) params.set("assigned", assigned);
      else params.delete("assigned");

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
  }, [query, status, minScore, sort, assigned, pathname, router, searchParams]);

  function handleManualFilter() {
    const params = new URLSearchParams(searchParams.toString());

    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");

    if (status) params.set("status", status);
    else params.delete("status");

    if (minScore) params.set("minScore", minScore);
    else params.delete("minScore");

    if (sort) params.set("sort", sort);
    else params.delete("sort");

    if (assigned) params.set("assigned", assigned);
    else params.delete("assigned");

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

      <input
        name="minScore"
        inputMode="numeric"
        value={minScore}
        onChange={(event) => setMinScore(event.target.value.replace(/\D/g, "").slice(0, 3))}
        placeholder="Min score"
        aria-label="Minimum AI score"
        className="h-10 w-28 rounded-md border bg-white px-3 text-sm"
      />

      <select
        name="assigned"
        value={assigned}
        onChange={(event) => setAssigned(event.target.value)}
        aria-label="Filter by reviewer"
        className="h-10 rounded-md border bg-white px-3 text-sm"
      >
        <option value="">Any reviewer</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
      </select>

      <select
        name="sort"
        value={sort}
        onChange={(event) => setSort(event.target.value)}
        aria-label="Sort"
        className="h-10 rounded-md border bg-white px-3 text-sm"
      >
        <option value="">Newest first</option>
        <option value="score_desc">Highest score</option>
        <option value="score_asc">Lowest score</option>
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
