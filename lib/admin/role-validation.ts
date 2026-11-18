/** Role detail and admin editors render each bullet as two strings. */
export function isRoleBullets(value: unknown): value is { title: string; text: string }[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const bullet = item as Record<string, unknown>;
      return typeof bullet.title === "string" && typeof bullet.text === "string";
    })
  );
}

export function isRolePay(input: Record<string, unknown>): input is Record<string, unknown> & {
  pay_min: number;
  pay_max: number;
  pay_type: "hour" | "task";
} {
  return (
    typeof input.pay_min === "number" &&
    Number.isFinite(input.pay_min) &&
    input.pay_min >= 0 &&
    typeof input.pay_max === "number" &&
    Number.isFinite(input.pay_max) &&
    input.pay_max > input.pay_min &&
    (input.pay_type === "hour" || input.pay_type === "task")
  );
}
