/**
 * Pure audio helpers for the Gemini Live interviewer (no browser APIs, so they
 * run in unit tests).
 *
 * Live API audio formats (https://ai.google.dev/gemini-api/docs/live-api):
 *  - input:  raw little-endian 16-bit PCM, mono, 16 kHz ("audio/pcm;rate=16000")
 *  - output: raw little-endian 16-bit PCM, mono, 24 kHz
 */

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;
/** 100 ms of 16 kHz audio per websocket message. */
export const DEFAULT_CHUNK_SAMPLES = 1_600;

/** Float32 [-1, 1] -> Int16, clamped and rounded. NaN becomes silence. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (Number.isNaN(s)) s = 0;
    s = s > 1 ? 1 : s < -1 ? -1 : s;
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Int16 -> Float32 in [-1, 1). */
export function pcm16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / 0x8000;
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  // Build the binary string in slices: String.fromCharCode(...hugeArray)
  // overflows the call stack.
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + step) as unknown as number[],
    );
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Int16 samples -> base64 of little-endian bytes (independent of host endianness). */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  return bytesToBase64(bytes);
}

/** base64 little-endian PCM16 -> Int16 samples. A trailing odd byte is dropped. */
export function base64ToPcm16(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  const count = bytes.length >> 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

/** Reads `rate=` from e.g. "audio/pcm;rate=24000"; defaults to 24 kHz. */
export function parsePcmSampleRate(mimeType: string | undefined): number {
  const match = /(?:^|;)\s*rate=(\d{3,6})\s*(?:;|$)/i.exec(mimeType ?? "");
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : OUTPUT_SAMPLE_RATE;
}

/**
 * Streaming sample-rate converter for mono Float32 audio.
 *
 * Output sample j covers the input interval [j*in/out, (j+1)*in/out) in
 * absolute input-sample positions, so results do not depend on how the input
 * is chunked and fractional ratios (44.1 kHz -> 16 kHz) do not drift.
 *  - downsampling: overlap-weighted box average (simple anti-alias filter)
 *  - upsampling:   linear interpolation
 */
export class StreamingResampler {
  private buffer = new Float32Array(0);
  /** Absolute input index of buffer[0]. */
  private bufferStart = 0;
  /** Absolute index of the next output sample. */
  private outIndex = 0;

  constructor(
    readonly inputRate: number,
    readonly outputRate: number,
  ) {
    for (const r of [inputRate, outputRate]) {
      if (!Number.isFinite(r) || r <= 0) {
        throw new RangeError(`Invalid sample rate: ${r}`);
      }
    }
  }

  private pos(j: number): number {
    return (j * this.inputRate) / this.outputRate;
  }

  process(chunk: Float32Array): Float32Array {
    if (this.inputRate === this.outputRate) return chunk.slice();

    const merged = new Float32Array(this.buffer.length + chunk.length);
    merged.set(this.buffer, 0);
    merged.set(chunk, this.buffer.length);
    const base = this.bufferStart;
    const end = base + merged.length; // exclusive absolute end
    const down = this.inputRate > this.outputRate;

    const capacity =
      Math.ceil((merged.length * this.outputRate) / this.inputRate) + 2;
    const out = new Float32Array(capacity);
    let n = 0;

    for (;;) {
      const s = this.pos(this.outIndex);
      if (down) {
        const e = this.pos(this.outIndex + 1);
        if (e > end) break;
        let acc = 0;
        let weight = 0;
        for (let k = Math.floor(s); k < e; k++) {
          const overlap = Math.min(k + 1, e) - Math.max(k, s);
          acc += merged[k - base] * overlap;
          weight += overlap;
        }
        out[n++] = weight > 0 ? acc / weight : 0;
      } else {
        const k = Math.floor(s);
        if (k + 1 >= end) break;
        const a = merged[k - base];
        const b = merged[k + 1 - base];
        out[n++] = a + (b - a) * (s - k);
      }
      this.outIndex++;
    }

    const keepFrom = Math.max(0, Math.floor(this.pos(this.outIndex)) - base);
    this.buffer = merged.slice(keepFrom);
    this.bufferStart = base + keepFrom;
    return out.slice(0, n);
  }
}

/**
 * Microphone frames (any rate) -> fixed-size base64 PCM16 16 kHz chunks ready
 * for `session.sendRealtimeInput({ audio: { data, mimeType: INPUT_MIME_TYPE } })`.
 */
export class MicChunkEncoder {
  private readonly resampler: StreamingResampler;
  private pending = new Int16Array(0);
  private pendingLength = 0;

  constructor(
    inputRate: number,
    private readonly chunkSamples: number = DEFAULT_CHUNK_SAMPLES,
  ) {
    this.resampler = new StreamingResampler(inputRate, INPUT_SAMPLE_RATE);
  }

  push(frames: Float32Array): string[] {
    const pcm = floatToPcm16(this.resampler.process(frames));
    const needed = this.pendingLength + pcm.length;
    if (needed > this.pending.length) {
      const grown = new Int16Array(Math.max(needed, this.chunkSamples * 2));
      grown.set(this.pending.subarray(0, this.pendingLength));
      this.pending = grown;
    }
    this.pending.set(pcm, this.pendingLength);
    this.pendingLength = needed;

    const chunks: string[] = [];
    let offset = 0;
    while (this.pendingLength - offset >= this.chunkSamples) {
      chunks.push(
        pcm16ToBase64(this.pending.subarray(offset, offset + this.chunkSamples)),
      );
      offset += this.chunkSamples;
    }
    if (offset > 0) {
      this.pending.copyWithin(0, offset, this.pendingLength);
      this.pendingLength -= offset;
    }
    return chunks;
  }

  /** Emits whatever is buffered (shorter than a full chunk). */
  flush(): string[] {
    if (this.pendingLength === 0) return [];
    const chunk = pcm16ToBase64(this.pending.subarray(0, this.pendingLength));
    this.pendingLength = 0;
    return [chunk];
  }
}
