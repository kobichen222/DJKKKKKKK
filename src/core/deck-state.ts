/**
 * Pure deck-state transitions.
 *
 * The browser side still owns the AudioBufferSourceNode lifecycle, but the
 * *decisions* about what a PLAY / PAUSE / CUE / SEEK / LOOP action should do
 * are pulled out here so they can be exercised under vitest without a real
 * audio graph. This is the first non-math module to come out of the 18 k-line
 * monolith — the pattern is: compute the next state + emit an action list,
 * let the DOM/audio layer apply the side-effects.
 */

export interface DeckState {
  playing: boolean;
  offset: number;             // seconds into the track
  cuePoint: number;
  bufferDuration: number;     // 0 if no buffer loaded
  playbackRate: number;       // 1.0 = normal
  loop: { start: number | null; end: number | null; active: boolean; loopInSet: boolean };
  hotCues: Record<number, number>;
}

export function createDeck(initial?: Partial<DeckState>): DeckState {
  return {
    playing: false,
    offset: 0,
    cuePoint: 0,
    bufferDuration: 0,
    playbackRate: 1,
    loop: { start: null, end: null, active: false, loopInSet: false },
    hotCues: {},
    ...initial,
  };
}

/**
 * Clamp a seek target so it can never walk off the edges of the loaded buffer.
 */
export function clampSeek(target: number, bufferDuration: number): number {
  if (!bufferDuration || bufferDuration <= 0) return 0;
  if (target < 0) return 0;
  if (target > bufferDuration) return bufferDuration;
  return target;
}

/**
 * Compute the next offset given the currently-playing deck and wall-clock
 * delta. Callers pass in the absolute number of seconds elapsed since the
 * deck started playing; this helper applies the playbackRate so a +8 %
 * pitched deck actually advances 1.08× as much.
 */
export function projectOffset(
  d: DeckState,
  secondsElapsed: number,
): number {
  if (!d.playing) return d.offset;
  return clampSeek(d.offset + secondsElapsed * d.playbackRate, d.bufferDuration);
}

/* ───────── LOOP REDUCERS ───────── */

export function setLoopIn(d: DeckState, now: number): DeckState {
  return {
    ...d,
    loop: { ...d.loop, start: now, active: false, loopInSet: true },
  };
}

export function setLoopOut(d: DeckState, now: number): DeckState {
  if (!d.loop.loopInSet || d.loop.start == null) return d;
  if (now <= d.loop.start) return d; // zero-length or inverted — refuse
  return {
    ...d,
    loop: { ...d.loop, end: now, active: true },
  };
}

export function toggleReloop(d: DeckState): DeckState {
  if (d.loop.start == null || d.loop.end == null) return d;
  return { ...d, loop: { ...d.loop, active: !d.loop.active } };
}

/**
 * Auto-loop of N beats from the current position at a given BPM.
 * Returns a new deck with the loop start/end set, or the same deck
 * unchanged if BPM is invalid.
 */
export function setAutoLoop(
  d: DeckState,
  now: number,
  beats: number,
  bpm: number,
  tempoPct = 0,
): DeckState {
  if (!bpm || bpm <= 0 || !beats || beats <= 0) return d;
  const bd = 60 / (bpm * (1 + tempoPct / 100));
  return {
    ...d,
    loop: { start: now, end: now + beats * bd, active: true, loopInSet: true },
  };
}

/* ───────── HOT CUE REDUCERS ───────── */

/**
 * Trigger a hot-cue pad (1..8). Returns { next, action } where action is one
 * of 'set' (no prior cue — just set it), 'seek' (jump to existing cue),
 * or 'clear' (remove an existing cue when user shift-clicks or taps at cue).
 */
export type HotCueAction = 'set' | 'seek' | 'clear';

export function triggerHotCue(
  d: DeckState,
  n: number,
  currentTime: number,
  opts: { shift?: boolean; tolerance?: number } = {},
): { next: DeckState; action: HotCueAction; seekTo?: number } {
  const tol = opts.tolerance ?? 0.12;
  const existing = d.hotCues[n];
  if (existing == null) {
    return {
      next: { ...d, hotCues: { ...d.hotCues, [n]: currentTime } },
      action: 'set',
    };
  }
  const atCue = Math.abs(currentTime - existing) < tol;
  const forceClear = !!opts.shift || (atCue && !d.playing);
  if (forceClear) {
    const cues = { ...d.hotCues };
    delete cues[n];
    return { next: { ...d, hotCues: cues }, action: 'clear' };
  }
  return { next: d, action: 'seek', seekTo: existing };
}
