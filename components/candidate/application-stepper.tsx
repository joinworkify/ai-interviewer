"use client";

import { usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { APPLICATION_STEPS, stepFromPathname } from "@/lib/candidate/steps";

/** Progress through the application, shown above every step page. Renders nothing elsewhere. */
export function ApplicationStepper() {
  const position = stepFromPathname(usePathname());
  if (position === null) return null;

  const total = APPLICATION_STEPS.length;
  const currentIndex = position === "done" ? total : APPLICATION_STEPS.findIndex((s) => s.id === position);
  const current = APPLICATION_STEPS[currentIndex];
  const summary = current ? `Step ${currentIndex + 1} of ${total}: ${current.label}` : "All steps complete";

  return (
    <nav aria-label="Application progress" className="mx-auto mb-8 w-full max-w-3xl">
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
              <span
                className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold ${
                  complete
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary bg-background text-primary"
                      : "border-border bg-background text-muted-foreground"
                }`}
              >
                {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
              </span>
              <span className={`text-xs ${isCurrent ? "font-semibold" : "text-muted-foreground"}`}>
                {step.label}
                <span className="sr-only">{complete ? " (completed)" : isCurrent ? " (current step)" : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
