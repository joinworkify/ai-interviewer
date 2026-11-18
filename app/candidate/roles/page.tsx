"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getRoles, type Role } from "@/lib/candidate/api";

const SEARCH_DEBOUNCE_MS = 250;

/** Results remember the term that produced them, so the labels never lie. */
type Results = { term: string; roles: Role[] };

export default function RolesPage() {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [searching, setSearching] = useState(true);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  // The database sees the trimmed term, not every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback((searchTerm: string) => {
    const id = ++requestId.current;
    setFailed(false);
    setSearching(true);
    getRoles(searchTerm).then(
      (roles) => {
        if (id !== requestId.current) return;
        setResults({ term: searchTerm, roles });
        setSearching(false);
      },
      () => {
        if (id !== requestId.current) return;
        setFailed(true);
        setSearching(false);
      },
    );
  }, []);

  useEffect(() => load(term), [load, term]);

  const retry = () => {
    setResults(null);
    load(term);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Explore open roles
        </h1>
        {results && results.roles.length > 0 && (
          <p className="-mt-2 text-sm text-muted-foreground" role="status">
            {results.term
              ? `${results.roles.length} matching ${
                  results.roles.length === 1 ? "role" : "roles"
                }`
              : `${results.roles.length} ${
                  results.roles.length === 1 ? "role" : "roles"
                } open for interviews`}
          </p>
        )}

        <div className="relative w-full max-w-xl">
          <Search className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search jobs"
            placeholder="Search jobs"
            className="h-11 rounded-lg pl-11 pr-11 text-base"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {searching && results && (
            <Loader2
              aria-hidden="true"
              className="absolute right-4 top-3.5 h-4 w-4 animate-spin text-muted-foreground"
            />
          )}
        </div>
      </div>

      {failed ? (
        <div role="alert" className="flex flex-col items-center gap-3 text-sm">
          <p className="text-destructive">Roles failed to load.</p>
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        </div>
      ) : results === null ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : results.roles.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {results.term ? (
            <>
              <p role="status">No roles match &quot;{results.term}&quot;.</p>
              <Button variant="outline" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </>
          ) : (
            <p role="status">No roles available right now.</p>
          )}
        </div>
      ) : (
        <ul
          aria-busy={searching}
          className={`grid gap-5 transition-opacity sm:grid-cols-2 lg:grid-cols-3 ${
            searching ? "opacity-60" : ""
          }`}
        >
          {results.roles.map((r) => (
            <li key={r.id}>
              <Link
                href={`/candidate/roles/${r.id}`}
                className="group flex h-full min-h-56 flex-col gap-4 rounded-xl border bg-white p-6 shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-xl font-semibold leading-snug">
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
                <span className="mt-auto flex items-center justify-between pt-2 text-sm font-medium text-primary">
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
