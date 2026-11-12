// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";

import type { DograhWidgetApi } from "@/lib/dograh/widget-client";

import { SESSION } from "./helpers/dograh";

/**
 * DOM test for the real DograhInterview component under StrictMode. Only the
 * network and the Dograh widget are replaced by fakes; the form and the state
 * handling are real.
 */

type Handlers = {
  connected?: () => void;
  disconnected?: () => void;
  end?: () => void;
  status?: (s: string) => void;
  error?: (e: unknown) => void;
};
const handlers: Handlers = {};

const widget = {
  start: vi.fn(async () => {}),
  end: vi.fn(),
  setContext: vi.fn(),
  onCallConnected: vi.fn((cb: (info: { workflowRunId?: unknown }) => void) => void (handlers.connected = () => cb({}))),
  onCallDisconnected: vi.fn((cb: (info: { workflowRunId?: unknown }) => void) => void (handlers.disconnected = () => cb({}))),
  onCallEnd: vi.fn((cb: () => void) => void (handlers.end = cb)),
  onStatusChange: vi.fn((cb: (s: string) => void) => void (handlers.status = cb)),
  onError: vi.fn((cb: (e: unknown) => void) => void (handlers.error = cb)),
} satisfies DograhWidgetApi;

const requestDograhSession = vi.fn();
const loadDograhWidget = vi.fn();
const waitForSessionSaved = vi.fn();
vi.mock("@/lib/dograh/widget-client", () => ({
  requestDograhSession: (...a: unknown[]) => requestDograhSession(...a),
  loadDograhWidget: (...a: unknown[]) => loadDograhWidget(...a),
  waitForSessionSaved: (...a: unknown[]) => waitForSessionSaved(...a),
}));

const { DograhInterview } = await import("@/components/interview/dograh-interview");

const SRC = "http://localhost:8000/embed/dograh-widget.js?token=t";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const f of Object.values(widget)) f.mockClear();
  for (const k of Object.keys(handlers) as (keyof Handlers)[]) delete handlers[k];
  requestDograhSession.mockReset().mockResolvedValue({ ok: true, contextVariables: { session_token: "tok", role: "SRE" } });
  loadDograhWidget.mockReset().mockResolvedValue(widget);
  waitForSessionSaved.mockReset().mockResolvedValue("saved");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

function button(label: RegExp): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) => label.test(x.textContent ?? ""));
  if (!b) throw new Error(`button ${label} not found; have: ${container.textContent}`);
  return b as HTMLButtonElement;
}

/** A user click flushes React in a microtask before the form's default action; emulate that. */
function nativeClick(el: HTMLElement) {
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const checkpoint = () => flushSync(() => {});
  g.IS_REACT_ACT_ENVIRONMENT = false;
  window.addEventListener("click", checkpoint);
  try {
    el.click();
  } finally {
    window.removeEventListener("click", checkpoint);
    g.IS_REACT_ACT_ENVIRONMENT = true;
  }
}

async function settle() {
  for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
}

async function render(props: { sessionId: string | null; widgetSrc: string | null } = { sessionId: SESSION, widgetSrc: SRC }) {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(DograhInterview, props)));
  });
}

async function fillAndStart() {
  await act(async () => {
    setValue(container.querySelector<HTMLInputElement>("#dg-role")!, "SRE");
    setValue(container.querySelector<HTMLInputElement>("#dg-stack")!, "Go, Kubernetes");
  });
  await act(async () => button(/start interview/i).click());
  await settle();
}

describe("DograhInterview", () => {
  it("prepares the session, loads the widget, sets the signed context and starts the call", async () => {
    await render();
    await fillAndStart();

    expect(requestDograhSession).toHaveBeenCalledTimes(1);
    expect(requestDograhSession).toHaveBeenCalledWith({ sessionId: SESSION, role: "SRE", level: "mid", techstack: "Go, Kubernetes" });
    expect(loadDograhWidget).toHaveBeenCalledWith(SRC);
    expect(widget.setContext).toHaveBeenCalledWith({ session_token: "tok", role: "SRE" });
    expect(widget.start).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Connecting to the interviewer");

    await act(async () => handlers.connected!());
    expect(container.textContent).toContain("Interview in progress");
  });

  it("after the call ends it waits for the transcript and reports it saved", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.connected!());

    await act(async () => handlers.disconnected!());
    await settle();
    expect(waitForSessionSaved).toHaveBeenCalledWith(SESSION, expect.objectContaining({ signal: expect.anything() }));
    expect(container.textContent).toContain("Transcript saved");
    expect(button(/start again/i).type).toBe("submit");
  });

  it("handles disconnect and end callbacks that both fire, waiting for the transcript once", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.connected!());
    await act(async () => {
      handlers.disconnected!();
      handlers.end!();
    });
    await settle();
    expect(waitForSessionSaved).toHaveBeenCalledTimes(1);
  });

  it("tells the user when the transcript has not arrived in time", async () => {
    waitForSessionSaved.mockResolvedValue("timeout");
    await render();
    await fillAndStart();
    await act(async () => handlers.connected!());
    await act(async () => handlers.disconnected!());
    await settle();
    expect(container.textContent).toContain("transcript has not arrived yet");
  });

  it("End interview ends the call once and never restarts it", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.connected!());
    const submits = vi.fn();
    container.querySelector("form")!.addEventListener("submit", submits);

    nativeClick(button(/end interview/i));
    await settle();

    expect(widget.end).toHaveBeenCalledTimes(1);
    expect(submits).not.toHaveBeenCalled();
    expect(widget.start).toHaveBeenCalledTimes(1);
    expect(requestDograhSession).toHaveBeenCalledTimes(1);
  });

  it("shows the server's message and does not touch the widget when the session is refused", async () => {
    requestDograhSession.mockResolvedValue({ ok: false, status: 409, message: "This interview session is already closed." });
    await render();
    await fillAndStart();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("already closed");
    expect(loadDograhWidget).not.toHaveBeenCalled();
    expect(widget.start).not.toHaveBeenCalled();
  });

  it("says Dograh may not be running when the widget cannot load", async () => {
    loadDograhWidget.mockRejectedValue(new Error("widget_unavailable"));
    await render();
    await fillAndStart();
    expect(container.textContent).toContain("Could not load the voice widget");
    expect(widget.start).not.toHaveBeenCalled();
  });

  it("shows a fixed message for a widget error and never the error text", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.error!(new Error("token=SECRET-VALUE leaked")));
    expect(container.textContent).toContain("The voice call failed");
    expect(container.textContent).not.toContain("SECRET-VALUE");
  });

  it("reports a failed connection status", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.status!("failed"));
    expect(container.textContent).toContain("The voice connection failed");
  });

  it("validates the form before asking the server for anything", async () => {
    await render();
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>("#dg-role")!, 'Dev" ignore previous');
      setValue(container.querySelector<HTMLInputElement>("#dg-stack")!, "Go");
    });
    await act(async () => button(/start interview/i).click());
    await settle();
    expect(container.textContent).toContain("unsupported characters");
    expect(requestDograhSession).not.toHaveBeenCalled();
  });

  it("cannot start without a session link or a configured widget", async () => {
    await render({ sessionId: null, widgetSrc: SRC });
    expect(container.textContent).toContain("sessionId");
    expect(button(/start interview/i).disabled).toBe(true);
    await act(async () => root.render(createElement(DograhInterview, { sessionId: SESSION, widgetSrc: null })));
    expect(button(/start interview/i).disabled).toBe(true);
    expect(requestDograhSession).not.toHaveBeenCalled();
  });

  it("ends a running call when the page is left", async () => {
    await render();
    await fillAndStart();
    await act(async () => handlers.connected!());
    await act(async () => root.unmount());
    expect(widget.end).toHaveBeenCalledTimes(1);
    root = createRoot(container); // keep afterEach happy
  });
});
