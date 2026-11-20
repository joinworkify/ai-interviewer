"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileCheck,
  FileClock,
  Search,
  UserSearch,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { STAGE_DESCRIPTIONS, STAGE_LABELS, type ApplicationStage } from "@/lib/candidate/stage";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

type FilterStatus = "all" | ApplicationStage;

interface Application {
  id: string;
  roleId: string;
  roleTitle: string;
  appliedAt: string;
  stage: ApplicationStage;
  /** Interview attempts still available for this role. */
  attemptsLeft: number;
}

interface Booking {
  id: string;
  roleId: string;
  roleTitle: string | null;
  startsAt: string;
}

const PAGE_SIZE = 5;

const FILTERS: { label: string; value: FilterStatus }[] = [
  { label: "All", value: "all" },
  { label: STAGE_LABELS.applied, value: "applied" },
  { label: STAGE_LABELS.in_review, value: "in_review" },
  { label: STAGE_LABELS.accepted, value: "accepted" },
  { label: STAGE_LABELS.not_selected, value: "not_selected" },
  { label: STAGE_LABELS.processing, value: "processing" },
  { label: STAGE_LABELS.incomplete, value: "incomplete" },
];

const STAGE_STYLE: Record<ApplicationStage, { className: string; icon: typeof Clock3 }> = {
  processing: { className: "border-amber-200 bg-amber-50 text-amber-700", icon: Clock3 },
  applied: { className: "border-blue-200 bg-blue-50 text-blue-700", icon: FileCheck },
  in_review: { className: "border-violet-200 bg-violet-50 text-violet-700", icon: UserSearch },
  accepted: { className: "border-green-200 bg-green-50 text-green-700", icon: BadgeCheck },
  not_selected: { className: "border-slate-200 bg-slate-50 text-slate-700", icon: XCircle },
  incomplete: { className: "border-red-200 bg-red-50 text-red-700", icon: FileClock },
};

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
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
    // Upcoming booked times; the page works without them.
    fetch("/api/candidate/bookings", { credentials: "same-origin", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => Array.isArray(j.bookings) && setBookings(j.bookings as Booking[]))
      .catch(() => {});
  }, [load]);

  const shown = useMemo(() => {
    if (!applications) return [];

    const normalizedQuery = query.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesFilter = filter === "all" || application.stage === filter;

      const matchesSearch =
        !normalizedQuery || application.roleTitle.toLowerCase().includes(normalizedQuery);

      return matchesFilter && matchesSearch;
    });
  }, [applications, filter, query]);

  const totalPages = Math.ceil(shown.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;

  const paginatedApplications = shown.slice(startIndex, startIndex + PAGE_SIZE);

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Application Status</h1>
        <p className="text-sm text-muted-foreground">
          Follow each application from applied, to in review, to a decision. We also email you when
          it changes.
        </p>
      </div>

      {bookings.length > 0 && (
        <section
          aria-label="Upcoming bookings"
          className="flex flex-col gap-2 rounded-xl border bg-white p-4"
        >
          <h2 className="text-sm font-semibold">Upcoming interviews you booked</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {b.roleTitle ?? b.roleId} ·{" "}
                  {new Date(b.startsAt).toLocaleString(undefined, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <Link
                  href={`/candidate/schedule?role=${encodeURIComponent(b.roleId)}`}
                  className="text-primary hover:underline"
                >
                  Change
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  : applications.filter((app) => app.stage === item.value).length}
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
          <p className="text-destructive">Applications failed to load.</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : applications === null ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
          <FileClock className="h-8 w-8 text-muted-foreground" />
          <p className="font-semibold">
            {applications.length === 0 ? "No applications yet" : "No matching applications"}
          </p>
          <p className="text-sm text-muted-foreground">
            {applications.length === 0
              ? "Your interview applications will appear here after you give consent and start an interview."
              : "Try another search term or status filter."}
          </p>
          {applications.length === 0 && (
            <Button asChild variant="outline">
              <Link href="/candidate/roles">Browse available roles</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {paginatedApplications.map((application) => {
              const style = STAGE_STYLE[application.stage];
              const StatusIcon = style.icon;

              return (
                <li
                  key={application.id}
                  className="rounded-xl border bg-white p-5 shadow-sm transition-colors hover:border-primary/40"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-2">
                      <h2 className="text-lg font-semibold">{application.roleTitle}</h2>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CalendarDays className="h-4 w-4" />
                        Applied{" "}
                        {new Date(application.appliedAt).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {STAGE_DESCRIPTIONS[application.stage]}
                      </p>
                    </div>

                    <div className="flex flex-col items-start gap-3 sm:items-end">
                      <span
                        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-ui text-sm font-medium ${style.className}`}
                      >
                        <StatusIcon className="h-4 w-4" />
                        {STAGE_LABELS[application.stage]}
                      </span>

                      {application.stage === "incomplete" && application.attemptsLeft > 0 && (
                        <Link
                          href={`/candidate/roles/${encodeURIComponent(application.roleId)}`}
                          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                        >
                          Try again ({application.attemptsLeft}{" "}
                          {application.attemptsLeft === 1 ? "attempt" : "attempts"} left)
                        </Link>
                      )}

                      <Link
                        href={`/candidate/result?attempt=${encodeURIComponent(application.id)}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        View details
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
              Showing {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, shown.length)} of{" "}
              {shown.length} applications
            </p>

            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    aria-disabled={currentPage === 1}
                    className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                    onClick={(event) => {
                      event.preventDefault();
                      goToPage(currentPage - 1);
                    }}
                  />
                </PaginationItem>

                {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
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
                    className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
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
