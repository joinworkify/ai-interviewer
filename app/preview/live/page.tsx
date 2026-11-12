"use client";

import {useState} from "react";
import Link from "next/link";
import {Header} from "@/components/header";
import {useMicrophone} from "@/lib/mic";

type Status = "connecting" | "connected" | "reconnecting" | "failed";

const status_text: Record<Status, string> = {
  connecting: "Connecting...",
  connected: "Connected",
  reconnecting: "Connection lost, reconnecting...",
  failed: "Could not connect. Please try again.",
};

export default function LivePage() {
  const [status, setStatus] = useState<Status>("connected");
  const mic = useMicrophone();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <Header />
      <main className="flex-1 p-6">
        <div className="mx-auto max-w-4xl space-y-4">
          <span className="inline-block rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
            {status_text[status]}
          </span>

          <div className="grid gap-4 md:grid-cols-[1fr_240px]">
            <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="flex h-40 w-40 items-center justify-center rounded-full bg-zinc-300 text-center text-sm text-slate-900">
                SHH AI interviewer speaking...
              </div>
              <div className="w-full rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm text-slate-500">
                Some yapping stuff
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs text-slate-500">Your mic level</p>
              <div className="h-3 rounded bg-slate-200">
                <div
                  className="h-3 rounded bg-emerald-500"
                  style={{ width: `${Math.round(mic.level * 100)}%` }}
                />
              </div>

              {!mic.enabled ? (
                <button
                  onClick={mic.start}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-900 hover:bg-slate-50"
                >
                  Enable microphone
                </button>
              ) : (
                <button
                  onClick={mic.toggleMute}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-900 hover:bg-slate-50"
                >
                  {mic.muted ? "Unmute" : "Mute"}
                </button>
              )}
              {mic.error && <p className="text-xs text-rose-600">{mic.error}</p>}

              <button className="w-full rounded-lg border border-slate-300 bg-white py-2 text-sm text-slate-900 hover:bg-slate-50">
                Help
              </button>
              <Link
                href="/preview/result"
                className="block rounded-lg bg-rose-600 py-2 text-center text-sm font-semibold text-white hover:bg-rose-500"
              >
                End interview
              </Link>
            </div>
          </div>

          {status !== "connected" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-center text-sm text-amber-800">
              {status_text[status]}
            </div>
          )}

          <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
            Test status:
            {(["connecting", "connected", "reconnecting", "failed"] as Status[]).map((s) => (
              <button key={s} onClick={() => setStatus(s)} className="underline">
                {s}
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}