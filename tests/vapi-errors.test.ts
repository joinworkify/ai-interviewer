import { describe, expect, it } from "vitest";
import { describeVapiError } from "@/lib/interviews/vapi-errors";

describe("describeVapiError", () => {
  it("falls back for empty values", () => {
    expect(describeVapiError(undefined)).toMatch(/voice call failed/);
    expect(describeVapiError({})).toMatch(/voice call failed/);
  });

  it("explains microphone permission errors", () => {
    const err = new DOMException("Permission denied", "NotAllowedError");
    expect(describeVapiError(err)).toMatch(/Microphone access/);
  });

  it("extracts nested API error messages", () => {
    expect(
      describeVapiError({ error: { message: ["assistantId must be a UUID"] } }),
    ).toBe("assistantId must be a UUID");
    expect(describeVapiError({ errorMsg: "Meeting has ended" })).toBe(
      "Meeting has ended",
    );
  });

  it("hints at the public key on auth failures", () => {
    expect(describeVapiError({ error: { message: "Unauthorized" } })).toMatch(
      /NEXT_PUBLIC_VAPI_PUBLIC_KEY/,
    );
  });
});
