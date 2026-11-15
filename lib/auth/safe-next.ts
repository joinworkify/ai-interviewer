export const DEFAULT_NEXT = "/candidate/roles";

/**
 * Returns `value` only when it is a same-origin path, otherwise the default.
 * Control characters are rejected because URL parsers strip tabs and newlines,
 * which would turn "/\t/evil.com" into the protocol-relative "//evil.com".
 */
export function safeNext(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return DEFAULT_NEXT;
  }
  return value;
}
