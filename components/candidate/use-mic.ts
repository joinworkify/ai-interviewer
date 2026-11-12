"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MicState } from "@/lib/candidate/setup";

const HEARD_LEVEL = 0.04;
const SILENT_AFTER_MS = 8000;

/** Opens the microphone, reports a 0..1 level, and passes once a voice is heard. */
export function useMic() {
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMutedState] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (silentTimer.current) clearTimeout(silentTimer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close();
    raf.current = null;
    stream.current = null;
    ctx.current = null;
    setLevel(0);
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setState("unsupported");
      return;
    }
    setState("checking");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "silent");
      return;
    }
    ctx.current = new AudioContext();
    const analyser = ctx.current.createAnalyser();
    analyser.fftSize = 512;
    ctx.current.createMediaStreamSource(stream.current).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let heard = false;
    silentTimer.current = setTimeout(() => {
      if (!heard) setState("silent");
    }, SILENT_AFTER_MS);
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.min(1, Math.sqrt(sum / data.length) * 4);
      setLevel(rms);
      if (!heard && rms > HEARD_LEVEL) {
        heard = true;
        setState("ok");
      }
      raf.current = requestAnimationFrame(tick);
    };
    tick();
  }, [stop]);

  const setMuted = useCallback((m: boolean) => {
    stream.current?.getAudioTracks().forEach((t) => (t.enabled = !m));
    setMutedState(m);
  }, []);

  useEffect(() => stop, [stop]);

  return { state, level: muted ? 0 : level, muted, start, stop, setMuted };
}

/** Short test tone for the speaker check. */
export function playTestSound(sinkId?: string) {
  const ac = new AudioContext();
  // Chrome can route to a chosen speaker; other browsers use the default.
  if (sinkId) void (ac as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(sinkId);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = 660;
  gain.gain.value = 0.1;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.4);
  osc.onended = () => void ac.close();
}

/** Lists microphones and speakers (labels appear once mic permission is granted). */
export async function listAudioDevices(): Promise<{ mics: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }> {
  if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], speakers: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((d) => d.kind === "audioinput"),
    speakers: all.filter((d) => d.kind === "audiooutput"),
  };
}
