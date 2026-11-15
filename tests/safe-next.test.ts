import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/candidate/roles", "/candidate/roles"],
    ["/candidate/roles?x=1&y=2", "/candidate/roles?x=1&y=2"],
    ["/candidate/roles#top", "/candidate/roles#top"],
    ["/a/b/../c", "/a/c"],
    ["/path%20with%20space", "/path%20with%20space"],
  ])("keeps the on-site path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "http://evil.example/x",
    "//evil.example",
    "//evil.example/path",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    " /candidate/roles",
    "candidate/roles",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "mailto:a@example.test",
    "/%0d%0aSet-Cookie:x=1" + "\u0000",
    "/" + "a".repeat(600),
    "",
  ])("replaces %j with the fallback", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("returns the fallback for missing values and honours a custom one", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("//evil.example", "/candidate/roles")).toBe("/candidate/roles");
  });

  it("rejects dot segments that normalize into a protocol-relative URL", () => {
    // The URL parser resolves these to "//evil.example", which a redirect
    // would follow off-site.
    for (const c of ["/..//evil.example", "/.//evil.example", "/a/..//evil.example", "/a/../..//evil.example"]) {
      expect(safeNextPath(c), c).toBe("/");
    }
  });

  it("never returns something that starts with two slashes or a scheme", () => {
    const candidates = [
      "/..//evil.example",
      "/.//evil.example",
      "/a/..//evil.example",
      "/%2F%2Fevil.example",
      "/?next=//evil.example",
      "/..%2F/evil.example",
      "/%2e%2e//evil.example",
    ];
    for (const c of candidates) {
      const out = safeNextPath(c);
      expect(out.startsWith("//"), `${c} -> ${out}`).toBe(false);
      expect(/^[a-z][a-z0-9+.-]*:/i.test(out), `${c} -> ${out}`).toBe(false);
    }
  });
});
