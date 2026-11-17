// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, lazy, Suspense, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";

const state = vi.hoisted(() => ({ failure: "render" as "render" | "import" | "none" }));
// Preserve the lazy-loading/rejected-promise behavior without Next's router runtime.
vi.mock("next/dynamic", () => ({
  default: () => {
    const Viewer = lazy(async () => {
      if (state.failure === "import") throw new Error("private chunk URL import failure");
      return { default: () => {
        if (state.failure === "render") throw new Error("private PDF render failure");
        return createElement("p", null, "Valid preview");
      } };
    });
    return (props: object) => createElement(Suspense, { fallback: "Loading preview" }, createElement(Viewer, props));
  },
}));
let root: Root;
let container: HTMLDivElement;
let ResumeViewer: ComponentType<{ url: string; fileName: string }>;
beforeEach(async () => {
  vi.resetModules();
  ({ ResumeViewer } = await import("@/components/admin/resume-viewer-lazy"));
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => {}); // React reports caught boundary failures in development.
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function review(url: string) {
  return createElement("section", null,
    createElement("h1", null, "Review interview"),
    createElement(ResumeViewer, { url, fileName: "resume.pdf" }),
    createElement("a", { href: "/existing-download" }, "Download resume"));
}
it.each(["render", "import"] as const)("contains a lazy viewer %s failure without losing the review", async (failure) => {
  state.failure = failure;
  await act(async () => root.render(review("/bad.pdf")));
  expect(container.textContent).toContain("Could not show the preview for resume.pdf");
  expect(container.textContent).not.toContain("private");
  expect(container.querySelector("h1")?.textContent).toBe("Review interview");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/existing-download");
});
it("resets the render error boundary for a different resume URL", async () => {
  state.failure = "render";
  await act(async () => root.render(review("/bad.pdf")));
  expect(container.textContent).toContain("Could not show");
  state.failure = "none";
  await act(async () => root.render(review("/valid.pdf")));
  expect(container.textContent).toContain("Valid preview");
  expect(container.textContent).not.toContain("Could not show");
});
