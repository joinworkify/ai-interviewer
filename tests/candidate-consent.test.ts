import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CONSENT_LABEL, CONSENT_POINTS, CONSENT_VERSION } from "@/lib/candidate/consent";

/**
 * The stored consent_version is the only record of what a candidate read, so
 * the wording and the version must change together. When this fails because
 * you edited lib/candidate/consent.ts: bump CONSENT_VERSION, then put the new
 * version and hash in WORDING below (keep the old line: it is history).
 */

const WORDING: Record<string, string> = {
  "2026-11-13": "1bdc9756",
};

function wordingHash(): string {
  return createHash("sha256")
    .update(JSON.stringify([CONSENT_LABEL, ...CONSENT_POINTS]))
    .digest("hex")
    .slice(0, 8);
}

describe("consent wording", () => {
  it("has a version that fits the database column", () => {
    expect(CONSENT_VERSION).toMatch(/^[0-9A-Za-z._-]{1,40}$/);
  });

  it("changes only together with its version", () => {
    expect(WORDING[CONSENT_VERSION], `record ${CONSENT_VERSION}: ${wordingHash()} in WORDING`).toBe(
      wordingHash(),
    );
  });

  it("tells the candidate about recording, Dograh, AI feedback, human review and deletion", () => {
    const text = [...CONSENT_POINTS, CONSENT_LABEL].join(" ").toLowerCase();
    for (const word of ["recorded", "transcript", "dograh", "ai model", "reviews", "delete"]) {
      expect(text, word).toContain(word);
    }
  });

  it("has no empty or duplicate point", () => {
    expect(new Set(CONSENT_POINTS).size).toBe(CONSENT_POINTS.length);
    for (const p of CONSENT_POINTS) expect(p.trim().length).toBeGreaterThan(0);
  });
});
