"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
        <h1 className="text-3xl font-bold tracking-tight">
          Explore open roles
        </h1>
        {roles && roles.length > 0 && (
          <p className="-mt-2 text-sm text-muted-foreground">
            {roles.length} {roles.length === 1 ? "role" : "roles"} open for
            interviews
          </p>
        )}
        <div className="relative w-full max-w-xl">
          <Search className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search jobs"
            placeholder="Search jobs"
            className="h-11 rounded-lg pl-11 text-base"
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
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No roles available right now.
        </p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={`/candidate/roles/${r.id}`}
                className="group flex h-full min-h-56 flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-heading text-lg font-semibold leading-snug">
                    {r.title}
                  </span>
                  <span className="text-sm font-medium text-primary">
                    Pay rate: {r.payRate}
                  </span>
                  {r.jobType && (
                    <span className="text-sm text-muted-foreground">
                      {r.jobType}
                    </span>
                  )}
                </div>
                {r.about && (
                  <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                    {r.about}
                  </p>
                )}
                {r.skills.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {r.skills.slice(0, 4).map((skill) => (
                      <Badge
                        key={skill}
                        variant="outline"
                        className="font-normal"
                      >
                        {skill}
                      </Badge>
                    ))}
                    {r.skills.length > 4 && (
                      <Badge
                        variant="outline"
                        className="font-normal text-muted-foreground"
                      >
                        +{r.skills.length - 4}
                      </Badge>
                    )}
                  </div>
                )}
                <span className="mt-auto flex items-center justify-between pt-2 font-ui text-sm font-medium text-primary">
                  View role
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
