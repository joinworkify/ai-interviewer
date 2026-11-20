"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StepGate } from "@/components/candidate/step-gate";
import { Button } from "@/components/ui/button";
import { MicLevel } from "@/components/candidate/mic-level";
import { listAudioDevices, useMic } from "@/components/candidate/use-mic";
import { IdentityCapture } from "@/components/candidate/identity-capture";
import { setupGate } from "@/lib/candidate/setup";
import { stepHref } from "@/lib/candidate/steps";

const SELECT =
  "h-9 min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export default function SetupPage() {
  return (
    <StepGate step="setup">
      <SetupStep />
    </StepGate>
  );
}

function SetupStep() {
  const params = useSearchParams();
  const attemptId = params.get("attempt");
  const roleId = params.get("role");
  const router = useRouter();
  const mic = useMic();
  const gate = setupGate(mic.state, mic.speaker);
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

  const micOk = mic.state === "ok";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-xl border bg-white p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-1.5 text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check your setup</h1>
        <p className="text-sm text-muted-foreground">
          Test your microphone, then your speaker. Both must pass before you can start.
        </p>
      </div>

      <section aria-labelledby="mic-heading" className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="mic-heading" className="font-sans text-sm font-semibold">
            1. Microphone
          </h2>
          <StatusChip ok={micOk} pending={mic.state === "checking"} okLabel="Working" />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <select
            aria-label="Microphone (required)"
            className={SELECT}
            value={micId}
            onChange={(e) => setMicId(e.target.value)}
          >
            <option value="">Default microphone</option>
            {mics.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            className="h-9 w-28 shrink-0"
            onClick={() => mic.start(micId || undefined, true)}
          >
            {micOk ? "Retest mic" : "Test mic"}
          </Button>
        </div>
        <MicLevel level={mic.level} />
        <p className="text-sm text-muted-foreground">
          Read aloud: &quot;I am ready to start my DataSea interview.&quot;
        </p>
        {mic.state === "blocked" && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm"
          >
            Mic blocked: click the lock icon in the address bar and set Microphone to Allow, then
            refresh.
          </p>
        )}
        {micOk && (
          <p className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
            We can hear you. Now test your speaker.
          </p>
        )}
      </section>

      <section
        aria-labelledby="speaker-heading"
        className={`flex flex-col gap-3 rounded-lg border p-4 ${micOk ? "" : "opacity-60"}`}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="speaker-heading" className="font-sans text-sm font-semibold">
            2. Speaker
          </h2>
          <StatusChip
            ok={mic.speaker === "ok"}
            pending={mic.speaker === "playing"}
            okLabel="Working"
          />
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <select
            aria-label="Speaker"
            className={SELECT}
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          >
            <option value="">Default speaker</option>
            {speakers.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Speaker ${i + 1}`}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="secondary"
            className="h-9 w-28 shrink-0"
            disabled={!micOk || mic.speaker === "playing"}
            onClick={() => void mic.testSpeaker(speakerId || undefined)}
          >
            {mic.speaker === "playing" ? "Playing..." : "Play sound"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {micOk
            ? "We play a short tone and listen for it with your microphone."
            : "Test your microphone first. The speaker test uses it to listen."}
        </p>
        {mic.speaker === "failed" && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
          >
            <p>
              We didn&apos;t pick up the tone. Turn up the volume and try again. With headphones the
              microphone can&apos;t hear it.
            </p>
            <Button size="sm" variant="outline" className="h-8 w-fit" onClick={mic.confirmSpeaker}>
              I heard the sound
            </Button>
          </div>
        )}
        {mic.speaker === "ok" && (
          <p className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm">
            Your speaker works.
          </p>
        )}
      </section>

      <IdentityCapture attemptId={attemptId} />

      <div className="flex flex-col items-center gap-3 text-center">
        <Button
          className="w-full sm:w-48"
          disabled={!gate.canStart}
          onClick={() => {
            mic.stop(); // the live screen opens its own stream
            const role = roleId ? `&role=${encodeURIComponent(roleId)}` : "";
            router.push(`/candidate/live?attempt=${encodeURIComponent(attemptId)}${role}`);
          }}
        >
          Start interview
        </Button>
        {gate.fix && <p className="text-sm text-destructive">{gate.fix}</p>}
        <p className="text-xs leading-5 text-muted-foreground">
          Start is enabled only when the microphone and speaker checks pass. Leaving before Start
          doesn&apos;t use an attempt.
        </p>
        {roleId && (
          <Link
            href={stepHref("consent", roleId, attemptId) ?? "/candidate/roles"}
            onClick={() => mic.stop()}
            className="text-xs text-muted-foreground/80 hover:text-foreground hover:underline"
          >
            Back
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusChip({ ok, pending, okLabel }: { ok: boolean; pending: boolean; okLabel: string }) {
  const label = ok ? okLabel : pending ? "Checking" : "Not tested";
  const style = ok
    ? "bg-green-600/10 text-green-700"
    : pending
      ? "bg-amber-500/10 text-amber-700"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded-full px-2.5 py-0.5 font-sans text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
