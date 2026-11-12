// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadDograhWidget,
  requestDograhSession,
  waitForSessionSaved,
  type DograhWidgetApi,
} from "@/lib/dograh/widget-client";

import { SESSION } from "./helpers/dograh";

const body = { sessionId: SESSION, role: "Backend Engineer", level: "senior", techstack: "Go" };

function jsonRes(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("requestDograhSession", () => {
  it("returns the context variables from a successful answer", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonRes(200, { success: true, contextVariables: { session_token: "t", role: "Backend Engineer" } }),
    );
    const r = await requestDograhSession(body, fetchImpl as never);
    expect(r).toEqual({ ok: true, contextVariables: { session_token: "t", role: "Backend Engineer" } });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/dograh/session",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("shows the server's message for an error answer", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(409, { success: false, message: "This interview session is already closed." }));
    expect(await requestDograhSession(body, fetchImpl as never)).toEqual({
      ok: false,
      status: 409,
      message: "This interview session is already closed.",
    });
  });

  it("falls back to a fixed message when the answer is not usable", async () => {
    const html = vi.fn(async () => new Response("<html>oops</html>", { status: 502 }));
    expect(await requestDograhSession(body, html as never)).toMatchObject({
      ok: false,
      message: "Could not start the interview.",
    });
    const badShape = vi.fn(async () => jsonRes(200, { success: true, contextVariables: { n: 5 } }));
    expect((await requestDograhSession(body, badShape as never)).ok).toBe(false);
  });

  it("reports a network failure without the error text", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED secret-host");
    });
    const r = await requestDograhSession(body, fetchImpl as never);
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect(JSON.stringify(r)).not.toContain("secret-host");
  });
});

describe("waitForSessionSaved", () => {
  it("resolves saved once the session leaves in_progress", async () => {
    const statuses = ["in_progress", "in_progress", "completed"];
    const fetchImpl = vi.fn(async () => jsonRes(200, { session: { status: statuses.shift() } }));
    const sleep = vi.fn(async () => {});
    expect(await waitForSessionSaved(SESSION, { fetchImpl: fetchImpl as never, sleep })).toBe("saved");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]).toEqual([`/api/sessions/${SESSION}`, expect.anything()]);
  });

  it("counts abandoned as saved", async () => {
    const fetchImpl = vi.fn(async () => jsonRes(200, { session: { status: "abandoned" } }));
    expect(await waitForSessionSaved(SESSION, { fetchImpl: fetchImpl as never })).toBe("saved");
  });

  it("times out, and survives failed polls", async () => {
    let t = 0;
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await waitForSessionSaved(SESSION, {
      fetchImpl: fetchImpl as never,
      intervalMs: 1000,
      timeoutMs: 3000,
      sleep: async () => void (t += 1000),
      now: () => t,
    });
    expect(result).toBe("timeout");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops polling when aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();
    expect(await waitForSessionSaved(SESSION, { fetchImpl: fetchImpl as never, signal: controller.signal })).toBe("timeout");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("loadDograhWidget", () => {
  const SRC = "http://localhost:8000/embed/dograh-widget.js?token=t";
  const fake = (): DograhWidgetApi => ({ start: vi.fn(), end: vi.fn(), setContext: vi.fn() });

  beforeEach(() => {
    delete window.DograhWidget;
    document.head.innerHTML = "";
  });
  afterEach(() => {
    delete window.DograhWidget;
    vi.useRealTimers();
  });

  it("resolves at once when the widget is already on the page", async () => {
    const widget = fake();
    window.DograhWidget = widget;
    expect(await loadDograhWidget(SRC)).toBe(widget);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("adds one async script and resolves when the global appears", async () => {
    const widget = fake();
    const promise = loadDograhWidget(SRC, { timeoutMs: 2000 });
    const script = document.head.querySelector("script")!;
    expect(script.src).toBe(SRC);
    expect(script.async).toBe(true);
    window.DograhWidget = widget;
    script.dispatchEvent(new Event("load"));
    expect(await promise).toBe(widget);

    // A second call reuses the existing script tag.
    delete window.DograhWidget;
    const again = loadDograhWidget(SRC, { timeoutMs: 2000 });
    expect(document.head.querySelectorAll("script")).toHaveLength(1);
    window.DograhWidget = widget;
    expect(await again).toBe(widget);
  });

  it("rejects, and removes the script so a retry can load it, when the script fails", async () => {
    const promise = loadDograhWidget(SRC, { timeoutMs: 500 });
    document.head.querySelector("script")!.dispatchEvent(new Event("error"));
    await expect(promise).rejects.toThrow("widget_unavailable");
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("rejects when the global never appears", async () => {
    await expect(loadDograhWidget(SRC, { timeoutMs: 120 })).rejects.toThrow("widget_unavailable");
  });
});
