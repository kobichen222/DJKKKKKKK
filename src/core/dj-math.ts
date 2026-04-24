/**
 * Pure DJ-math helpers extracted from the monolithic public/index.html.
 * These are intentionally kept free of any DOM or AudioContext reference
 * so they can be unit-tested under vitest without a browser.
 *
 * The production code still lives in public/index.html for the time
 * being; this module is the first step of the gradual
 * extraction-into-modules plan. Each function mirrors (and is kept in
 * sync with) its counterpart in index.html so that when we later swap
 * the in-browser copy for an import from a compiled bundle the
 * behaviour stays identical.
 */

/** Convert a linear amplitude (0..1) to dB. Returns -Infinity at zero. */
export function ampToDb(amp: number): number {
  if (amp <= 0) return -Infinity;
  return 20 * Math.log10(amp);
}

/** Convert dB back to linear amplitude. Clamps -Infinity to 0. */
export function dbToAmp(db: number): number {
  if (!isFinite(db)) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Camelot harmonic compatibility.
 * Two keys "harmonize" if they are equal, a relative major/minor
 * (same number, other letter), or one step around the wheel.
 * Follows the standard Mixed-In-Key wheel: 1A-12A (minor) / 1B-12B (major).
 */
export function isHarmonic(k1: string, k2: string): boolean {
  if (!k1 || !k2 || k1 === '--' || k2 === '--') return false;
  if (k1 === k2) return true;
  const m1 = /^(\d{1,2})([AB])$/.exec(k1);
  const m2 = /^(\d{1,2})([AB])$/.exec(k2);
  if (!m1 || !m2) return false;
  const n1 = parseInt(m1[1], 10), l1 = m1[2];
  const n2 = parseInt(m2[1], 10), l2 = m2[2];
  if (n1 < 1 || n1 > 12 || n2 < 1 || n2 > 12) return false;
  // Same number, different letter (major ↔ relative minor)
  if (n1 === n2 && l1 !== l2) return true;
  // One step around the wheel, same letter
  if (l1 === l2) {
    const fwd = (n1 % 12) + 1;
    const back = ((n1 - 2 + 12) % 12) + 1;
    return n2 === fwd || n2 === back;
  }
  return false;
}

/**
 * Compute the tempo-adjustment percent needed so a deck matches a
 * reference deck's current BPM.
 * Returns null if any input is missing or either BPM is non-positive.
 */
export function computeSyncPercent(
  selfBpm: number,
  otherBpm: number,
  otherTempoPct: number,
): number | null {
  if (!selfBpm || !otherBpm || selfBpm <= 0 || otherBpm <= 0) return null;
  const effectiveOther = otherBpm * (1 + otherTempoPct / 100);
  return (effectiveOther / selfBpm - 1) * 100;
}

/**
 * Determine whether a sync percent is within a deck's allowed tempo range.
 * Mirrors the guard in syncDeck() — keeps identical semantics.
 */
export function syncWithinRange(pct: number | null, range: number): boolean {
  if (pct == null || !isFinite(pct)) return false;
  return Math.abs(pct) <= (range || 8);
}

/**
 * Classify a CUE tap into an action, given the current deck state.
 * This is the exact decision tree used by cueDeck() and drives the
 * most common DJ interaction — pulling it out makes the edge cases
 * (at-cue vs off-cue, playing vs paused) individually testable.
 */
export type CueAction =
  | 'seek-and-pause'   // playing → jump back to cue and pause
  | 'set-cue'          // paused & away from cue → set a new cue here
  | 'seek-to-cue';     // paused & already near cue → jump exactly to cue

export function cueActionFor(opts: {
  playing: boolean;
  currentTime: number;
  cuePoint: number;
  tolerance?: number; // default 0.05s
}): CueAction {
  const tol = opts.tolerance ?? 0.05;
  if (opts.playing) return 'seek-and-pause';
  return Math.abs(opts.currentTime - opts.cuePoint) > tol ? 'set-cue' : 'seek-to-cue';
}

/**
 * Format seconds as mm:ss.d (used on deck displays).
 * Negative values render as "-" prefix.
 */
export function fmtTime(sec: number): string {
  if (!isFinite(sec)) return '--:--';
  const neg = sec < 0;
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const mm = String(m).padStart(2, '0');
  const ss = r.toFixed(1).padStart(4, '0'); // "05.3" → "05.3"
  return (neg ? '-' : '') + mm + ':' + ss;
}
