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

/**
 * Keeps digits and at most one decimal point with two decimals, so letters,
 * signs and exponents can never be typed or pasted into a pay field.
 */
export function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot === -1) return cleaned.slice(0, 7);
  const whole = cleaned.slice(0, dot).slice(0, 7);
  const fraction = cleaned
    .slice(dot + 1)
    .replace(/\./g, "")
    .slice(0, 2);
  return `${whole}.${fraction}`;
}

/** Compact pay range and type filter that sits beside the search box. */
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
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">Filter by pay rate</legend>
      <div className="flex h-11 items-center gap-2 rounded-lg border bg-white px-2">
        <span className="pl-1 text-sm font-medium text-muted-foreground">Pay</span>
        <MoneyInput
          id="pay-min"
          label="Minimum pay"
          placeholder="Min"
          value={value.min}
          invalid={!!errors.min}
          onChange={(min) => set({ min })}
        />
        <span aria-hidden="true" className="text-muted-foreground">
          &ndash;
        </span>
        <MoneyInput
          id="pay-max"
          label="Maximum pay"
          placeholder="Max"
          value={value.max}
          invalid={!!errors.max}
          onChange={(max) => set({ max })}
        />

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
                  "rounded px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  selected
                    ? "bg-white font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {active && (
          <button
            type="button"
            aria-label="Clear pay filter"
            title="Clear pay filter"
            onClick={() => onChange(EMPTY_PAY_FILTER)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
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
    <div className="relative w-[4.5rem]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground"
      >
        $
      </span>
      <Input
        id={id}
        aria-label={label}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(sanitizeMoneyInput(e.target.value))}
        aria-invalid={invalid}
        className="h-8 px-2 pl-5 text-sm"
      />
    </div>
  );
}
