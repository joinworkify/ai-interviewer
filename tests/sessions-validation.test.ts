import { describe, expect, it } from "vitest";
import {
  isUuid,
  validateFeedbackBody,
  validateStartSessionBody,
} from "@/lib/sessions/validation";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("validateStartSessionBody", () => {
  it("accepts a UUID interviewId", () => {
    expect(validateStartSessionBody({ interviewId: UUID })).toEqual({
      ok: true,
      data: { interviewId: UUID },
    });
  });

  it.each([null, [], "x", 1])("rejects non-object body %j", (b) => {
    expect(validateStartSessionBody(b).ok).toBe(false);
  });

  it("rejects bad ids and unknown keys (no client-supplied owner)", () => {
    expect(validateStartSessionBody({ interviewId: "nope" }).ok).toBe(false);
    expect(validateStartSessionBody({ interviewId: UUID, userId: UUID }).ok).toBe(false);
    expect(validateStartSessionBody({ interviewId: UUID, user_id: UUID }).ok).toBe(false);
  });
});

describe("validateFeedbackBody", () => {
  it("normalizes answer whitespace and control characters", () => {
    const r = validateFeedbackBody({
      answers: [{ questionIndex: 0, answer: "  hello\n\n  world\u0000 " }],
    });
    expect(r).toEqual({
      ok: true,
      data: { answers: [{ questionIndex: 0, answer: "hello world" }] },
    });
  });

  it.each([
    ["missing answers", {}],
    ["empty list", { answers: [] }],
    ["too many", { answers: Array.from({ length: 11 }, (_, i) => ({ questionIndex: i, answer: "a" })) }],
    ["negative index", { answers: [{ questionIndex: -1, answer: "a" }] }],
    ["fractional index", { answers: [{ questionIndex: 0.5, answer: "a" }] }],
    ["string index", { answers: [{ questionIndex: "0", answer: "a" }] }],
    ["blank answer", { answers: [{ questionIndex: 0, answer: "   " }] }],
    ["non-string answer", { answers: [{ questionIndex: 0, answer: 5 }] }],
    ["oversized answer", { answers: [{ questionIndex: 0, answer: "a".repeat(4001) }] }],
    ["duplicate index", { answers: [{ questionIndex: 1, answer: "a" }, { questionIndex: 1, answer: "b" }] }],
    ["extra key on item", { answers: [{ questionIndex: 0, answer: "a", score: 100 }] }],
    ["extra top-level key", { answers: [{ questionIndex: 0, answer: "a" }], userId: UUID }],
  ])("rejects %s", (_name, body) => {
    expect(validateFeedbackBody(body).ok).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts UUIDs and rejects everything else", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("../etc/passwd")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("validateFeedbackBody with answers optional", () => {
  it("returns an empty list when answers is absent", () => {
    expect(validateFeedbackBody({}, { required: false })).toEqual({
      ok: true,
      data: { answers: [] },
    });
  });

  it("still validates answers when present", () => {
    expect(validateFeedbackBody({ answers: [] }, { required: false }).ok).toBe(false);
    expect(
      validateFeedbackBody({ answers: [{ questionIndex: 0, answer: " hi " }] }, { required: false }),
    ).toEqual({ ok: true, data: { answers: [{ questionIndex: 0, answer: "hi" }] } });
  });

  it("still rejects unknown keys", () => {
    expect(validateFeedbackBody({ userId: "x" }, { required: false }).ok).toBe(false);
  });
});
