"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

type State = "idle" | "starting" | "live" | "saving" | "saved" | "failed" | "denied";

const WIDTH = 480;
const HEIGHT = 360;
/** Keeps the JPEG well under the server's 300 KB cap. */
const QUALITY = 0.7;

/**
 * Optional camera snapshot at setup, shown only to a DataSea reviewer. The
 * camera is on only while the preview is open and is stopped as soon as the
 * photo is taken. Skipping is allowed; the reviewer just sees there is no photo.
 */
export function IdentityCapture({ attemptId }: { attemptId: string }) {
  const [state, setState] = useState<State>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  async function open() {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: WIDTH }, height: { ideal: HEIGHT }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setState("live");
      // The <video> mounts on the next render.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setState("denied");
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    setState("saving");
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = Math.round((WIDTH * video.videoHeight) / video.videoWidth) || HEIGHT;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    const image = canvas.toDataURL("image/jpeg", QUALITY);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(attemptId)}/identity`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image }),
      });
      setState(res.ok ? "saved" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <section aria-labelledby="photo-heading" className="flex flex-col gap-3 rounded-lg border bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="photo-heading" className="font-sans text-sm font-semibold">
          3. Photo (optional)
        </h2>
        <span
          className={`rounded-full px-2.5 py-0.5 font-sans text-xs font-medium ${
            state === "saved" ? "bg-green-600/10 text-green-700" : "bg-muted text-muted-foreground"
          }`}
        >
          {state === "saved" ? "Saved" : "Skipped"}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Take one photo so a reviewer can confirm who took the interview. Only DataSea reviewers see it. The camera
        turns off right after the photo, and you can skip this step.
      </p>

      {(state === "live" || state === "saving") && (
        <div className="flex flex-col items-start gap-2">
          <video ref={videoRef} muted playsInline className="w-full max-w-xs rounded-md border bg-black" aria-label="Camera preview" />
          <Button size="sm" onClick={() => void capture()} disabled={state === "saving"}>
            {state === "saving" ? "Saving..." : "Take photo"}
          </Button>
        </div>
      )}
      {(state === "idle" || state === "saved" || state === "failed" || state === "denied") && (
        <Button size="sm" variant="secondary" className="w-fit" onClick={() => void open()}>
          {state === "saved" ? "Retake photo" : "Open camera"}
        </Button>
      )}
      {state === "starting" && <p className="text-sm text-muted-foreground">Waiting for your camera…</p>}
      {state === "denied" && (
        <p role="alert" className="text-sm text-muted-foreground">
          The camera isn&apos;t available. You can continue without a photo.
        </p>
      )}
      {state === "failed" && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t save the photo. Try again, or continue without it.
        </p>
      )}
    </section>
  );
}
