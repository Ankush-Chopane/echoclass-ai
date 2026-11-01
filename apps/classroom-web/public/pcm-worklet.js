// AudioWorklet: converts microphone audio to 16 kHz mono 16-bit PCM in ~100 ms chunks for the offline (Vosk) recogniser.
// Served as a normal same-origin file because the app's Content-Security-Policy does not allow blob: scripts.
class PcmChunker extends AudioWorkletProcessor {
  constructor() {
    super();
    this.target = 16000; this.step = sampleRate / this.target; this.pos = 0; this.out = new Int16Array(1600); this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // linear-interpolation resampler (a no-op ratio of 1 when the context already runs at 16 kHz)
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos), f = this.pos - i, a = ch[i], b = i + 1 < ch.length ? ch[i + 1] : a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.out.length) { this.port.postMessage(this.out.buffer, [this.out.buffer]); this.out = new Int16Array(1600); this.n = 0; }
      this.pos += this.step;
    }
    this.pos -= ch.length;
    return true;
  }
}
registerProcessor('pcm-chunker', PcmChunker);
