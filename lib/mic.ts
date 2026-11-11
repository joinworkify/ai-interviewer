"use client";

import {useCallback, useEffect, useRef, useState} from "react";

export function useMicrophone() {
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false); // mic is on here
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0); 
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    streamRef.current = null;
    audioCtxRef.current = null;
    setEnabled(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audioCtxRef.current = ctx;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(peak / 64, 1));
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
      setEnabled(true);
      setMuted(false);
    } catch {
      setError("Microphone blocked. Allow it in the address bar, then try again.");
    }
  }, []);

  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  useEffect(() => stop, [stop]);

  return { enabled, muted, level, error, start, toggleMute };
}