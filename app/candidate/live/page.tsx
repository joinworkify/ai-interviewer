"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot, Mic, MicOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MicLevel } from "@/components/candidate/mic-level";
import { useMic } from "@/components/candidate/use-mic";
import { formatCountdown, RECONNECT_SECONDS } from "@/lib/candidate/setup";
import { createFakeVoiceSession, type Speaker, type VoiceStatus } from "@/lib/candidate/voice";

const STATUS_LABEL: Record<VoiceStatus, string> = {
  connecting: "Connecting...",
  connected: "Connected",
  reconnecting: "Reconnecting",
  ended: "Ended",
  failed: "Failed",
};

export default function LivePage() {
  const params = useSearchParams();
  const attemptId = params.get("attempt");
  const dropOnce = params.get("demo") === "drop";
  const router = useRouter();
  const mic = useMic();
  const { start: startMic } = mic;
  const [status, setStatus] = useState<VoiceStatus>("connecting");
  const [speaker, setSpeaker] = useState<Speaker>(null);
  const [caption, setCaption] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(RECONNECT_SECONDS);

  useEffect(() => {
    if (!attemptId) return;
    void startMic();
    const session = createFakeVoiceSession(
      { onStatus: setStatus, onSpeaker: setSpeaker, onCaption: setCaption },
      { dropOnce },
    );
    return () => session.stop();
  }, [attemptId, dropOnce, startMic]);

  // Finished: go to results.
  useEffect(() => {
    if (status !== "ended") return;
    const t = setTimeout(() => router.push(`/candidate/result?attempt=${attemptId}`), 1500);
    return () => clearTimeout(t);
  }, [status, attemptId, router]);

  // Dropped: 60s to come back, else the attempt is incomplete.
  useEffect(() => {
    if (status !== "reconnecting") {
      setSecondsLeft(RECONNECT_SECONDS);
      return;
    }
    const t = setInterval(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [status]);
  useEffect(() => {
    if (secondsLeft <= 0) router.push(`/candidate/result?attempt=${attemptId}&ended=early`);
  }, [secondsLeft, attemptId, router]);

  if (!attemptId) {
    return (
      <p className="text-center text-sm">
        No interview in progress.{" "}
        <Link href="/candidate/roles" className="underline">
          Go to roles
        </Link>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Badge
        variant={status === "connected" ? "default" : status === "failed" ? "destructive" : "secondary"}
        className="w-fit"
        aria-live="polite"
      >
        {STATUS_LABEL[status]}
      </Badge>


      <div className="grid gap-4 md:grid-cols-[1fr_240px]">
        <div className="flex flex-col items-center gap-6 rounded-xl border bg-card p-8 shadow-sm">
          <div
            className={`flex h-32 w-32 items-center justify-center rounded-full bg-primary/10 ${
              speaker === "interviewer" ? "animate-pulse ring-4 ring-primary/40" : ""
            }`}
          >
            <Bot className="h-12 w-12" />
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {speaker === "interviewer"
              ? "AI interviewer speaking..."
              : speaker === "candidate"
                ? "Your turn to answer"
                : status === "connecting"
                  ? "Connecting to interviewer..."
                  : ""}
          </p>
          <div className="w-full rounded-md border bg-muted/40 p-3 text-sm" aria-live="polite">
            <span className="sr-only">Caption: </span>
            {caption || "Captions will appear here."}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <p className="text-sm">Your mic level</p>
          <MicLevel level={mic.level} />
          <Button variant="outline" onClick={() => mic.setMuted(!mic.muted)}>
            {mic.muted ? <MicOff /> : <Mic />}
            {mic.muted ? "Unmute" : "Mute"}
          </Button>
          {/* shortcut: no help page yet, link it when support has one */}
          <Button variant="outline" onClick={() => alert("Help: if audio stops, check your mic and wait for the reconnect.")}>
            Help
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (confirm("End the interview now? It will count as an attempt.")) {
                router.push(`/candidate/result?attempt=${attemptId}&ended=early`);
              }
            }}
          >
            End interview
          </Button>
        </div>
      </div>
      {/* shortcut: auto-reconnect is the fake session's; SHH's voice socket drives it later */}
      {status === "reconnecting" && (
        <p role="alert" className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 text-sm">
          Connection lost, reconnecting... {formatCountdown(secondsLeft)} left (your answers are saved)
        </p>
      )}
    </div>
  );
}
