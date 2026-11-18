"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { APPLICATION_STEPS, stepFromPathname, stepHref } from "@/lib/candidate/steps";

/**
 * Progress through the application, shown above every step page. Renders
 * nothing elsewhere. Completed steps are links back to that step.
 */
export function ApplicationStepper() {
  const pathname = usePathname();
  const params = useSearchParams();
  const position = stepFromPathname(pathname);
  if (position === null) return null;

  // The role page has its id in the path; the step pages have it in ?role=.
  const roleId =
    params.get("role") ??
    (position === "role" ? decodeURIComponent(pathname.split("/").pop() ?? "") : null);
  const attemptId = params.get("attempt");

  const total = APPLICATION_STEPS.length;
  const currentIndex =
    position === "done" ? total : APPLICATION_STEPS.findIndex((s) => s.id === position);
  const current = APPLICATION_STEPS[currentIndex];
  const summary = current
    ? `Step ${currentIndex + 1} of ${total}: ${current.label}`
    : "All steps complete";

  return (
    <nav aria-label="Application progress" className="mx-auto mb-8 w-full max-w-3xl font-ui">
      {/* Phones: one line and a bar. */}
      <div className="sm:hidden">
        <p className="text-sm font-medium">{summary}</p>
        <div
          role="progressbar"
          aria-label="Application progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(currentIndex + 1, total)}
          aria-valuetext={summary}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${(Math.min(currentIndex + 1, total) / total) * 100}%` }}
          />
        </div>
      </div>

      {/* Larger screens: every step. */}
      <ol className="hidden items-start sm:flex">
        {APPLICATION_STEPS.map((step, i) => {
          const complete = i < currentIndex;
          const isCurrent = i === currentIndex;
          // Only finished steps link back, and never once the interview is over.
          const href =
            complete && position !== "done" ? stepHref(step.id, roleId, attemptId) : null;
          const content = (
            <>
              <span
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${
                  complete
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary bg-background text-primary"
                      : "border-border bg-background text-muted-foreground"
                } ${href ? "group-hover:opacity-80" : ""}`}
              >
                {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span
                className={`text-xs ${isCurrent ? "font-semibold" : "text-muted-foreground"} ${
                  href ? "group-hover:text-foreground group-hover:underline" : ""
                }`}
              >
                {step.label}
                <span className="sr-only">
                  {complete
                    ? href
                      ? " (completed, go back to this step)"
                      : " (completed)"
                    : isCurrent
                      ? " (current step)"
                      : ""}
                </span>
              </span>
            </>
          );
          return (
            <li
              key={step.id}
              aria-current={isCurrent ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center gap-2 text-center"
            >
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute left-[-50%] top-4 -z-0 h-0.5 w-full ${i <= currentIndex ? "bg-primary" : "bg-border"}`}
                />
              )}
              {href ? (
                <Link
                  href={href}
                  className="group flex flex-col items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
