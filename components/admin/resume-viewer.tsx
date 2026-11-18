"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { ResumePreviewFallback } from "./resume-preview-boundary";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const STEP = 0.25;

/**
 * PDF preview with our own controls: zoom in/out, fit width, and drag to pan.
 * 1x means the page fills the box width. The PDF is fetched in the browser from
 * a short-lived presigned S3 link, so the bucket CORS must allow GET.
 */
export function ResumeViewer(props: { url: string; fileName: string }) {
  return <ResumePreview key={props.url} {...props} />;
}

function ResumePreview({ url, fileName }: { url: string; fileName: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setBoxWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const zoomBy = useCallback((delta: number) => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round((z + delta) * 100) / 100)));
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setGrabbing(true);
    el.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    const start = drag.current;
    if (!el || !start) return;
    el.scrollLeft = start.left - (e.clientX - start.x);
    el.scrollTop = start.top - (e.clientY - start.y);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    setGrabbing(false);
    scrollRef.current?.releasePointerCapture(e.pointerId);
  }

  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-md border bg-background px-2 text-sm font-medium hover:border-primary disabled:opacity-40 disabled:hover:border-border";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Resume viewer">
        <button
          type="button"
          className={btn}
          onClick={() => zoomBy(-STEP)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          −
        </button>
        <span
          className="w-14 text-center text-sm tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className={btn}
          onClick={() => zoomBy(STEP)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          +
        </button>
        <button type="button" className={btn} onClick={() => setZoom(1)} disabled={zoom === 1}>
          Fit width
        </button>
        {pages > 1 && <span className="ml-auto text-xs text-muted-foreground">{pages} pages</span>}
      </div>

      <div
        ref={scrollRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`h-[75vh] min-h-[480px] touch-pan-y select-none overflow-auto rounded-lg border bg-muted/40 ${
          grabbing ? "cursor-grabbing" : zoom > 1 ? "cursor-grab" : ""
        }`}
      >
        {failed ? (
          <ResumePreviewFallback fileName={fileName} />
        ) : (
          <Document
            // react-pdf 11's Suspense mode throws even after onLoadError runs.
            // Use callback-based errors so an unreadable resume stays local.
            suspense={false}
            file={url}
            onLoadSuccess={({ numPages }) => setPages(numPages)}
            onLoadError={() => setFailed(true)}
            onSourceError={() => setFailed(true)}
            loading={<p className="p-4 text-sm text-muted-foreground">Loading resume…</p>}
            error={null}
            className="flex w-max min-w-full flex-col items-center gap-3 p-2"
          >
            {boxWidth > 0 &&
              Array.from({ length: pages }, (_, i) => (
                <Page
                  key={i}
                  pageNumber={i + 1}
                  suspense={false}
                  onLoadError={() => setFailed(true)}
                  onRenderError={() => setFailed(true)}
                  width={Math.max(1, Math.round((boxWidth - 16) * zoom))}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  className="shadow-sm"
                />
              ))}
          </Document>
        )}
      </div>
    </div>
  );
}
