import { describe, expect, it, vi } from "vitest";

import { parseIntegrityEvents, summarizeIntegrity, MAX_EVENTS_PER_SESSION } from "@/lib/integrity/events";
import { handleReportIntegrity, type IntegrityHandlerDeps } from "@/lib/integrity/handler";
import { decodeJpeg, handleSaveIdentityPhoto, identityKey, MAX_IDENTITY_BYTES, type IdentityHandlerDeps } from "@/lib/integrity/identity";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SID = "22222222-2222-4222-8222-222222222222";
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("parseIntegrityEvents", () => {
  it("accepts well-formed events", () => {
    expect(parseIntegrityEvents({ events: [{ kind: "tab_hidden", atMs: 1000, durationMs: 5000 }, { kind: "paste", atMs: 0 }] })).toEqual({
      ok: true,
      events: [{ kind: "tab_hidden", atMs: 1000, durationMs: 5000 }, { kind: "paste", atMs: 0 }],
    });
  });
  it.each([
    ["no events", { events: [] }],
    ["too many", { events: Array.from({ length: 51 }, () => ({ kind: "paste", atMs: 0 })) }],
    ["unknown kind", { events: [{ kind: "keylog", atMs: 0 }] }],
    ["negative time", { events: [{ kind: "paste", atMs: -1 }] }],
    ["fractional time", { events: [{ kind: "paste", atMs: 1.5 }] }],
    ["absurd time", { events: [{ kind: "paste", atMs: 1e12 }] }],
    ["bad duration", { events: [{ kind: "tab_hidden", atMs: 0, durationMs: "5" }] }],
    ["not an object", { events: ["x"] }],
    ["no body", null],
  ])("rejects %s", (_l, value) => expect(parseIntegrityEvents(value).ok).toBe(false));
});

describe("summarizeIntegrity", () => {
  it("is none with nothing, and ignores going offline", () => {
    expect(summarizeIntegrity([]).level).toBe("none");
    expect(summarizeIntegrity([{ kind: "offline", atMs: 0, durationMs: 600000 }]).level).toBe("none");
  });
  it("rises with time away and pasting", () => {
    expect(summarizeIntegrity([{ kind: "tab_hidden", atMs: 0, durationMs: 4000 }]).level).toBe("low");
    expect(summarizeIntegrity([{ kind: "tab_hidden", atMs: 0, durationMs: 40_000 }]).level).toBe("medium");
    expect(summarizeIntegrity([{ kind: "paste", atMs: 0 }]).level).toBe("medium");
    expect(summarizeIntegrity([{ kind: "tab_hidden", atMs: 0, durationMs: 130_000 }]).level).toBe("high");
    expect(summarizeIntegrity(Array.from({ length: 6 }, (_, i) => ({ kind: "tab_hidden" as const, atMs: i, durationMs: 100 }))).level).toBe("high");
  });
  it("totals the time away", () => {
    const s = summarizeIntegrity([
      { kind: "tab_hidden", atMs: 0, durationMs: 1000 },
      { kind: "tab_hidden", atMs: 5, durationMs: 2500 },
      { kind: "window_blur", atMs: 9, durationMs: 9999 },
    ]);
    expect(s.awayMs).toBe(3500);
    expect(s.counts.tab_hidden).toBe(2);
  });
});

function integrityDeps(over: { userId?: string | null; owns?: boolean; existing?: number } = {}) {
  const insert = vi.fn(async () => {});
  const deps: IntegrityHandlerDeps = {
    getUserId: async () => (over.userId === undefined ? ME : over.userId),
    store: { ownsSession: async () => over.owns ?? true, count: async () => over.existing ?? 0, insert },
  };
  return { deps, insert };
}

describe("handleReportIntegrity", () => {
  const ok = { events: [{ kind: "tab_hidden", atMs: 10, durationMs: 20 }] };
  it("stores the owner's events", async () => {
    const t = integrityDeps();
    const res = await handleReportIntegrity(post(ok), SID, t.deps);
    expect(res.status).toBe(200);
    expect(t.insert).toHaveBeenCalledWith(SID, [{ kind: "tab_hidden", atMs: 10, durationMs: 20 }]);
  });
  it.each([
    ["signed out", { userId: null }, 401],
    ["someone else's session", { owns: false }, 404],
  ])("rejects %s", async (_l, over, status) => {
    const t = integrityDeps(over);
    expect((await handleReportIntegrity(post(ok), SID, t.deps)).status).toBe(status);
    expect(t.insert).not.toHaveBeenCalled();
  });
  it("rejects bad input and bad ids", async () => {
    const t = integrityDeps();
    expect((await handleReportIntegrity(post({ events: [{ kind: "x", atMs: 0 }] }), SID, t.deps)).status).toBe(400);
    expect((await handleReportIntegrity(post(ok), "nope", t.deps)).status).toBe(404);
  });
  it("caps events per session", async () => {
    const full = integrityDeps({ existing: MAX_EVENTS_PER_SESSION });
    expect(await (await handleReportIntegrity(post(ok), SID, full.deps)).json()).toMatchObject({ stored: 0 });
    expect(full.insert).not.toHaveBeenCalled();
    const nearly = integrityDeps({ existing: MAX_EVENTS_PER_SESSION - 1 });
    const two = { events: [ok.events[0], ok.events[0]] };
    expect(await (await handleReportIntegrity(post(two), SID, nearly.deps)).json()).toMatchObject({ stored: 1 });
  });
});

const jpeg = (n = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n)]).toString("base64");

describe("identity photo", () => {
  it("decodes only real JPEGs under the size cap", () => {
    expect(decodeJpeg(jpeg())?.length).toBe(104);
    expect(decodeJpeg(`data:image/jpeg;base64,${jpeg()}`)).not.toBeNull();
    expect(decodeJpeg(Buffer.from("not a jpeg at all").toString("base64"))).toBeNull();
    expect(decodeJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64"))).toBeNull(); // PNG
    expect(decodeJpeg(jpeg(MAX_IDENTITY_BYTES))).toBeNull();
    expect(decodeJpeg("###")).toBeNull();
    expect(decodeJpeg(42)).toBeNull();
  });

  function idDeps(over: { userId?: string | null; owns?: boolean } = {}) {
    const put = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    const deps: IdentityHandlerDeps = {
      getUserId: async () => (over.userId === undefined ? ME : over.userId),
      store: { ownsSession: async () => over.owns ?? true, save },
      storage: { put },
    };
    return { deps, put, save };
  }

  it("writes the photo under the user's folder and records it", async () => {
    const t = idDeps();
    expect((await handleSaveIdentityPhoto(post({ image: jpeg() }), SID, t.deps)).status).toBe(200);
    expect(t.put).toHaveBeenCalledWith(identityKey(ME, SID), expect.any(Uint8Array), "image/jpeg");
    expect(t.save).toHaveBeenCalledWith({ sessionId: SID, userId: ME, key: `identity/${ME}/${SID}.jpg`, size: 104 });
  });
  it.each([
    ["signed out", { userId: null }, { image: jpeg() }, 401],
    ["someone else's session", { owns: false }, { image: jpeg() }, 404],
    ["not a jpeg", {}, { image: Buffer.from("hello world").toString("base64") }, 400],
    ["no image", {}, {}, 400],
  ])("rejects %s without storing anything", async (_l, over, body, status) => {
    const t = idDeps(over);
    expect((await handleSaveIdentityPhoto(post(body), SID, t.deps)).status).toBe(status);
    expect(t.put).not.toHaveBeenCalled();
    expect(t.save).not.toHaveBeenCalled();
  });
});
