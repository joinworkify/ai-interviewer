
"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  FileCheck,
  FileClock,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type ApplicationStatus = "processing" | "submitted" | "incomplete";
type FilterStatus = "all" | ApplicationStatus;

interface Application {
  id: string;
  roleId: string;
  roleTitle: string;
  appliedAt: string;
  status: ApplicationStatus;
}

const PAGE_SIZE = 5;

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: "Processing", value: "processing" },
  { label: "Submitted", value: "submitted" },
  { label: "Incomplete", value: "incomplete" },
];

const STATUS_DETAILS: Record<
  ApplicationStatus,
  {
    label: string;
    description: string;
    className: string;
    icon: typeof Clock3;
  }
> = {
  processing: {
    label: "Processing",
    description: "Your interview transcript is being processed.",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: Clock3,
  },
  submitted: {
    label: "Submitted",
    description: "Your interview answers were received.",
    className: "border-green-200 bg-green-50 text-green-700",
    icon: FileCheck,
  },
  incomplete: {
    label: "Incomplete",
    description: "No interview answer was received.",
    className: "border-red-200 bg-red-50 text-red-700",
    icon: FileClock,
  },
};

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [currentPage, setCurrentPage] = useState(1);

  const load = useCallback(async () => {
    setFailed(false);
    setApplications(null);
    setCurrentPage(1);

    try {
      const response = await fetch("/api/candidate/applications", {
        credentials: "same-origin",
        cache: "no-store",
      });

      const json = await response.json();

      if (!response.ok || !Array.isArray(json.applications)) {
        throw new Error("Applications failed to load.");
      }

      setApplications(json.applications as Application[]);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    if (!applications) return [];

    const normalizedQuery = query.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesFilter =
        filter === "all" || application.status === filter;

      const matchesSearch =
        !normalizedQuery ||
        application.roleTitle.toLowerCase().includes(normalizedQuery);

      return matchesFilter && matchesSearch;
    });
  }, [applications, filter, query]);

  const totalPages = Math.ceil(shown.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;

  const paginatedApplications = shown.slice(
    startIndex,
    startIndex + PAGE_SIZE,
  );

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Application Status
        </h1>
        <p className="text-sm text-muted-foreground">
          View your interview application history and current status.
        </p>
      </div>

      <div className="relative w-full max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          aria-label="Search applications"
          placeholder="Search by job title"
          className="pl-9"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCurrentPage(1);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Filter applications">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={filter === item.value ? "default" : "outline"}
            onClick={() => {
              setFilter(item.value);
              setCurrentPage(1);
            }}
          >
            {item.label}
            {applications && (
              <span className="ml-1 opacity-75">
                {item.value === "all"
                  ? applications.length
                  : applications.filter(
                      (app) => app.status === item.value,
                    ).length}
              </span>
            )}
          </Button>
        ))}
      </div>

      {failed ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-xl border p-8 text-center text-sm"
        >
          <p className="text-destructive">
            Applications failed to load.
          </p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : applications === null ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="h-36 animate-pulse rounded-xl bg-muted"
            />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <FileClock className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">
            {applications.length === 0
              ? "No applications yet"
              : "No matching applications"}
          </p>
          <p className="text-sm text-muted-foreground">
            {applications.length === 0
              ? "Your interview applications will appear here after you give consent and start an interview."
              : "Try another search term or status filter."}
          </p>
          {applications.length === 0 && (
            <Button asChild variant="outline">
              <Link href="/candidate/roles">
                Browse available roles
              </Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {paginatedApplications.map((application) => {
              const status = STATUS_DETAILS[application.status];
              const StatusIcon = status.icon;

              return (
                <li
                  key={application.id}
                  className="rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-lg font-semibold">
                        {application.roleTitle}
                      </h2>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        Applied{" "}
                        {new Date(application.appliedAt).toLocaleDateString(
                          undefined,
                          {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          },
                        )}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {status.description}
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:items-end">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${status.className}`}
                      >
                        <StatusIcon className="h-4 w-4" />
                        {status.label}
                      </span>

                      <Link
                        href={`/candidate/result?attempt=${encodeURIComponent(
                          application.id,
                        )}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        View interview status
                        <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-col items-center gap-3 pt-2">
            <p className="text-sm text-muted-foreground">
              Showing {startIndex + 1}–
              {Math.min(startIndex + PAGE_SIZE, shown.length)} of{" "}
              {shown.length} applications
            </p>

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

                {Array.from(
                  { length: totalPages },
                  (_, index) => index + 1,
                ).map((page) => (
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
          </div>
        </>
      )}
    </div>
  );
}
