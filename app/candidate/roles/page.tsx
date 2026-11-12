"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { filterRoles, getRoles, type Role } from "@/lib/candidate/api";

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setFailed(false);
    setRoles(null);
    getRoles().then(setRoles, () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const shown = roles ? filterRoles(roles, query) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Choose your interview role</h1>
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search jobs"
            placeholder="Search jobs"
            className="pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 text-sm">
          <p className="text-destructive">Roles failed to load.</p>
          <Button variant="outline" onClick={load}>
            Retry
          </Button>
        </div>
      ) : roles === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No roles available right now.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={`/candidate/roles/${r.id}`}
                className="group relative flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-xl border bg-card p-5 text-center shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-semibold">{r.title}</span>
                <span className="text-sm font-medium text-muted-foreground">Pay rate: {r.payRate}</span>
                <span className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full border transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
