
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

import { filterRoles, getRoles, type Role } from "@/lib/candidate/api";

const PAGE_SIZE = 14;

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(() => {
    setFailed(false);
    setRoles(null);
    setCurrentPage(1);
    getRoles().then(setRoles, () => setFailed(true));
  }, []);

  useEffect(load, [load]);

  const shown = roles ? filterRoles(roles, query) : [];

  const totalPages = Math.ceil(shown.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const paginatedRoles = shown.slice(
    startIndex,
    startIndex + PAGE_SIZE,
  );

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  const visiblePages = Array.from(
    { length: totalPages },
    (_, index) => index + 1,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight">
          Explore open roles
        </h1>

        {roles && roles.length > 0 && (
          <p className="-mt-2 text-sm text-muted-foreground">
            {roles.length} {roles.length === 1 ? "role" : "roles"} open for interviews
          </p>
        )}

        <div className="relative w-full max-w-xl">
          <Search className="absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search jobs"
            placeholder="Search jobs"
            className="h-11 rounded-lg pl-11 text-base"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCurrentPage(1);
            }}
          />
        </div>
      </div>

      {failed ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 text-sm"
        >
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
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-32 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No roles available right now.
        </p>
      ) : (
        <>
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {paginatedRoles.map((role) => (
              <li key={role.id}>
                <Link
                  href={`/candidate/roles/${role.id}`}
                  className="group flex h-full min-h-56 flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm transition-colors hover:border-primary hover:bg-accent focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold leading-snug">
                      {role.title}
                    </span>

                    <span className="text-sm font-medium text-primary">
                      Pay rate: {role.payRate}
                    </span>

                    {role.jobType && (
                      <span className="text-sm text-muted-foreground">
                        {role.jobType}
                      </span>
                    )}
                  </div>

                  {role.about && (
                    <p className="line-clamp-3 text-sm leading-6 text-muted-foreground">
                      {role.about}
                    </p>
                  )}

                  {role.skills.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {role.skills.slice(0, 4).map((skill) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="font-normal"
                        >
                          {skill}
                        </Badge>
                      ))}

                      {role.skills.length > 4 && (
                        <Badge
                          variant="outline"
                          className="font-normal text-muted-foreground"
                        >
                          +{role.skills.length - 4}
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

          <div className="flex flex-col items-center gap-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1}–
              {Math.min(startIndex + PAGE_SIZE, shown.length)} of{" "}
              {shown.length} roles
            </p>

            {totalPages >= 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      aria-disabled={currentPage === 1}
                      className={
                        currentPage === 1
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        goToPage(currentPage - 1);
                      }}
                    />
                  </PaginationItem>

                  {visiblePages.map((page) => (
                    <PaginationItem key={page}>
                      <PaginationLink
                        href="#"
                        isActive={currentPage === page}
                        aria-label={`Go to page ${page}`}
                        onClick={(event) => {
                          event.preventDefault();
                          goToPage(page);
                        }}
                      >
                        {page}
                      </PaginationLink>
                    </PaginationItem>
                  ))}

                  {totalPages > 5 && (
                    <PaginationItem>
                      <PaginationEllipsis />
                    </PaginationItem>
                  )}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      aria-disabled={currentPage === totalPages}
                      className={
                        currentPage === totalPages
                          ? "pointer-events-none opacity-50"
                          : ""
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        goToPage(currentPage + 1);
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </>
      )}
    </div>
  );
}
