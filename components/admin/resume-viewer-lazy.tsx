"use client";

import dynamic from "next/dynamic";

// pdf.js needs browser APIs, so the viewer never renders on the server.
export const ResumeViewer = dynamic(
  () => import("./resume-viewer").then((m) => m.ResumeViewer),
  {
    ssr: false,
    loading: () => <p className="text-sm text-muted-foreground">Loading resume…</p>,
  },
);
