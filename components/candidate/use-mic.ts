"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MicState, SpeakerState } from "@/lib/candidate/setup";

const HEARD_LEVEL = 0.04;
const SILENT_AFTER_MS = 8000;
const TONE_HZ = 660;
const TONE_MS = 900;
/** The tone must stand this many dB above the surrounding frequencies. */
const TONE_MARGIN_DB = 12;

/** Opens the microphone, reports a 0..1 level, and passes once a voice is heard. */
export function useMic() {
  const [state, setState] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const [muted, setMutedState] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const raf = useRef<number | null>(null);
  const silentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toneAnalyser = useRef<AnalyserNode | null>(null);
  const [speaker, setSpeaker] = useState<SpeakerState>("idle");

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    if (silentTimer.current) clearTimeout(silentTimer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close();
    raf.current = null;
    stream.current = null;
    ctx.current = null;
    toneAnalyser.current = null;
    setLevel(0);
  }, []);

  /**
   * `raw` turns off echo cancellation and noise suppression, so the speaker
   * test tone is not filtered out before the microphone hears it.
   */
  const start = useCallback(async (deviceId?: string, raw = false) => {
    stop();
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setState("unsupported");
      return;
    }
    setState("checking");
    try {
      const audio: MediaTrackConstraints = {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        ...(raw ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {}),
      };
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: Object.keys(audio).length ? audio : true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setState(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "silent");
      return;
    }
    ctx.current = new AudioContext();
    const analyser = ctx.current.createAnalyser();
    analyser.fftSize = 512;
    const source = ctx.current.createMediaStreamSource(stream.current);
    source.connect(analyser);
    // A finer analyser for the speaker test: one bin per ~12 Hz.
    const fine = ctx.current.createAnalyser();
    fine.fftSize = 4096;
    source.connect(fine);
    toneAnalyser.current = fine;
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

  /**
   * Plays a test tone and listens with the open microphone for it. Passes when
   * the tone's frequency stands out of the room noise. Headphones keep the
   * tone out of the microphone, so `confirmSpeaker` lets the candidate say they
   * heard it instead.
   */
  const testSpeaker = useCallback(async (sinkId?: string) => {
    const analyser = toneAnalyser.current;
    if (!analyser) {
      setSpeaker("failed");
      return;
    }
    setSpeaker("playing");
    const bins = new Float32Array(analyser.frequencyBinCount);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const centre = Math.round(TONE_HZ / binHz);
    let heard = false;
    const sample = () => {
      analyser.getFloatFrequencyData(bins);
      let around = 0;
      let count = 0;
      for (let i = centre - 12; i <= centre + 12; i++) {
        if (Math.abs(i - centre) > 2 && bins[i] !== undefined && Number.isFinite(bins[i])) {
          around += bins[i];
          count++;
        }
      }
      const peak = Math.max(bins[centre - 1], bins[centre], bins[centre + 1]);
      if (count > 0 && peak - around / count > TONE_MARGIN_DB) heard = true;
    };
    const timer = setInterval(sample, 60);
    await playTestSound(sinkId, TONE_MS);
    clearInterval(timer);
    setSpeaker(heard ? "ok" : "failed");
  }, []);

  const confirmSpeaker = useCallback(() => setSpeaker("ok"), []);

  useEffect(() => stop, [stop]);

  return { state, level: muted ? 0 : level, muted, start, stop, setMuted, speaker, testSpeaker, confirmSpeaker };
}

/** Test tone for the speaker check; resolves when it has finished playing. */
export function playTestSound(sinkId?: string, durationMs = 400): Promise<void> {
  const ac = new AudioContext();
  // Chrome can route to a chosen speaker; other browsers use the default.
  if (sinkId) void (ac as AudioContext & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(sinkId);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.frequency.value = TONE_HZ;
  gain.gain.value = 0.25;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + durationMs / 1000);
  return new Promise((resolve) => {
    osc.onended = () => {
      void ac.close();
      resolve();
    };
  });
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
