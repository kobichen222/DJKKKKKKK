/**
 * Per-deck EQ math — the gain + kill-switch semantics used by every
 * channel strip on the mixer, extracted so its edge cases (full kill,
 * boost clamp, ±12 dB mapping from a normalized knob) can't regress.
 *
 * TITAN uses a 4-band EQ on each deck: Low (shelf), LoMid (peak),
 * HiMid (peak), High (shelf). The renderer's knobs deliver a value in
 * [-1, 1]; these helpers convert to dB and honour the KILL switches.
 */

export type EqBand = 'low' | 'loMid' | 'hiMid' | 'high';

export interface EqState {
  low: number;     // -1..+1 normalized knob position
  loMid: number;
  hiMid: number;
  high: number;
  killLow: boolean;
  killMid: boolean;
  killHi: boolean;
}

export function createEq(): EqState {
  return { low: 0, loMid: 0, hiMid: 0, high: 0, killLow: false, killMid: false, killHi: false };
}

/** Map a normalized knob (-1..+1) to dB (-26..+12), slight asymmetric cut. */
export function knobToDb(knob: number): number {
  if (!isFinite(knob)) return 0;
  const k = Math.max(-1, Math.min(1, knob));
  // Cut goes deeper than boost — common mixer convention that makes
  // EQ kill feel snappier without over-boosting.
  return k >= 0 ? k * 12 : k * 26;
}

/** dB threshold below which output is inaudible on a loud PA. */
export const KILL_DB = -80;

/**
 * Resolve a single EQ band to its current dB gain, factoring kill switches.
 * The renderer applies this to the BiquadFilter's `.gain.value`.
 */
export function bandDb(state: EqState, band: EqBand): number {
  if (band === 'low' && state.killLow) return KILL_DB;
  if (band === 'high' && state.killHi) return KILL_DB;
  if ((band === 'loMid' || band === 'hiMid') && state.killMid) return KILL_DB;
  return knobToDb(state[band]);
}

/** All four bands in a single snapshot — handy for tests + the renderer. */
export function allBandsDb(state: EqState): Record<EqBand, number> {
  return {
    low: bandDb(state, 'low'),
    loMid: bandDb(state, 'loMid'),
    hiMid: bandDb(state, 'hiMid'),
    high: bandDb(state, 'high'),
  };
}

/** A kill flip sets the boolean and leaves the knob value intact. */
export function toggleKill(state: EqState, band: 'low' | 'mid' | 'hi'): EqState {
  if (band === 'low') return { ...state, killLow: !state.killLow };
  if (band === 'hi') return { ...state, killHi: !state.killHi };
  return { ...state, killMid: !state.killMid };
}

/**
 * Simple biquad magnitude response at `freq` for a peaking / shelving
 * filter with the given centre frequency and dB gain. Good enough for
 * the spectrum overlay drawn behind the EQ curve; NOT a replacement for
 * the actual Web-Audio `getFrequencyResponse`.
 *
 *   shelf: log-cosine rolloff that approaches `gain` at the shelf side
 *   peak:  bell around centre with a Q-ish width
 */
export function approxBandResponseDb(
  kind: 'lowshelf' | 'highshelf' | 'peak',
  centreHz: number,
  freqHz: number,
  gainDb: number,
  q = 1,
): number {
  if (gainDb === 0 || freqHz <= 0 || centreHz <= 0) return 0;
  const logF = Math.log2(freqHz);
  const logC = Math.log2(centreHz);
  const d = logF - logC;
  if (kind === 'lowshelf') {
    // Full gain below centre, smoothly down to 0 above
    const t = 1 - sigmoid(d * 1.4);
    return gainDb * t;
  }
  if (kind === 'highshelf') {
    const t = sigmoid(d * 1.4);
    return gainDb * t;
  }
  // peak — Gaussian-ish bell
  const width = 1 / Math.max(0.1, q);
  return gainDb * Math.exp(-(d * d) / (2 * width * width));
}

/** Compose the full 4-band response at a given frequency (in dB). */
export function totalResponseDb(
  state: EqState,
  freqHz: number,
  centres = { low: 120, loMid: 500, hiMid: 2500, high: 8000 },
): number {
  const g = allBandsDb(state);
  return (
    approxBandResponseDb('lowshelf',  centres.low,   freqHz, g.low)
  + approxBandResponseDb('peak',      centres.loMid, freqHz, g.loMid)
  + approxBandResponseDb('peak',      centres.hiMid, freqHz, g.hiMid)
  + approxBandResponseDb('highshelf', centres.high,  freqHz, g.high)
  );
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
