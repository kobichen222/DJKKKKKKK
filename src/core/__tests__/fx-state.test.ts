import { describe, it, expect } from 'vitest';
import {
  createFx,
  setBeatOn,
  setBeatType,
  setBeatDivision,
  setBeatChannel,
  setBeatLevel,
  setColorAmount,
  setColorType,
  setScenePad,
  setSceneType,
  beatDelayTime,
  beatWetGain,
  colorAmountFor,
  toJSON,
  fromJSON,
} from '../fx-state';

describe('createFx', () => {
  it('starts with effects off / centered', () => {
    const s = createFx();
    expect(s.beat.on).toBe(false);
    expect(s.beat.type).toBe('delay');
    expect(s.beat.beat).toBe(1);
    expect(s.color.type).toBe('filter');
    expect(s.scene.type).toBeNull();
  });
});

describe('beat FX reducers', () => {
  it('setBeatOn toggles the on flag', () => {
    const s = setBeatOn(createFx(), true);
    expect(s.beat.on).toBe(true);
  });
  it('setBeatType / setBeatDivision / setBeatChannel update fields', () => {
    let s = setBeatType(createFx(), 'flanger');
    s = setBeatDivision(s, 4);
    s = setBeatChannel(s, 'A');
    expect(s.beat).toMatchObject({ type: 'flanger', beat: 4, channel: 'A' });
  });
  it('setBeatLevel clamps to 0..1', () => {
    expect(setBeatLevel(createFx(), -0.5).beat.level).toBe(0);
    expect(setBeatLevel(createFx(), 2).beat.level).toBe(1);
    expect(setBeatLevel(createFx(), 0.65).beat.level).toBeCloseTo(0.65);
  });
  it('setBeatLevel rejects NaN', () => {
    expect(setBeatLevel(createFx(), Number.NaN).beat.level).toBe(0);
  });
});

describe('color FX reducers', () => {
  it('setColorAmount clamps to -1..+1 per channel', () => {
    let s = setColorAmount(createFx(), 'A', 0.4);
    s = setColorAmount(s, 'B', -2);
    s = setColorAmount(s, 'C', 3);
    expect(s.color.A).toBeCloseTo(0.4);
    expect(s.color.B).toBe(-1);
    expect(s.color.C).toBe(1);
  });
  it('setColorType resets every channel to 0 (no click between effects)', () => {
    let s = setColorAmount(createFx(), 'A', 0.7);
    s = setColorAmount(s, 'B', -0.5);
    s = setColorType(s, 'sweep');
    expect(s.color).toMatchObject({ type: 'sweep', A: 0, B: 0, C: 0, D: 0 });
  });
});

describe('scene FX reducers', () => {
  it('setScenePad clamps both axes to 0..1', () => {
    const s = setScenePad(createFx(), 1.5, -0.2, true);
    expect(s.scene.xpadX).toBe(1);
    expect(s.scene.xpadY).toBe(0);
    expect(s.scene.xpadActive).toBe(true);
  });
  it('setSceneType(null) also clears depth so the wet bus ends up silent', () => {
    let s = setSceneType(createFx(), 'sweep');
    s = setSceneType(s, null);
    expect(s.scene.type).toBeNull();
    expect(s.scene.depth).toBe(0);
  });
});

describe('resolved values', () => {
  it('beatDelayTime maps BPM × division', () => {
    // 128 BPM, 1/4 beat → 60/128 * 0.25 = 0.117s
    expect(beatDelayTime(128, 0.25)).toBeCloseTo(60 / 128 * 0.25, 4);
    // 120 BPM, 1 beat = 0.5s
    expect(beatDelayTime(120, 1)).toBeCloseTo(0.5, 4);
  });
  it('beatDelayTime falls back on zero BPM', () => {
    expect(beatDelayTime(0, 1)).toBeCloseTo(60 / 128);
  });
  it('beatDelayTime clamps absurd values to Web-Audio sane range', () => {
    expect(beatDelayTime(10_000, 16)).toBeLessThanOrEqual(4);
    expect(beatDelayTime(10, 0.0625)).toBeGreaterThanOrEqual(0.005);
  });
  it('beatWetGain is always 0 when off, even with level set', () => {
    const s = setBeatLevel(createFx(), 0.9).beat;
    expect(beatWetGain(s)).toBe(0);
  });
  it('beatWetGain returns the level when on', () => {
    const s = { ...createFx().beat, on: true, level: 0.42 };
    expect(beatWetGain(s)).toBeCloseTo(0.42);
  });
  it('colorAmountFor passes through clamped values', () => {
    const s = setColorAmount(setColorAmount(createFx(), 'A', 0.3), 'B', -0.8).color;
    expect(colorAmountFor(s, 'A')).toBeCloseTo(0.3);
    expect(colorAmountFor(s, 'B')).toBeCloseTo(-0.8);
    expect(colorAmountFor(s, 'C')).toBe(0);
  });
});

describe('persistence', () => {
  it('round-trips through JSON', () => {
    const s1 = setColorAmount(setBeatOn(setBeatType(createFx(), 'flanger'), true), 'A', 0.5);
    const s2 = fromJSON(toJSON(s1));
    expect(s2.beat.on).toBe(true);
    expect(s2.beat.type).toBe('flanger');
    expect(s2.color.A).toBeCloseTo(0.5);
  });
  it('tolerates corrupt / empty input', () => {
    expect(fromJSON(null).beat.on).toBe(false);
    expect(fromJSON('').color.type).toBe('filter');
    expect(fromJSON('{{invalid').scene.type).toBeNull();
  });
});
