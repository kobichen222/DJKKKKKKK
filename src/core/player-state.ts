/**
 * Player state machine — pure transitions for PLAY / PAUSE / STOP / SEEK.
 *
 * The real renderer still owns the AudioBufferSourceNode lifecycle (you
 * cannot construct or disconnect one without an AudioContext), but the
 * *decisions* about what each action should do — which ramps to schedule,
 * whether an operation is a no-op, how offset/startTime move together —
 * live here as pure functions that return an "action list".
 *
 * The renderer turns that action list into Web-Audio calls. This means
 * the tricky interactions (pause-then-seek-then-play, play-while-looping,
 * double-play suppression) can be exercised under vitest in milliseconds
 * without a real audio context, and regressions in them can't sneak into
 * production unnoticed.
 */

export interface TransportState {
  playing: boolean;
  offset: number;             // seconds into the track at startTime
  startTime: number;          // audio-ctx currentTime at which we started
  playbackRate: number;       // 1.0 = normal
  bufferDuration: number;
  cuePoint: number;
}

/** An atomic side-effect the renderer must apply after a transition. */
export type PlayerAction =
  | { type: 'start-source'; at: number; offset: number; rate: number }
  | { type: 'stop-source'; fadeOutMs?: number }
  | { type: 'set-offset'; offset: number }
  | { type: 'set-rate'; rate: number }
  | { type: 'update-ui'; state: 'playing' | 'paused' }
  | { type: 'toast'; msg: string; tone?: 'success' | 'error' };

export interface TransitionResult {
  next: TransportState;
  actions: PlayerAction[];
}

/** Effective track position right now, accounting for playback rate. */
export function currentPosition(s: TransportState, now: number): number {
  if (!s.playing) return s.offset;
  return s.offset + (now - s.startTime) * s.playbackRate;
}

export function create(initial: Partial<TransportState> = {}): TransportState {
  return {
    playing: false,
    offset: 0,
    startTime: 0,
    playbackRate: 1,
    bufferDuration: 0,
    cuePoint: 0,
    ...initial,
  };
}

/** Begin playback. No-op if already playing or no buffer. */
export function play(s: TransportState, now: number): TransitionResult {
  if (s.playing) return { next: s, actions: [] };
  if (!s.bufferDuration) {
    return { next: s, actions: [{ type: 'toast', msg: 'No track loaded', tone: 'error' }] };
  }
  const next: TransportState = { ...s, playing: true, startTime: now };
  return {
    next,
    actions: [
      { type: 'start-source', at: now, offset: s.offset, rate: s.playbackRate },
      { type: 'update-ui', state: 'playing' },
    ],
  };
}

/** Pause playback. No-op if not playing. */
export function pause(s: TransportState, now: number, fadeOutMs = 6): TransitionResult {
  if (!s.playing) return { next: s, actions: [] };
  const offset = currentPosition(s, now);
  const next: TransportState = { ...s, playing: false, offset };
  return {
    next,
    actions: [
      { type: 'stop-source', fadeOutMs },
      { type: 'set-offset', offset },
      { type: 'update-ui', state: 'paused' },
    ],
  };
}

/** Toggle play/pause. */
export function togglePlay(s: TransportState, now: number): TransitionResult {
  return s.playing ? pause(s, now) : play(s, now);
}

/**
 * Seek to an absolute time. If playing, briefly stop + start with the
 * new offset. Values outside [0, bufferDuration] are clamped.
 */
export function seek(s: TransportState, target: number, now: number): TransitionResult {
  const clamped = Math.max(0, Math.min(target, s.bufferDuration));
  if (!s.playing) {
    return { next: { ...s, offset: clamped }, actions: [{ type: 'set-offset', offset: clamped }] };
  }
  // Re-schedule playback from the new offset without flipping the `playing` bit.
  const next: TransportState = { ...s, offset: clamped, startTime: now };
  return {
    next,
    actions: [
      { type: 'stop-source' },
      { type: 'start-source', at: now, offset: clamped, rate: s.playbackRate },
    ],
  };
}

/**
 * CUE behaviour — the exact decision tree used by the transport:
 *   - Playing      → seek to cue and pause
 *   - Not playing  → set cue here if we're off it, or seek exactly to it if we're on it
 */
export function cueTap(
  s: TransportState,
  now: number,
  tolerance = 0.05,
): TransitionResult {
  if (s.playing) {
    const seekRes = seek(s, s.cuePoint, now);
    const pauseRes = pause(seekRes.next, now);
    return {
      next: pauseRes.next,
      actions: [...seekRes.actions, ...pauseRes.actions,
        { type: 'toast', msg: `Cue: ${s.cuePoint.toFixed(2)}s` }],
    };
  }
  const here = s.offset;
  if (Math.abs(here - s.cuePoint) > tolerance) {
    // Set a fresh cue at the current position
    return {
      next: { ...s, cuePoint: here },
      actions: [{ type: 'toast', msg: `Cue set: ${here.toFixed(2)}s` }],
    };
  }
  // Already on the cue — just seek precisely to it (usually a no-op)
  return seek(s, s.cuePoint, now);
}

/** Set the playback rate. Ramp is applied by the renderer; we only update state. */
export function setRate(s: TransportState, rate: number): TransitionResult {
  const clamped = Math.max(0.5, Math.min(1.5, rate));
  if (clamped === s.playbackRate) return { next: s, actions: [] };
  return {
    next: { ...s, playbackRate: clamped },
    actions: [{ type: 'set-rate', rate: clamped }],
  };
}
