"use client";

import dynamic from "next/dynamic";

import { ResumePreviewBoundary } from "./resume-preview-boundary";

// pdf.js needs browser APIs, so the viewer never renders on the server.
const LazyResumeViewer = dynamic(() => import("./resume-viewer").then((m) => m.ResumeViewer), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading resume…</p>,
});

export function ResumeViewer(props: { url: string; fileName: string }) {
  return (
    <ResumePreviewBoundary key={props.url} fileName={props.fileName}>
      <LazyResumeViewer {...props} />
    </ResumePreviewBoundary>
  );
}
