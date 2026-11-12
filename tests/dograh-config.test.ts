import { describe, expect, it } from "vitest";

import { parseDograhOrigin, readDograhConfig, readDograhWidgetConfig } from "@/lib/dograh/config";

import { ENV, SESSION_SECRET, WEBHOOK_SECRET } from "./helpers/dograh";

describe("parseDograhOrigin", () => {
  it.each([
    ["https://dograh.example.com", "https://dograh.example.com"],
    ["https://dograh.example.com/api/v1?x=1", "https://dograh.example.com"],
    ["http://localhost:8000", "http://localhost:8000"],
    ["http://127.0.0.1:8000/", "http://127.0.0.1:8000"],
  ])("accepts %s", (input, origin) => {
    expect(parseDograhOrigin(input)).toBe(origin);
  });

  it.each([
    "http://dograh.example.com", // plain http off loopback
    "http://192.168.1.5:8000",
    "ftp://dograh.example.com",
    "https://user:pass@dograh.example.com",
    "not a url",
    "",
  ])("rejects %s", (input) => {
    expect(parseDograhOrigin(input)).toBeNull();
  });
});

describe("readDograhConfig", () => {
  it("returns the parsed config", () => {
    expect(readDograhConfig(ENV)).toEqual({
      ok: true,
      apiOrigin: "http://localhost:8000",
      storageOrigin: "http://localhost:9000",
      webhookSecret: WEBHOOK_SECRET,
      sessionSecret: SESSION_SECRET,
    });
  });

  it("treats the storage origin as optional", () => {
    const { DOGRAH_STORAGE_URL: _unused, ...rest } = ENV;
    void _unused;
    expect(readDograhConfig(rest)).toMatchObject({ ok: true, storageOrigin: null });
  });

  it("names every missing variable and never a value", () => {
    const result = readDograhConfig({});
    expect(result).toEqual({
      ok: false,
      missing: ["DOGRAH_API_URL", "DOGRAH_WEBHOOK_SECRET", "DOGRAH_SESSION_SIGNING_SECRET"],
      invalid: [],
    });
  });

  it("flags short secrets, equal secrets and bad URLs without echoing them", () => {
    const result = readDograhConfig({
      DOGRAH_API_URL: "http://dograh.example.com",
      DOGRAH_STORAGE_URL: "nope",
      DOGRAH_WEBHOOK_SECRET: "short-secret",
      DOGRAH_SESSION_SIGNING_SECRET: "short-secret",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const text = JSON.stringify(result);
    expect(result.invalid).toHaveLength(4);
    expect(text).not.toContain("short-secret");
    expect(text).not.toContain("dograh.example.com");

    const same = readDograhConfig({ ...ENV, DOGRAH_SESSION_SIGNING_SECRET: WEBHOOK_SECRET });
    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.invalid[0]).toMatch(/must differ/);
  });
});

describe("readDograhWidgetConfig", () => {
  it("accepts the script URL from the embed snippet", () => {
    const r = readDograhWidgetConfig({
      NEXT_PUBLIC_DOGRAH_WIDGET_SRC: "http://localhost:8000/embed/dograh-widget.js?token=abc",
    });
    expect(r).toEqual({ ok: true, src: "http://localhost:8000/embed/dograh-widget.js?token=abc" });
  });

  it("reports a missing value by name", () => {
    expect(readDograhWidgetConfig({})).toEqual({
      ok: false,
      missing: ["NEXT_PUBLIC_DOGRAH_WIDGET_SRC"],
      invalid: [],
    });
  });

  it.each(["not a url", "http://example.com/x.js", "https://user:pw@example.com/x.js", "javascript:alert(1)"])(
    "rejects %s",
    (value) => {
      const r = readDograhWidgetConfig({ NEXT_PUBLIC_DOGRAH_WIDGET_SRC: value });
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain("pw@");
    },
  );
});
