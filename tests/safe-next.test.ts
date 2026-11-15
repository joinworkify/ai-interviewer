import { describe, expect, it } from "vitest";
import { DEFAULT_NEXT, safeNext } from "@/lib/auth/safe-next";

describe("safeNext", () => {
  it("keeps same-origin paths with query strings", () => {
    expect(safeNext("/candidate/consent?role=abc")).toBe("/candidate/consent?role=abc");
  });

  it("falls back to the default when empty", () => {
    expect(safeNext(null)).toBe(DEFAULT_NEXT);
    expect(safeNext(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNext("")).toBe(DEFAULT_NEXT);
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "evil.com/path",
  ])("rejects %j", (value) => {
    expect(safeNext(value)).toBe(DEFAULT_NEXT);
  });
});
