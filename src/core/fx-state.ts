/**
 * Effects state — Beat FX + Color FX + Scene FX, as pure data.
 *
 * The Web-Audio nodes live in the renderer; this module decides *what*
 * each knob should resolve to. Pulling it out lets us:
 *   - unit-test the BPM / beat-division → delay-time formula without
 *     an AudioContext,
 *   - enforce "off by default when empty" at the type level so a
 *     forgotten nullish-check can't leave an effect hissing after the
 *     user clicks OFF,
 *   - round-trip settings to JSON for session save / restore.
 */

export type BeatFxType =
  | 'delay'
  | 'echo'
  | 'reverb'
  | 'filter'
  | 'flanger'
  | 'phaser'
  | 'bitcrush';

export type BeatDivision = 0.0625 | 0.125 | 0.25 | 0.5 | 1 | 2 | 4 | 8 | 16;

export interface BeatFxState {
  type: BeatFxType;
  channel: 'master' | 'A' | 'B' | 'C' | 'D';
  beat: BeatDivision;
  level: number;       // 0..1
  on: boolean;
}

export interface ColorFxState {
  type: 'filter' | 'dub-echo' | 'noise' | 'sweep' | 'pitch';
  A: number; // -1..+1 per channel
  B: number;
  C: number;
  D: number;
}

export interface SceneFxState {
  type: null | 'dubspiral' | 'sweep' | 'tremor' | 'riser';
  depth: number;       // 0..1
  xpadX: number;       // 0..1
  xpadY: number;       // 0..1
  xpadActive: boolean;
}

export interface FxState {
  beat: BeatFxState;
  color: ColorFxState;
  scene: SceneFxState;
}

export function createFx(): FxState {
  return {
    beat: { type: 'delay', channel: 'master', beat: 1, level: 0.5, on: false },
    color: { type: 'filter', A: 0, B: 0, C: 0, D: 0 },
    scene: { type: null, depth: 0.5, xpadX: 0.5, xpadY: 0.5, xpadActive: false },
  };
}

/* ───────── REDUCERS ───────── */

export function setBeatOn(s: FxState, on: boolean): FxState {
  return { ...s, beat: { ...s.beat, on } };
}

export function setBeatType(s: FxState, type: BeatFxType): FxState {
  return { ...s, beat: { ...s.beat, type } };
}

export function setBeatDivision(s: FxState, beat: BeatDivision): FxState {
  return { ...s, beat: { ...s.beat, beat } };
}

export function setBeatChannel(s: FxState, channel: BeatFxState['channel']): FxState {
  return { ...s, beat: { ...s.beat, channel } };
}

export function setBeatLevel(s: FxState, level: number): FxState {
  return { ...s, beat: { ...s.beat, level: clamp01(level) } };
}

export function setColorAmount(
  s: FxState,
  channel: 'A' | 'B' | 'C' | 'D',
  value: number,
): FxState {
  return { ...s, color: { ...s.color, [channel]: clampPM1(value) } };
}

export function setColorType(s: FxState, type: ColorFxState['type']): FxState {
  // Switching type resets all channels to 0 — avoids a click when the
  // previous effect's internal state gets swapped out.
  return { ...s, color: { ...s.color, type, A: 0, B: 0, C: 0, D: 0 } };
}

export function setScenePad(
  s: FxState,
  x: number,
  y: number,
  active: boolean,
): FxState {
  return {
    ...s,
    scene: { ...s.scene, xpadX: clamp01(x), xpadY: clamp01(y), xpadActive: active },
  };
}

export function setSceneType(s: FxState, type: SceneFxState['type']): FxState {
  return { ...s, scene: { ...s.scene, type, depth: type == null ? 0 : s.scene.depth } };
}

/* ───────── RESOLVED VALUES (for the audio renderer) ───────── */

/**
 * Delay time in seconds for a given master BPM and the user's chosen
 * beat division. Clamped to Web-Audio's sane range so a zero BPM can't
 * produce Infinity.
 */
export function beatDelayTime(masterBpm: number, division: BeatDivision): number {
  const bpm = masterBpm > 0 ? masterBpm : 128;
  const secPerBeat = 60 / bpm;
  const t = secPerBeat * division;
  return Math.max(0.005, Math.min(4, t));
}

/**
 * Active gain to send to the wet bus. When off, returns 0 so the DOM
 * layer can't mistakenly leave the wet signal bleeding. Level scales
 * linearly; a future revision could apply an equal-power curve.
 */
export function beatWetGain(s: BeatFxState): number {
  return s.on ? clamp01(s.level) : 0;
}

/** Color FX amount resolved to a channel — just a clamp today. */
export function colorAmountFor(s: ColorFxState, ch: 'A' | 'B' | 'C' | 'D'): number {
  return clampPM1(s[ch]);
}

/* ───────── PERSIST ───────── */

export function toJSON(s: FxState): string {
  return JSON.stringify(s);
}
export function fromJSON(str: string | null | undefined): FxState {
  if (!str) return createFx();
  try {
    const p = JSON.parse(str);
    const base = createFx();
    return {
      beat: { ...base.beat, ...(p.beat ?? {}) },
      color: { ...base.color, ...(p.color ?? {}) },
      scene: { ...base.scene, ...(p.scene ?? {}) },
    };
  } catch {
    return createFx();
  }
}

/* ───────── helpers ───────── */

function clamp01(v: number): number {
  if (!isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampPM1(v: number): number {
  if (!isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
