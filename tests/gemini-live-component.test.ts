// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";

/**
 * DOM regression for the real GeminiLiveInterview component under React
 * StrictMode. Only the browser transport (mic / token / Live socket / audio
 * output) is replaced by fakes; the controller and form are real.
 */

const counters = { mics: 0, micStops: 0, tokens: 0, connects: 0, closes: 0, kickoffs: 0 };

vi.mock("@/lib/gemini-live/browser", () => ({
  browserControllerDeps: {
    startMicrophone: async () => {
      counters.mics++;
      return { sampleRate: 48000, stop: () => void counters.micStops++ };
    },
    requestToken: async () => {
      counters.tokens++;
      return { token: "auth_tokens/fake", model: "gemini-3.8-live", maxSessionSeconds: 300 };
    },
    connect: async () => {
      counters.connects++;
      return {
        sendRealtimeInput: (p: { text?: string }) => {
          if (p.text) counters.kickoffs++;
        },
        sendToolResponse: () => {},
        close: () => void counters.closes++,
      };
    },
    createPlayer: () => ({
      resume: async () => {},
      enqueue: () => {},
      clear: () => {},
      remainingMs: () => 0,
      close: () => {},
    }),
  },
}));

const { GeminiLiveInterview } = await import("@/components/interview/gemini-live-interview");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0;
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

/**
 * Real user-click semantics. In a browser, a user click runs a microtask
 * checkpoint after each listener returns, *before* the button's activation
 * behavior (form submit). React 19 commits the re-render in that microtask,
 * so the DOM can change (e.g. button type) before activation. Script
 * `el.click()` in jsdom never reaches a checkpoint, and act() defers the
 * render even further, which hides the bug. Emulate the checkpoint with a
 * window bubble listener (runs after React's root listener) that flushes
 * pending React work synchronously.
 */
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
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

describe("GeminiLiveInterview (DOM, StrictMode)", () => {
  it("End interview ends the session and never submits the form / restarts", async () => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(GeminiLiveInterview, { configured: true })));
    });
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>("#gl-role")!, "Backend Engineer");
      setValue(container.querySelector<HTMLInputElement>("#gl-stack")!, "Go, PostgreSQL");
    });

    const submits = vi.fn();
    container.querySelector("form")!.addEventListener("submit", submits);

    await act(async () => button(/start interview/i).click());
    await settle();
    expect(container.textContent).toContain("Interview in progress");
    expect(counters.connects).toBe(1);
    expect(submits).toHaveBeenCalledTimes(1);

    nativeClick(button(/end interview/i));
    await settle();

    expect(submits).toHaveBeenCalledTimes(1); // End did not submit
    expect(counters.connects).toBe(1);
    expect(counters.tokens).toBe(1);
    expect(counters.mics).toBe(1);
    expect(counters.closes).toBe(1);
    expect(counters.micStops).toBe(1);
    expect(counters.kickoffs).toBe(1);
    expect(container.textContent).toContain("Interview ended");
    expect(button(/start again/i).type).toBe("submit");
  });

  it("Start again after End starts exactly one new session", async () => {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(GeminiLiveInterview, { configured: true })));
    });
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>("#gl-role")!, "SRE");
      setValue(container.querySelector<HTMLInputElement>("#gl-stack")!, "Kubernetes");
    });
    await act(async () => button(/start interview/i).click());
    await settle();
    nativeClick(button(/end interview/i));
    await settle();
    await act(async () => button(/start again/i).click());
    await settle();
    expect(container.textContent).toContain("Interview in progress");
    expect(counters.connects).toBe(2);
    expect(counters.closes).toBe(1);
  });
});
