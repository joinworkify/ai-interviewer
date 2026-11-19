import type { IntegrityEvent } from "./events";

/**
 * Browser-only: watches for the candidate leaving the interview (tab hidden,
 * window unfocused, offline, full screen exit) and reports it. Best effort:
 * nothing here ever affects the interview, and a failed report is dropped.
 * Nothing about the page content or the candidate's screen is read.
 */

export interface IntegrityMonitor {
  /** Sends what is buffered and stops watching. */
  stop(): void;
}

const FLUSH_MS = 15_000;
/** Ignore focus flickers shorter than this (a tooltip, a system notification). */
const MIN_BLUR_MS = 1_500;

export function startIntegrityMonitor(args: {
  sessionId: string;
  /** Epoch ms when the interview started. */
  startedAt: number;
  fetchImpl?: typeof fetch;
}): IntegrityMonitor {
  const doFetch = args.fetchImpl ?? fetch;
  const url = `/api/sessions/${encodeURIComponent(args.sessionId)}/integrity`;
  let buffer: IntegrityEvent[] = [];
  let hiddenAt: number | null = null;
  let blurAt: number | null = null;
  let offlineAt: number | null = null;
  const since = () => Math.max(0, Date.now() - args.startedAt);

  const flush = () => {
    if (buffer.length === 0) return;
    const events = buffer.slice(0, 50);
    buffer = buffer.slice(50);
    void doFetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    }).catch(() => {});
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      buffer.push({ kind: "tab_hidden", atMs: Math.max(0, hiddenAt - args.startedAt), durationMs: Date.now() - hiddenAt });
      hiddenAt = null;
    }
  };
  const onBlur = () => {
    blurAt = Date.now();
  };
  const onFocus = () => {
    // A hidden tab also blurs the window; that is already counted as tab_hidden.
    if (blurAt !== null && hiddenAt === null && document.visibilityState === "visible") {
      const duration = Date.now() - blurAt;
      if (duration >= MIN_BLUR_MS) buffer.push({ kind: "window_blur", atMs: Math.max(0, blurAt - args.startedAt), durationMs: duration });
    }
    blurAt = null;
  };
  const onOffline = () => {
    offlineAt = Date.now();
  };
  const onOnline = () => {
    if (offlineAt !== null) {
      buffer.push({ kind: "offline", atMs: Math.max(0, offlineAt - args.startedAt), durationMs: Date.now() - offlineAt });
      offlineAt = null;
    }
  };
  const onFullscreen = () => {
    if (!document.fullscreenElement) buffer.push({ kind: "fullscreen_exit", atMs: since() });
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  document.addEventListener("fullscreenchange", onFullscreen);
  const timer = setInterval(flush, FLUSH_MS);

  return {
    stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("fullscreenchange", onFullscreen);
      // Close any span still open (the call ended while away).
      if (hiddenAt !== null) buffer.push({ kind: "tab_hidden", atMs: Math.max(0, hiddenAt - args.startedAt), durationMs: Date.now() - hiddenAt });
      while (buffer.length > 0) flush();
    },
  };
}
