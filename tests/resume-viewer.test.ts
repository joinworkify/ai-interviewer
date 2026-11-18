// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, Component, createElement, Suspense, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRequire } from "node:module";

// PDF.js's Node legacy entry supplies the same DOM polyfills its worker needs.
await import("pdfjs-dist/legacy/build/pdf.mjs");
const { pdfjs } = await import("react-pdf");
const { ResumeViewer } = await import("@/components/admin/resume-viewer");
pdfjs.GlobalWorkerOptions.workerSrc = createRequire(import.meta.url).resolve(
  "pdfjs-dist/build/pdf.worker.mjs",
);

class ReviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed
      ? createElement("p", null, "Entire review failed")
      : this.props.children;
  }
}
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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
function review(url: string) {
  return createElement(
    ReviewBoundary,
    null,
    createElement("h1", null, "Review interview"),
    createElement(
      Suspense,
      { fallback: "Loading preview" },
      createElement(ResumeViewer, { url, fileName: "resume.pdf" }),
    ),
    createElement("a", { href: "/existing-download" }, "Download resume"),
  );
}
const malformed = "data:application/pdf;base64," + btoa("%PDF-1.7\nmalformed bytes");
// A real, minimal PDF with an accurate xref table (no external fixtures/network).
function validPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>",
  ];
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 4\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return "data:application/pdf;base64," + btoa(pdf);
}
async function settle() {
  for (let i = 0; i < 30; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (
      container.textContent?.includes("Could not show") ||
      container.textContent?.includes("Entire review failed")
    )
      break;
  }
}
it("contains an actual malformed PDF parser rejection without replacing the review or its download", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(review(malformed)));
  await settle();
  expect(container.textContent).toContain("Could not show the preview for resume.pdf");
  expect(container.querySelector("h1")?.textContent).toBe("Review interview");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/existing-download");
  expect(container.textContent).not.toContain("Entire review failed");
  // Non-Suspense react-pdf reports a warning; it must not become an uncaught React failure.
  expect(errors.mock.calls.some((args) => args[0] instanceof Error)).toBe(false);
  expect(errors.mock.calls.flat().join(" ")).toContain(
    "InvalidPDFException: Invalid PDF structure.",
  );
});
it("shows a local fallback when the data URI source cannot be decoded", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(review("data:application/pdf;base64,%%%")));
  await settle();
  expect(container.textContent).toContain("Could not show the preview for resume.pdf");
  expect(container.querySelector("h1")).not.toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/existing-download");
});

it("resets a failed preview when its URL changes and loads a valid PDF", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(review(malformed)));
  await settle();
  expect(container.textContent).toContain("Could not show");
  await act(async () => root.render(review(validPdf())));
  await settle();
  expect(container.textContent).not.toContain("Could not show");
  expect(container.querySelector(".react-pdf__Document")).not.toBeNull();
  expect(container.querySelector(".react-pdf__Document--loading")).toBeNull();
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(),
  );
  expect(container.textContent).toContain("125%");
});
