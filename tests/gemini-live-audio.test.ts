import { describe, expect, it } from "vitest";
import {
  base64ToPcm16,
  floatToPcm16,
  INPUT_MIME_TYPE,
  MicChunkEncoder,
  parsePcmSampleRate,
  pcm16ToBase64,
  pcm16ToFloat,
  StreamingResampler,
} from "@/lib/gemini-live/audio";

describe("floatToPcm16", () => {
  it("scales, rounds and clamps Float32 samples to signed 16-bit", () => {
    const out = floatToPcm16(
      new Float32Array([0, 1, -1, 0.5, -0.5, 2, -3, Number.NaN, 1e-6]),
    );
    expect(Array.from(out)).toEqual([
      0, 32767, -32768, 16384, -16384, 32767, -32768, 0, 0,
    ]);
  });
});

describe("pcm16 <-> base64", () => {
  it("encodes little-endian bytes", () => {
    // 1 -> 01 00, -2 -> FE FF, 256 -> 00 01
    const b64 = pcm16ToBase64(new Int16Array([1, -2, 256]));
    expect(Buffer.from(b64, "base64")).toEqual(
      Buffer.from([0x01, 0x00, 0xfe, 0xff, 0x00, 0x01]),
    );
  });

  it("round-trips large buffers (chunked string building)", () => {
    const samples = new Int16Array(100_000);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = ((i * 7919) % 65536) - 32768;
    }
    const decoded = base64ToPcm16(pcm16ToBase64(samples));
    expect(decoded).toEqual(samples);
  });

  it("decodes base64 produced elsewhere and ignores a trailing odd byte", () => {
    const b64 = Buffer.from([0xff, 0x7f, 0x00, 0x80, 0x12]).toString("base64");
    expect(Array.from(base64ToPcm16(b64))).toEqual([32767, -32768]);
  });

  it("converts PCM16 back to floats in [-1, 1)", () => {
    expect(Array.from(pcm16ToFloat(new Int16Array([0, -32768, 16384])))).toEqual(
      [0, -1, 0.5],
    );
  });
});

describe("parsePcmSampleRate", () => {
  it("reads the rate parameter and defaults to 24 kHz output", () => {
    expect(parsePcmSampleRate("audio/pcm;rate=24000")).toBe(24000);
    expect(parsePcmSampleRate("audio/pcm; rate=16000")).toBe(16000);
    expect(parsePcmSampleRate("audio/pcm")).toBe(24000);
    expect(parsePcmSampleRate(undefined)).toBe(24000);
    expect(parsePcmSampleRate("audio/pcm;rate=abc")).toBe(24000);
  });
});

function sine(freq: number, rate: number, n: number, offset = 0): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * freq * (i + offset)) / rate);
  }
  return out;
}

describe("StreamingResampler", () => {
  it("rejects invalid rates", () => {
    expect(() => new StreamingResampler(0, 16000)).toThrow();
    expect(() => new StreamingResampler(48000, Number.NaN)).toThrow();
  });

  it("passes audio through unchanged when rates match", () => {
    const r = new StreamingResampler(16000, 16000);
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(Array.from(r.process(input))).toEqual(Array.from(input));
  });

  it("downsamples 48 kHz -> 16 kHz by averaging each 3-sample window", () => {
    const r = new StreamingResampler(48000, 16000);
    const out = r.process(new Float32Array([0, 0.3, 0.6, 0.3, 0.3, 0.3, 1]));
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.3, 6);
    expect(out[1]).toBeCloseTo(0.3, 6);
  });

  it("produces identical output regardless of chunk boundaries", () => {
    const input = sine(440, 44100, 44100);
    const whole = new StreamingResampler(44100, 16000).process(input);

    const chunked = new StreamingResampler(44100, 16000);
    const parts: number[] = [];
    let pos = 0;
    const sizes = [1, 127, 128, 333, 4096, 7, 2048];
    let k = 0;
    while (pos < input.length) {
      const size = sizes[k++ % sizes.length];
      parts.push(...chunked.process(input.subarray(pos, pos + size)));
      pos += size;
    }
    expect(parts.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) {
      expect(parts[i]).toBeCloseTo(whole[i], 6);
    }
  });

  it("keeps the 16 kHz output length proportional for 44.1 kHz and 48 kHz", () => {
    expect(
      new StreamingResampler(44100, 16000).process(new Float32Array(44100)).length,
    ).toBe(16000);
    expect(
      new StreamingResampler(48000, 16000).process(new Float32Array(48000)).length,
    ).toBe(16000);
  });

  it("preserves a low-frequency tone after downsampling", () => {
    const out = new StreamingResampler(48000, 16000).process(
      sine(440, 48000, 4800),
    );
    // Box filter over 3 samples centred at 3i+1 -> phase aligns to i + 1/3.
    for (let i = 10; i < out.length - 10; i++) {
      const expected = 0.5 * Math.sin((2 * Math.PI * 440 * (3 * i + 1)) / 48000);
      expect(Math.abs(out[i] - expected)).toBeLessThan(0.01);
    }
  });

  it("upsamples with linear interpolation", () => {
    const r = new StreamingResampler(8000, 16000);
    const a = r.process(new Float32Array([0, 1]));
    const b = r.process(new Float32Array([0]));
    expect([...a, ...b]).toEqual([0, 0.5, 1, 0.5]);
  });
});

describe("MicChunkEncoder", () => {
  it("resamples to 16 kHz PCM16 and emits base64 chunks of the configured size", () => {
    const enc = new MicChunkEncoder(48000, 1600);
    // 0.25 s of constant 0.5 at 48 kHz -> 4000 samples at 16 kHz.
    const frames = new Float32Array(12000).fill(0.5);
    const chunks = [
      ...enc.push(frames.subarray(0, 5000)),
      ...enc.push(frames.subarray(5000)),
    ];
    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      const pcm = base64ToPcm16(c);
      expect(pcm.length).toBe(1600);
      expect(pcm.every((s) => s === 16384)).toBe(true);
    }
    const rest = enc.flush();
    expect(rest).toHaveLength(1);
    expect(base64ToPcm16(rest[0]).length).toBe(800);
    expect(enc.flush()).toEqual([]);
  });

  it("uses the Live API input mime type", () => {
    expect(INPUT_MIME_TYPE).toBe("audio/pcm;rate=16000");
  });
});
