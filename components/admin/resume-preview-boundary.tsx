"use client";

import { Component, type ReactNode } from "react";

export function ResumePreviewFallback({ fileName }: { fileName: string }) {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Could not show the preview for {fileName}. Use Download resume instead.
    </p>
  );
}

// Keep chunk-loading and unexpected React render failures inside the preview,
// leaving the review form and its separately signed download link available.
export class ResumePreviewBoundary extends Component<
  { fileName: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <ResumePreviewFallback fileName={this.props.fileName} />
    ) : (
      this.props.children
    );
  }
}
