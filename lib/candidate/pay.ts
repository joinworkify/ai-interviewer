/**
 * Pay rate of a role: a min, a max and a type (per hour or per task).
 * One place formats and validates it, so the role cards, the role page and the
 * admin form agree. The database enforces the same rules (roles_pay_range_check).
 */

export type PayType = "hour" | "task";

export const PAY_TYPES: readonly { value: PayType; label: string }[] = [
  { value: "hour", label: "Per hour" },
  { value: "task", label: "Per task" },
];

export interface PayRate {
  payMin: number;
  payMax: number;
  payType: PayType;
}

const money = (n: number) => `$${Number(n.toFixed(2))}`;

/** "$10~$15/Hour" or "$2~$5/Task". */
export function formatPayRate({ payMin, payMax, payType }: PayRate): string {
  return `${money(payMin)}~${money(payMax)}/${payType === "task" ? "Task" : "Hour"}`;
}

export interface PayRateErrors {
  min?: string;
  max?: string;
  type?: string;
}

/** Empty object means valid. Inputs may be raw form strings or numbers. */
export function validatePayRate(input: {
  min: string | number | null | undefined;
  max: string | number | null | undefined;
  type: string | null | undefined;
}): PayRateErrors {
  const errors: PayRateErrors = {};
  const num = (v: string | number | null | undefined) =>
    v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v);
  const min = num(input.min);
  const max = num(input.max);

  if (!Number.isFinite(min) || min < 0) errors.min = "Enter a minimum of 0 or more.";
  if (!Number.isFinite(max)) errors.max = "Enter a maximum.";
  else if (!errors.min && max <= min) errors.max = "Maximum must be greater than minimum.";
  if (input.type !== "hour" && input.type !== "task") errors.type = "Select per hour or per task.";
  return errors;
}

/** Raw values of the pay filter on the roles page (form strings; empty = not set). */
export interface PayFilter {
  min: string;
  max: string;
  type: string;
}

export const EMPTY_PAY_FILTER: PayFilter = { min: "", max: "", type: "" };

const isSet = (v: string) => v.trim() !== "";

/** Every field is optional here, but a max, when given with a min, must be greater. */
export function validatePayFilter(f: PayFilter): PayRateErrors {
  const errors: PayRateErrors = {};
  const min = Number(f.min);
  const max = Number(f.max);
  if (isSet(f.min) && (!Number.isFinite(min) || min < 0)) errors.min = "Minimum must be 0 or more.";
  if (isSet(f.max) && (!Number.isFinite(max) || max < 0)) errors.max = "Enter a valid maximum.";
  if (isSet(f.min) && isSet(f.max) && !errors.min && !errors.max && max <= min) {
    errors.max = "Maximum must be greater than minimum.";
  }
  if (isSet(f.type) && f.type !== "hour" && f.type !== "task")
    errors.type = "Select per hour or per task.";
  return errors;
}

/**
 * Keeps roles whose pay range overlaps [min, max] and, if a type is chosen,
 * whose type matches. An invalid filter is not applied, so a half-typed or
 * wrong range never empties the list; the UI shows the error instead.
 */
export function filterRolesByPay<T extends PayRate>(roles: T[], f: PayFilter): T[] {
  if (Object.keys(validatePayFilter(f)).length > 0) return roles;
  const min = isSet(f.min) ? Number(f.min) : -Infinity;
  const max = isSet(f.max) ? Number(f.max) : Infinity;
  return roles.filter(
    (r) => r.payMax >= min && r.payMin <= max && (!isSet(f.type) || r.payType === f.type),
  );
}
