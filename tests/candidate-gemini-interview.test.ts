// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * DOM check for the candidate's Gemini Live interview. Only the browser
 * transport, routing, the role lookup and `fetch` are fake; the controller,
 * the transcript sync and the component are real, under React StrictMode.
 */

const ATTEMPT = "22222222-2222-4222-8222-222222222222";

const tokenBodies: unknown[] = [];
let sessionCallbacks: { onmessage: (m: object) => void } | null = null;
const push = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(`attempt=${ATTEMPT}&role=software-engineer`),
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/candidate/api", () => ({
  getRole: async () => ({ id: "software-engineer", title: "Software Engineer", skills: ["TypeScript", "Go"] }),
}));

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

const { GeminiInterview } = await import("@/components/candidate/gemini-interview");

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  tokenBodies.length = 0;
  sessionCallbacks = null;
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", () => true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(label: RegExp): HTMLButtonElement {
  const b = [...container.querySelectorAll("button")].find((x) => label.test(x.textContent ?? ""));
  if (!b) throw new Error(`button ${label} not found; have: ${container.textContent}`);
  return b as HTMLButtonElement;
}

async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); });
}

async function startInterview() {
  await act(async () => {
    root.render(createElement(StrictMode, null, createElement(GeminiInterview)));
  });
  await settle();
  await act(async () => button(/start interview/i).click());
  await settle();
  await act(async () => {
    sessionCallbacks!.onmessage({ serverContent: { outputTranscription: { text: "Hello." }, turnComplete: true } });
    sessionCallbacks!.onmessage({ serverContent: { inputTranscription: { text: "Hi there." } } });
  });
}

describe("GeminiInterview (candidate)", () => {
  it("asks for a token linked to this attempt and the applied role", async () => {
    await startInterview();
    expect(tokenBodies[0]).toMatchObject({ role: "Software Engineer", sessionId: ATTEMPT });
  });

  it("saves the transcript to the attempt on End, then opens the result page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await startInterview();
      await act(async () => button(/end interview/i).click());
      await settle();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`/api/sessions/${ATTEMPT}/transcript`);
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
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(push).toHaveBeenCalledWith(`/candidate/result?attempt=${ATTEMPT}`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closing the tab ends the call and saves it as page_closed", async () => {
    await startInterview();
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload.endedReason).toBe("page_closed");
  });

  it("going offline shows the connection-lost screen, saves the answers and opens the report form", async () => {
    await startInterview();
    await act(async () => window.dispatchEvent(new Event("offline")));
    await settle();
    expect(container.textContent).toMatch(/Your connection was lost at 0:\d\d\./);
    expect(container.textContent).toContain("Your answers so far are saved.");
    expect(container.querySelector("select")?.value).toBe("lost_internet");
    const retry = [...container.querySelectorAll("a")].find((a) => /try again/i.test(a.textContent ?? ""));
    expect(retry?.getAttribute("href")).toBe("/candidate/consent?role=software-engineer");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/sessions/${ATTEMPT}/transcript`);
    expect(JSON.parse(init.body).payload.endedReason).toBe("error");
  });

  it("shows the conversation live, including the candidate's words while they speak", async () => {
    await startInterview();
    const log = container.querySelector('[role="log"]')!;
    expect(log.textContent).toContain("Interviewer said: Hello.");
    expect(log.textContent).toContain("You said: Hi there.");
    await act(async () => {
      sessionCallbacks!.onmessage({ serverContent: { inputTranscription: { text: " I build APIs" } } });
    });
    expect(log.textContent).toContain("Hi there. I build APIs");
  });
});
