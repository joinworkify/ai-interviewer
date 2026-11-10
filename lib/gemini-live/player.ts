import { base64ToPcm16, OUTPUT_SAMPLE_RATE, pcm16ToFloat } from "./audio";

/**
 * Gapless playback queue for Gemini Live PCM16 output (24 kHz by default).
 *
 * Each chunk becomes an AudioBuffer scheduled to start exactly when the
 * previous one ends. `clear()` stops all scheduled sources at once — used on
 * `serverContent.interrupted` (barge-in). Works against a minimal
 * AudioContext-shaped interface so it can be tested without a browser.
 * AudioBuffers are created at the chunk's own rate; the browser resamples to
 * the device rate.
 */

export interface AudioBufferLike {
  readonly length: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceLike {
  buffer: AudioBufferLike | null;
  onended: ((ev: Event) => unknown) | null;
  connect(destination: never): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): BufferSourceLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

/** Small lead so the first chunk (or one after an underrun) is not clipped. */
const START_LEAD_SECONDS = 0.05;

export class PcmPlayer {
  private readonly sources = new Set<BufferSourceLike>();
  private nextStartTime = 0;
  private playing = false;
  private closed = false;

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly onPlayingChange?: (playing: boolean) => void,
  ) {}

  /** Call from a user gesture (Start click) so autoplay policies allow output. */
  async resume(): Promise<void> {
    if (!this.closed && this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(base64: string, sampleRate: number = OUTPUT_SAMPLE_RATE): void {
    if (this.closed || !base64) return;
    const samples = pcm16ToFloat(base64ToPcm16(base64));
    if (samples.length === 0) return;

    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination as never);

    const startAt = Math.max(
      this.nextStartTime,
      this.ctx.currentTime + START_LEAD_SECONDS,
    );
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
      if (this.sources.size === 0) this.setPlaying(false);
    };
    this.setPlaying(true);
  }

  /** Barge-in: drop everything queued or playing, immediately. */
  clear(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // not started / already stopped
      }
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.setPlaying(false);
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Milliseconds of audio still queued/playing. */
  remainingMs(): number {
    if (this.sources.size === 0) return 0;
    return Math.max(0, this.nextStartTime - this.ctx.currentTime) * 1000;
  }

  close(): void {
    if (this.closed) return;
    this.clear();
    this.closed = true;
    void this.ctx.close().catch(() => {});
  }

  private setPlaying(playing: boolean) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.onPlayingChange?.(playing);
  }
}
