/**
 * AudioWorklet that forwards raw mono Float32 microphone frames to the main
 * thread in ~2048-frame batches (about 43 ms at 48 kHz). Resampling to
 * 16 kHz and PCM16 conversion happen on the main thread
 * (lib/gemini-live/audio.ts), where they are unit-tested.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Float32Array(2048);
    this.length = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const n = Math.min(channel.length - offset, this.batch.length - this.length);
        this.batch.set(channel.subarray(offset, offset + n), this.length);
        this.length += n;
        offset += n;
        if (this.length === this.batch.length) {
          const out = this.batch;
          this.port.postMessage(out, [out.buffer]);
          this.batch = new Float32Array(2048);
          this.length = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
