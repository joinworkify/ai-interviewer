import { describe, expect, it } from "vitest";
import { readJsonBody } from "@/lib/http/json";

const post = (body?: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", headers, body });

const JSON_H = { "content-type": "application/json" };

describe("readJsonBody", () => {
  it("parses JSON", async () => {
    expect(await readJsonBody(post('{"a":1}', JSON_H), 100)).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects the wrong content type before reading", async () => {
    expect(await readJsonBody(post("{}", { "content-type": "text/plain" }), 100)).toMatchObject({
      ok: false,
      status: 415,
    });
  });

  it("rejects invalid JSON and oversized bodies", async () => {
    expect(await readJsonBody(post("{nope", JSON_H), 100)).toMatchObject({ status: 400 });
    expect(await readJsonBody(post("x".repeat(200), JSON_H), 100)).toMatchObject({ status: 413 });
  });

  it("treats an empty body as an error by default", async () => {
    expect(await readJsonBody(post(undefined), 100)).toMatchObject({ ok: false, status: 415 });
    expect(await readJsonBody(post("", JSON_H), 100)).toMatchObject({ ok: false, status: 400 });
  });

  describe("allowEmpty", () => {
    it("returns {} for no body, with or without a content type", async () => {
      expect(await readJsonBody(post(undefined), 100, { allowEmpty: true })).toEqual({ ok: true, value: {} });
      expect(await readJsonBody(post("  ", JSON_H), 100, { allowEmpty: true })).toEqual({ ok: true, value: {} });
    });

    it("still enforces content type, JSON and size on non-empty bodies", async () => {
      expect(await readJsonBody(post("{}", { "content-type": "text/plain" }), 100, { allowEmpty: true })).toMatchObject({ status: 415 });
      expect(await readJsonBody(post("{nope", JSON_H), 100, { allowEmpty: true })).toMatchObject({ status: 400 });
      expect(await readJsonBody(post("x".repeat(200), JSON_H), 100, { allowEmpty: true })).toMatchObject({ status: 413 });
    });
  });
});
