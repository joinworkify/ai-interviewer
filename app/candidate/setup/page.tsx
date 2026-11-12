"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MicLevel } from "@/components/candidate/mic-level";
import { listAudioDevices, playTestSound, useMic } from "@/components/candidate/use-mic";
import { setupGate } from "@/lib/candidate/setup";

const SELECT =
  "h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function SetupPage() {
  const attemptId = useSearchParams().get("attempt");
  const router = useRouter();
  const mic = useMic();
  const gate = setupGate(mic.state);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const [speakerId, setSpeakerId] = useState("");

  // Device names are only visible after mic permission, so refresh on each state change.
  useEffect(() => {
    listAudioDevices().then(({ mics, speakers }) => {
      setMics(mics);
      setSpeakers(speakers);
    });
  }, [mic.state]);

  // Setup only makes sense after consent created an attempt.
  if (!attemptId) {
    return (
      <p className="text-center text-sm">
        Please choose a role and give consent first.{" "}
        <Link href="/candidate/roles" className="font-medium text-primary underline">
          Go to roles
        </Link>
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 rounded-xl border bg-card p-6 shadow-sm">
      <h1 className="text-center text-3xl font-bold tracking-tight">Check your setup</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <select aria-label="Microphone (required)" className={SELECT} value={micId} onChange={(e) => setMicId(e.target.value)}>
              <option value="">Microphone (required)</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" className="h-9" onClick={() => mic.start(micId || undefined)}>
              Test mic
            </Button>
          </div>
          <MicLevel level={mic.level} />
          <div className="flex gap-2">
            <select aria-label="Speaker" className={SELECT} value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
              <option value="">Speaker</option>
              {speakers.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Speaker ${i + 1}`}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" className="h-9" onClick={() => playTestSound(speakerId || undefined)}>
              Play sound
            </Button>
          </div>
          <div className="rounded-md border p-3 text-center text-sm">
            Read aloud: &quot;I am ready to start my DataSea interview.&quot;
          </div>
        </div>
        <div className="flex flex-col gap-3">
          {mic.state === "blocked" && (
            <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
              Mic blocked: click the lock icon in the address bar and set Microphone to Allow, then refresh.
            </p>
          )}
          {mic.state === "ok" && (
            <p className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
              We can hear you. You&apos;re ready.
            </p>
          )}
          <Button variant="outline" onClick={() => mic.start(micId || undefined)}>
            Restart devices
          </Button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Button
          className="w-48"
          disabled={!gate.canStart}
          onClick={() => {
            mic.stop(); // the live screen opens its own stream
            router.push(`/candidate/live?attempt=${attemptId}`);
          }}
        >
          Start interview
        </Button>
        {gate.fix && <p className="text-sm text-destructive">{gate.fix}</p>}
        <p className="text-xs text-muted-foreground">
          Start is enabled only when the mic check passes. Leaving before Start doesn&apos;t use an attempt.
        </p>
      </div>
    </div>
  );
}
