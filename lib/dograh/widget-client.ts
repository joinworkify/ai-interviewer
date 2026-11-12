/**
 * Browser helpers for the Dograh voice widget. No server imports: this file is
 * bundled into the client component.
 *
 * The widget API is the one Dograh documents for its "Headless" embed:
 * window.DograhWidget.start(), end(), setContext(), and the onCallConnected,
 * onCallDisconnected, onCallEnd, onStatusChange and onError callbacks.
 */

export interface DograhWidgetApi {
  start: () => unknown;
  end: () => unknown;
  setContext: (context: Record<string, string>) => unknown;
  onCallConnected?: (cb: (info: { workflowRunId?: unknown }) => void) => unknown;
  onCallDisconnected?: (cb: (info: { workflowRunId?: unknown; durationSeconds?: unknown }) => void) => unknown;
  onCallEnd?: (cb: () => void) => unknown;
  onStatusChange?: (cb: (status: string) => void) => unknown;
  onError?: (cb: (error: unknown) => void) => unknown;
}

declare global {
  interface Window {
    DograhWidget?: DograhWidgetApi;
  }
}

export interface DograhSessionRequest {
  sessionId: string;
  role: string;
  level: string;
  techstack: string;
}

export type DograhSessionResult =
  | { ok: true; contextVariables: Record<string, string> }
  | { ok: false; status: number; message: string };

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === "string")
  );
}

/** Asks the server for the signed call context. Messages shown to the user come from our own API only. */
export async function requestDograhSession(
  body: DograhSessionRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<DograhSessionResult> {
  try {
    const res = await fetchImpl("/api/dograh/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => null);
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    if (res.ok && record.success === true && isStringRecord(record.contextVariables)) {
      return { ok: true, contextVariables: record.contextVariables };
    }
    const message =
      typeof record.message === "string" && record.message.length > 0
        ? record.message.slice(0, 200)
        : "Could not start the interview.";
    return { ok: false, status: res.status, message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }
}

export interface LoadWidgetOptions {
  timeoutMs?: number;
  win?: Window;
}

/** Loads the widget script once and resolves with window.DograhWidget. */
export function loadDograhWidget(
  src: string,
  options: LoadWidgetOptions = {},
): Promise<DograhWidgetApi> {
  const win = options.win ?? window;
  const doc = win.document;
  const timeoutMs = options.timeoutMs ?? 8000;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const fail = () => reject(new Error("widget_unavailable"));
    const waitForGlobal = () => {
      if (win.DograhWidget) return resolve(win.DograhWidget);
      if (Date.now() > deadline) return fail();
      setTimeout(waitForGlobal, 50);
    };

    if (win.DograhWidget) return resolve(win.DograhWidget);
    let script = doc.querySelector<HTMLScriptElement>("script[data-dograh-widget]");
    if (!script) {
      script = doc.createElement("script");
      script.src = src;
      script.async = true;
      script.setAttribute("data-dograh-widget", "true");
      script.addEventListener("error", () => {
        script?.remove(); // let a retry load it again
        fail();
      });
      doc.head.appendChild(script);
    }
    script.addEventListener("load", waitForGlobal);
    // The script may already have finished loading on an earlier attempt.
    waitForGlobal();
  });
}

export interface WaitForSavedOptions {
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * After a call ends, Dograh posts the transcript to our webhook a few seconds
 * later. Polls the session until it is no longer "in_progress".
 */
export async function waitForSessionSaved(
  sessionId: string,
  options: WaitForSavedOptions = {},
): Promise<"saved" | "timeout"> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const interval = options.intervalMs ?? 2000;
  const timeout = options.timeoutMs ?? 30_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const start = now();

  while (now() - start < timeout) {
    if (options.signal?.aborted) return "timeout";
    try {
      const res = await fetchImpl(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        credentials: "same-origin",
        signal: options.signal,
      });
      if (res.ok) {
        const json: unknown = await res.json().catch(() => null);
        const status = (json as { session?: { status?: unknown } } | null)?.session?.status;
        if (typeof status === "string" && status !== "in_progress") return "saved";
      }
    } catch {
      // Ignore one failed poll; the next one may work.
    }
    await sleep(interval);
  }
  return "timeout";
}
