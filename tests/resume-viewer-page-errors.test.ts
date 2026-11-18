// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

const state = vi.hoisted(() => ({ failure: "render" as "render" | "load" }));
// Canvas is unavailable in jsdom. Exercise the documented page error callback seam;
// the separate parser integration suite uses the real Document and PDF.js worker.
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} },
  Document: ({ children, onLoadSuccess }: { children: ReactNode; onLoadSuccess: (pdf: { numPages: number }) => void }) => {
    useEffect(() => { onLoadSuccess({ numPages: 1 }); }, [onLoadSuccess]);
    return createElement("div", null, children);
  },
  Page: ({ onRenderError, onLoadError }: { onRenderError?: (error: Error) => void; onLoadError?: (error: Error) => void }) => {
    useEffect(() => {
      (state.failure === "render" ? onRenderError : onLoadError)?.(new Error("synthetic page failure"));
    }, [onLoadError, onRenderError]);
    return createElement("p", null, "Page failed");
  },
}));
import { ResumeViewer } from "@/components/admin/resume-viewer";
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(["render", "load"] as const)("uses the safe preview fallback after a page %s error", async (failure) => {
  state.failure = failure;
  await act(async () => root.render(createElement("section", null,
    createElement("h1", null, "Review interview"),
    createElement(ResumeViewer, { url: "/resume.pdf", fileName: "resume.pdf" }),
    createElement("a", { href: "/existing-download" }, "Download resume"))));
  expect(container.textContent).toContain("Could not show the preview for resume.pdf");
  expect(container.querySelector("h1")).not.toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/existing-download");
});
