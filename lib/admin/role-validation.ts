/** Role detail and admin editors render each bullet as two strings. */
export function isRoleBullets(value: unknown): value is { title: string; text: string }[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const bullet = item as Record<string, unknown>;
    return typeof bullet.title === "string" && typeof bullet.text === "string";
  });
}
