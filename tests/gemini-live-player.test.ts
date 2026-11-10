import { describe, expect, it } from "vitest";
import { pcm16ToBase64 } from "@/lib/gemini-live/audio";
import {
  PcmPlayer,
  type AudioContextLike,
  type AudioBufferLike,
  type BufferSourceLike,
} from "@/lib/gemini-live/player";

class FakeBuffer implements AudioBufferLike {
  readonly data: Float32Array;
  constructor(
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = new Float32Array(length);
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData() {
    return this.data;
  }
}

class FakeSource implements BufferSourceLike {
  buffer: AudioBufferLike | null = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stopped = false;
  connected = false;
  connect() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  start(when: number) {
    this.startedAt = when;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext implements AudioContextLike {
  currentTime = 0;
  state = "suspended";
  destination = {};
  sources: FakeSource[] = [];
  buffers: FakeBuffer[] = [];
  closed = false;
  resumed = 0;
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const b = new FakeBuffer(length, sampleRate);
    this.buffers.push(b);
    return b;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async resume() {
    this.resumed++;
    this.state = "running";
  }
  async close() {
    this.closed = true;
    this.state = "closed";
  }
}

function chunk(samples: number, value = 16384) {
  return pcm16ToBase64(new Int16Array(samples).fill(value));
}

describe("PcmPlayer", () => {
  it("decodes PCM16 at the given rate into buffers", () => {
    const ctx = new FakeContext();
    const p = new PcmPlayer(ctx);
    p.enqueue(chunk(2400), 24000);
    expect(ctx.buffers[0].sampleRate).toBe(24000);
    expect(ctx.buffers[0].length).toBe(2400);
    expect(ctx.buffers[0].data[0]).toBe(0.5);
    expect(ctx.sources[0].connected).toBe(true);
  });

  it("schedules chunks back-to-back without gaps", () => {
    const ctx = new FakeContext();
    const p = new PcmPlayer(ctx);
    p.enqueue(chunk(2400), 24000); // 100 ms
    p.enqueue(chunk(4800), 24000); // 200 ms
    p.enqueue(chunk(1200), 24000); // 50 ms
    const [a, b, c] = ctx.sources.map((s) => s.startedAt!);
    expect(a).toBeCloseTo(0.05, 6); // initial lead time
    expect(b).toBeCloseTo(0.15, 6);
    expect(c).toBeCloseTo(0.35, 6);
    expect(p.remainingMs()).toBeCloseTo(400, 3);
  });

  it("re-anchors after an underrun instead of scheduling in the past", () => {
    const ctx = new FakeContext();
    const p = new PcmPlayer(ctx);
    p.enqueue(chunk(2400), 24000);
    ctx.currentTime = 5;
    p.enqueue(chunk(2400), 24000);
    expect(ctx.sources[1].startedAt).toBeCloseTo(5.05, 6);
  });

  it("clear() stops every queued source immediately and resets the timeline", () => {
    const ctx = new FakeContext();
    const changes: boolean[] = [];
    const p = new PcmPlayer(ctx, (playing) => changes.push(playing));
    p.enqueue(chunk(2400), 24000);
    p.enqueue(chunk(2400), 24000);
    expect(p.isPlaying()).toBe(true);
    p.clear();
    expect(ctx.sources.every((s) => s.stopped && !s.connected)).toBe(true);
    expect(p.isPlaying()).toBe(false);
    expect(p.remainingMs()).toBe(0);
    expect(changes).toEqual([true, false]);
    // Next chunk starts fresh at currentTime + lead.
    ctx.currentTime = 0.01;
    p.enqueue(chunk(240), 24000);
    expect(ctx.sources[2].startedAt).toBeCloseTo(0.06, 6);
  });

  it("reports idle once all sources ended", () => {
    const ctx = new FakeContext();
    const changes: boolean[] = [];
    const p = new PcmPlayer(ctx, (playing) => changes.push(playing));
    p.enqueue(chunk(240), 24000);
    p.enqueue(chunk(240), 24000);
    ctx.sources[0].onended?.();
    expect(p.isPlaying()).toBe(true);
    ctx.sources[1].onended?.();
    expect(p.isPlaying()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("ignores empty chunks and anything after close()", async () => {
    const ctx = new FakeContext();
    const p = new PcmPlayer(ctx);
    p.enqueue("", 24000);
    expect(ctx.sources).toHaveLength(0);
    await p.resume();
    expect(ctx.resumed).toBe(1);
    p.enqueue(chunk(240), 24000);
    p.close();
    expect(ctx.closed).toBe(true);
    expect(ctx.sources[0].stopped).toBe(true);
    p.enqueue(chunk(240), 24000);
    expect(ctx.sources).toHaveLength(1);
    p.close(); // idempotent
  });
});
