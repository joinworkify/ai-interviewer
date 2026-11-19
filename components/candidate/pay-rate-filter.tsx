"use client";

import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  EMPTY_PAY_FILTER,
  PAY_TYPES,
  validatePayFilter,
  type PayFilter,
} from "@/lib/candidate/pay";

const TYPE_OPTIONS = [{ value: "", label: "Any" }, ...PAY_TYPES];

/** Pay range and type filter for the roles list. Controlled by the page. */
export function PayRateFilter({
  value,
  onChange,
}: {
  value: PayFilter;
  onChange: (next: PayFilter) => void;
}) {
  const errors = validatePayFilter(value);
  const error = errors.min ?? errors.max ?? errors.type;
  const active = value.min !== "" || value.max !== "" || value.type !== "";
  const set = (patch: Partial<PayFilter>) => onChange({ ...value, ...patch });

  return (
    <fieldset className="flex w-full max-w-xl flex-col gap-2">
      <legend className="sr-only">Filter by pay rate</legend>
      <div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="text-sm font-medium text-foreground sm:w-16">Pay rate</span>

        <div className="flex flex-1 items-center gap-2">
          <MoneyInput
            id="pay-min"
            label="Minimum pay"
            placeholder="Min"
            value={value.min}
            invalid={!!errors.min}
            onChange={(min) => set({ min })}
          />
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            to
          </span>
          <MoneyInput
            id="pay-max"
            label="Maximum pay"
            placeholder="Max"
            value={value.max}
            invalid={!!errors.max}
            onChange={(max) => set({ max })}
          />
        </div>

        <div
          role="radiogroup"
          aria-label="Pay type"
          className="inline-flex rounded-md bg-muted p-0.5"
        >
          {TYPE_OPTIONS.map((option) => {
            const selected = value.type === option.value;
            return (
              <button
                key={option.value || "any"}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set({ type: option.value })}
                className={cn(
                  "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selected
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex min-h-5 items-center justify-between px-1">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <span />
        )}
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_PAY_FILTER)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
            Clear filter
          </button>
        )}
      </div>
    </fieldset>
  );
}

function MoneyInput({
  id,
  label,
  placeholder,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  invalid: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="relative flex-1">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
      >
        $
      </span>
      <Input
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className="pl-7"
      />
    </div>
  );
}
