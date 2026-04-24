/**
 * Audio math — the helpers the SOUND-tab metering relies on.
 *
 * All of these used to live inline in renderStudioMeter() / the amp-bridge
 * code. Extracting them gives us a tested place for dB / LUFS / peak
 * formulas so subtle off-by-ones (say, K-weighting with the wrong offset)
 * show up in CI instead of on stage.
 */

/** dBFS of a linear peak amplitude (0..1). Returns -Infinity at zero. */
export function peakDb(peak: number): number {
  if (peak <= 0) return -Infinity;
  return 20 * Math.log10(peak);
}

/**
 * Root-mean-square amplitude of an interleaved time-domain frame.
 * Operates on raw Float32 samples in [-1, 1] as the analyser returns.
 */
export function rms(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** Peak amplitude (absolute max) of a time-domain frame. */
export function peak(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]!);
    if (a > m) m = a;
  }
  return m;
}

/**
 * Approximate LUFS-M from an RMS amplitude. The EBU-R128 spec applies a
 * K-weighting filter before RMS; here we use the standard -0.691 dB
 * offset that the spec subtracts, which is what the renderer has been
 * doing. Good enough for live metering; not calibrated for mastering
 * delivery — for that, run a full K-weight before calling rms().
 */
export function rmsToLufs(rmsAmp: number): number {
  if (rmsAmp <= 0) return -Infinity;
  return 20 * Math.log10(rmsAmp) - 0.691;
}

/**
 * Stereo phase correlation from two simultaneous L/R frames.
 * Returns a value in [-1, +1]:
 *   +1 = identical (mono)
 *    0 = uncorrelated / wide stereo
 *   -1 = inverted (out of phase — mono sum will cancel)
 */
export function phaseCorrelation(l: ArrayLike<number>, r: ArrayLike<number>): number {
  const n = Math.min(l.length, r.length);
  if (!n) return 0;
  let cov = 0, el = 0, er = 0;
  for (let i = 0; i < n; i++) {
    const a = l[i]!, b = r[i]!;
    cov += a * b;
    el += a * a;
    er += b * b;
  }
  const denom = Math.sqrt(el * er);
  if (denom < 1e-12) return 0;
  return cov / denom;
}

/**
 * Map a dB value into [0, 1] for a level meter fill. Values below `low`
 * clamp to 0, above `high` clamp to 1. -Infinity always → 0.
 */
export function dbToNorm(db: number, low = -60, high = 0): number {
  if (!isFinite(db)) return 0;
  if (high <= low) return 0;
  const t = (db - low) / (high - low);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Running LUFS-integrated accumulator. Mirrors the -70 LUFS absolute
 * gate from EBU-R128 so stretches of silence don't pull the integrated
 * value toward -∞.
 */
export function addToIntegrated(
  state: { sumPow10: number; count: number },
  lufsM: number,
): void {
  if (!isFinite(lufsM) || lufsM <= -70) return;
  state.sumPow10 += Math.pow(10, lufsM / 10);
  state.count += 1;
}

export function integratedLufs(state: { sumPow10: number; count: number }): number {
  if (!state.count) return -Infinity;
  return 10 * Math.log10(state.sumPow10 / state.count);
}

/** Compressor make-up gain from a dB amount. */
export function makeupLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Convert a 0..1 gain into dB (null gain → -Infinity). */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

/**
 * Goniometer rotation — returns the pair (x, y) for a single (L, R) sample
 * after rotating the coordinate system by -45°. This is what puts mono
 * content on the vertical axis and side content on the horizontal axis,
 * matching the real-world broadcast display. Visual only; no audio effect.
 */
export function gonioPoint(l: number, r: number): { x: number; y: number } {
  const inv = 1 / Math.SQRT2;
  return { x: (l - r) * inv, y: (l + r) * inv };
}
