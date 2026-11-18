"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAY_TYPES, validatePayFilter, type PayFilter } from "@/lib/candidate/pay";

/** Min / max / type filter for the roles list. Controlled by the page. */
export function PayRateFilter({
  value,
  onChange,
}: {
  value: PayFilter;
  onChange: (next: PayFilter) => void;
}) {
  const errors = validatePayFilter(value);
  const set = (patch: Partial<PayFilter>) => onChange({ ...value, ...patch });

  return (
    <fieldset className="flex w-full max-w-xl flex-col gap-2">
      <legend className="sr-only">Filter by pay rate</legend>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-min">Min</Label>
          <Input
            id="pay-min"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="0"
            value={value.min}
            onChange={(e) => set({ min: e.target.value })}
            aria-invalid={!!errors.min}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-max">Max</Label>
          <Input
            id="pay-max"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="10"
            value={value.max}
            onChange={(e) => set({ max: e.target.value })}
            aria-invalid={!!errors.max}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-type">Type</Label>
          {/* Native select: components/ui has no Select yet. */}
          <select
            id="pay-type"
            value={value.type}
            onChange={(e) => set({ type: e.target.value })}
            aria-invalid={!!errors.type}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Select</option>
            {PAY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {(errors.min || errors.max || errors.type) && (
        <p role="alert" className="text-sm text-destructive">
          {errors.min ?? errors.max ?? errors.type}
        </p>
      )}
    </fieldset>
  );
}
