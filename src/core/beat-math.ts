/**
 * Beat / bar math — pure helpers for beatgrid + phase-aligned sync.
 *
 * Currently the production sync just matches playback rate; a phase-aware
 * sync also needs to know where the *next* downbeat on each deck is so it
 * can quantize the seek. These helpers run in a vacuum (no audio, no DOM)
 * so they can be tested, then called from the in-browser player.
 */

/** Seconds per beat at a given BPM. 0 / negative → 0. */
export function beatDuration(bpm: number): number {
  if (!bpm || bpm <= 0) return 0;
  return 60 / bpm;
}

/** Seconds per bar (assuming 4 beats / bar). */
export function barDuration(bpm: number, beatsPerBar = 4): number {
  return beatDuration(bpm) * beatsPerBar;
}

/**
 * Given the deck's current playback position (seconds), an anchor time
 * that is known to sit exactly on beat 1 of a bar (the beatgrid origin),
 * and BPM, return the fractional "beat phase" in [0, 1) where 0 = on
 * the downbeat and 0.5 = halfway to the next downbeat.
 */
export function beatPhase(
  currentTime: number,
  gridAnchor: number,
  bpm: number,
  beatsPerBar = 4,
): number {
  const bd = barDuration(bpm, beatsPerBar);
  if (bd <= 0) return 0;
  // Position inside the current bar, wrapped into [0, bd).
  const rel = ((currentTime - gridAnchor) % bd + bd) % bd;
  return rel / bd;
}

/**
 * Snap a seek target to the nearest beatgrid beat (NOT bar).
 * Used by "Quantize" mode when the user hits a hot cue — the deck
 * should land on the next beat boundary so the transition feels tight.
 * If snapForward is true, always round up to the next beat ahead.
 */
export function snapToBeat(
  targetTime: number,
  gridAnchor: number,
  bpm: number,
  snapForward = false,
): number {
  const bd = beatDuration(bpm);
  if (bd <= 0) return targetTime;
  const rel = (targetTime - gridAnchor) / bd;
  const snapped = snapForward ? Math.ceil(rel) : Math.round(rel);
  return gridAnchor + snapped * bd;
}

/**
 * Compute the phase offset (in seconds) between two decks.
 * Positive means `self` is ahead of `other`'s next downbeat.
 * A phase-aligned sync adds this offset back into the self deck so the
 * downbeats land together.
 */
export function phaseOffsetSeconds(
  self: { currentTime: number; gridAnchor: number; bpm: number },
  other: { currentTime: number; gridAnchor: number; bpm: number },
  beatsPerBar = 4,
): number {
  const pSelf = beatPhase(self.currentTime, self.gridAnchor, self.bpm, beatsPerBar);
  const pOther = beatPhase(other.currentTime, other.gridAnchor, other.bpm, beatsPerBar);
  let diff = pSelf - pOther;
  // Wrap into [-0.5, 0.5] so the nearest adjustment is returned
  if (diff > 0.5) diff -= 1;
  if (diff < -0.5) diff += 1;
  return diff * barDuration(self.bpm, beatsPerBar);
}

/**
 * Check whether two decks are "beat-locked" within a tolerance
 * (defaults to 10 ms, the threshold below which a trained DJ ear
 * cannot hear the drift).
 */
export function isBeatLocked(
  offsetSec: number,
  toleranceMs = 10,
): boolean {
  return Math.abs(offsetSec) * 1000 <= toleranceMs;
}
