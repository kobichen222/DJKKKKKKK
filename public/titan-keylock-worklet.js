/**
 * TITAN KEYLOCK — basic granular pitch-shifter as an AudioWorklet.
 *
 * How it's wired:
 *   source(buffer, playbackRate=r) → titan-keylock → trimGain → …
 *
 * The BufferSource runs at `r` to get the tempo change we want. That
 * also shifts pitch up/down by the same ratio. This worklet reverses
 * the pitch shift by resampling in short, windowed grains so the
 * harmonic content sounds like the original tempo.
 *
 * It's a granular pitch shifter in the time domain — not Elastique,
 * not even a proper phase vocoder. At ±8 % (the band DJs actually
 * use) it's a clear improvement over pitched-up playback; past that
 * the grain artefacts become audible. Good enough as a first pass,
 * and quality can be improved later without changing the routing.
 */

class TitanKeylockProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        // 1/r — when the source plays at rate r (and pitches up by r),
        // we resample by 1/r to push pitch back down. On (r=1.08) → pitch=1/1.08.
        name: 'pitch',
        defaultValue: 1,
        minValue: 0.5,
        maxValue: 2,
        automationRate: 'k-rate',
      },
      {
        // 0 = bypass (no pitch processing, pass-through), 1 = engaged.
        // A-rate so the renderer can ramp it smoothly when toggling.
        name: 'wet',
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: 'a-rate',
      },
    ];
  }

  constructor() {
    super();
    const GRAIN = 1024;        // samples — ~23ms at 44.1kHz
    const OVERLAP = 4;         // four grains overlapping for OLA = 75% overlap
    const MAX_CH = 2;

    this.grain = GRAIN;
    this.hop = GRAIN / OVERLAP;    // 256 samples between grain starts
    this.window = new Float32Array(GRAIN);
    for (let i = 0; i < GRAIN; i++) {
      // Hann window — standard for granular synthesis, low artefacts
      this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (GRAIN - 1));
    }

    // Per-channel ring buffer of recent input samples, and a write head.
    this.ringSize = GRAIN * 8;
    this.ring = [];
    this.writeHead = 0;
    for (let c = 0; c < MAX_CH; c++) this.ring.push(new Float32Array(this.ringSize));

    // Per-channel output accumulators — we overlap-add into these.
    this.out = [];
    for (let c = 0; c < MAX_CH; c++) this.out.push(new Float32Array(GRAIN * 2));
    this.outRead = 0;          // where the next `process()` call reads from
    this.outFill = 0;          // how many samples are valid ahead of outRead
    this.readHead = 0;         // fractional read position into ring (per pitch)
    this.hopsUntilNextGrain = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !output || !input.length) return true;

    const N = output[0].length;              // render quantum — always 128
    const channels = Math.min(input.length, output.length, this.ring.length);
    const wetParam = params.wet;
    const wetIsConstant = wetParam.length === 1;
    const pitch = Math.max(0.5, Math.min(2, params.pitch[0] || 1));

    for (let ch = 0; ch < channels; ch++) {
      const src = input[ch];
      const dst = output[ch];
      const ring = this.ring[ch];
      const out = this.out[ch];

      // 1. Write input into the ring for this channel
      for (let i = 0; i < N; i++) {
        ring[(this.writeHead + i) % this.ringSize] = src[i];
      }

      // 2. Emit grains when it's time to hop
      // One grain every `this.hop` samples of output.
      // (Only do this once for channel 0 — the read head is shared across channels.)
      if (ch === 0) {
        this.hopsUntilNextGrain -= N;
        while (this.hopsUntilNextGrain <= 0) {
          // Write a grain into every channel's accumulator
          for (let cc = 0; cc < channels; cc++) this._emitGrain(cc, pitch);
          this.hopsUntilNextGrain += this.hop;
        }
      }

      // 3. Read from the output accumulator; bypass-mix with the dry signal
      for (let i = 0; i < N; i++) {
        const wet = wetIsConstant ? wetParam[0] : wetParam[i];
        const wetSample = out[(this.outRead + i) % out.length];
        dst[i] = wetSample * wet + src[i] * (1 - wet);
        // Clear the slot we just consumed so the next hop can additively write
        out[(this.outRead + i) % out.length] = 0;
      }
    }

    this.writeHead = (this.writeHead + N) % this.ringSize;
    this.outRead = (this.outRead + N) % this.out[0].length;
    return true;
  }

  /**
   * Copy one windowed grain from the ring into the output accumulator,
   * resampled by `1 / pitch` so the grain is played back at a different
   * pitch without changing its time position.
   */
  _emitGrain(ch, pitch) {
    const ring = this.ring[ch];
    const out = this.out[ch];
    const G = this.grain;
    const ringLen = this.ringSize;
    // Read `grain` input samples centred ~half-a-grain back so we have
    // data on both sides of the write head
    const start = (this.writeHead - G + ringLen) % ringLen;
    // Resample stride: higher pitch shortens the window we pull from (we'll
    // need fewer samples to fill the grain).
    // Lower pitch stretches it. At pitch=1 stride is 1:1 and output = input.
    const stride = pitch;
    for (let i = 0; i < G; i++) {
      const srcIdx = start + i * stride;
      const i0 = Math.floor(srcIdx);
      const frac = srcIdx - i0;
      const a = ring[((i0) % ringLen + ringLen) % ringLen];
      const b = ring[((i0 + 1) % ringLen + ringLen) % ringLen];
      const sample = a + (b - a) * frac;
      const w = this.window[i];
      // Overlap-add into the accumulator. With Hann + 75% overlap the
      // windows sum to ~1.5; divide by that to keep amplitude sane.
      out[(this.outRead + i) % out.length] += (sample * w) / 1.5;
    }
  }
}

registerProcessor('titan-keylock', TitanKeylockProcessor);
