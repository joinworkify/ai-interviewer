// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * DOM check for the transcript hand-off in GeminiLiveInterview. Only the
 * browser transport and `fetch` are fake; the controller, the sync helper and
 * the component are real, under React StrictMode.
 */

const SID = "22222222-2222-4222-8222-222222222222";

const tokenBodies: unknown[] = [];
let sessionCallbacks: { onmessage: (m: object) => void } | null = null;

vi.mock("@/lib/gemini-live/browser", () => ({
  browserControllerDeps: {
    startMicrophone: async () => ({ sampleRate: 48000, stop: () => {} }),
    requestToken: async (details: unknown) => {
      tokenBodies.push(details);
      return { token: "auth_tokens/fake", model: "gemini-3.8-live", maxSessionSeconds: 300 };
    },
    connect: async ({ callbacks }: { callbacks: { onmessage: (m: object) => void } }) => {
      sessionCallbacks = callbacks;
      return { sendRealtimeInput: () => {}, sendToolResponse: () => {}, close: () => {} };
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
const fetchMock = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  tokenBodies.length = 0;
  sessionCallbacks = null;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(label: RegExp): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) => label.test(x.textContent ?? ""));
  if (!b) throw new Error(`button ${label} not found; have: ${container.textContent}`);
  return b as HTMLButtonElement;
}

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

async function startInterview(sessionId?: string) {
  await act(async () => {
    root.render(
      createElement(StrictMode, null, createElement(GeminiLiveInterview, { configured: true, sessionId })),
    );
  });
  await act(async () => {
    setValue(container.querySelector<HTMLInputElement>("#gl-role")!, "Backend Engineer");
    setValue(container.querySelector<HTMLInputElement>("#gl-stack")!, "Go, PostgreSQL");
  });
  await act(async () => button(/start interview/i).click());
  await settle();
  await act(async () => {
    sessionCallbacks!.onmessage({ serverContent: { outputTranscription: { text: "Hello." }, turnComplete: true } });
    sessionCallbacks!.onmessage({ serverContent: { inputTranscription: { text: "Hi there." } } });
  });
}

describe("GeminiLiveInterview transcript saving", () => {
  it("sends the sessionId with the token request and PUTs the transcript on End", async () => {
    await startInterview(SID);
    expect(tokenBodies[0]).toMatchObject({ role: "Backend Engineer", sessionId: SID });

    await act(async () => button(/end interview/i).click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/sessions/${SID}/transcript`);
    expect(init).toMatchObject({ method: "PUT", keepalive: true, credentials: "same-origin" });
    expect(JSON.parse(init.body)).toEqual({
      source: "client_gemini_live",
      payload: {
        entries: [
          { speaker: "interviewer", text: "Hello." },
          { speaker: "candidate", text: "Hi there." },
        ],
        durationSeconds: expect.any(Number),
        endedReason: "user_ended",
      },
    });
    expect(container.textContent).toContain("Transcript saved to your interview session.");
    // Download stays available.
    expect(container.textContent).toContain("Download session JSON");
  });

  it("does not link or save anything without a sessionId", async () => {
    await startInterview();
    expect(tokenBodies[0]).not.toHaveProperty("sessionId");
    await act(async () => button(/end interview/i).click());
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Nothing is saved");
  });

  it("closing the tab (pagehide) ends the session and saves with page_closed", async () => {
    await startInterview(SID);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload.endedReason).toBe("page_closed");
  });

  it("unmounting during an interview saves the transcript once", async () => {
    await startInterview(SID);
    await act(async () => root.unmount());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload.endedReason).toBe("page_closed");
    root = createRoot(container); // afterEach unmounts again
  });

  it("shows an error and keeps the download when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    await startInterview(SID);
    await act(async () => button(/end interview/i).click());
    await settle();
    expect(container.textContent).toContain("Could not save the transcript");
    expect(container.textContent).toContain("Download session JSON");
  });
});
