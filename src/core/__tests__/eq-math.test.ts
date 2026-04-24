import { describe, it, expect } from 'vitest';
import {
  createEq,
  knobToDb,
  bandDb,
  allBandsDb,
  toggleKill,
  approxBandResponseDb,
  totalResponseDb,
  KILL_DB,
} from '../eq-math';

describe('knobToDb', () => {
  it('center → 0 dB', () => {
    expect(knobToDb(0)).toBe(0);
  });
  it('full boost → +12 dB', () => {
    expect(knobToDb(1)).toBe(12);
    expect(knobToDb(0.5)).toBeCloseTo(6);
  });
  it('full cut is deeper than boost', () => {
    expect(knobToDb(-1)).toBe(-26);
    expect(knobToDb(-0.5)).toBeCloseTo(-13);
  });
  it('clamps out-of-range inputs', () => {
    expect(knobToDb(2)).toBe(12);
    expect(knobToDb(-2)).toBe(-26);
  });
  it('NaN → 0', () => {
    expect(knobToDb(Number.NaN)).toBe(0);
  });
});

describe('bandDb / allBandsDb', () => {
  it('reflects knob values when kills are off', () => {
    const s = { ...createEq(), low: 0.5, loMid: -0.25, hiMid: 0.1, high: -1 };
    const g = allBandsDb(s);
    expect(g.low).toBeCloseTo(6);
    expect(g.loMid).toBeCloseTo(-6.5);
    expect(g.hiMid).toBeCloseTo(1.2);
    expect(g.high).toBeCloseTo(-26);
  });
  it('kill LOW drops only the low band to -80 dB', () => {
    const s = { ...createEq(), low: 0.8, high: 0.8, killLow: true };
    const g = allBandsDb(s);
    expect(g.low).toBe(KILL_DB);
    expect(g.high).toBeCloseTo(9.6);
  });
  it('kill MID takes out BOTH mid bands simultaneously', () => {
    const s = { ...createEq(), loMid: 0.5, hiMid: 0.5, killMid: true };
    const g = allBandsDb(s);
    expect(g.loMid).toBe(KILL_DB);
    expect(g.hiMid).toBe(KILL_DB);
    expect(g.low).toBe(0); // untouched
  });
  it('kill HI only drops the high shelf', () => {
    const s = { ...createEq(), high: 0.5, killHi: true };
    expect(bandDb(s, 'high')).toBe(KILL_DB);
    expect(bandDb(s, 'low')).toBe(0);
  });
});

describe('toggleKill', () => {
  it('flips the corresponding flag and leaves knob values alone', () => {
    const base = { ...createEq(), low: 0.7 };
    const s = toggleKill(base, 'low');
    expect(s.killLow).toBe(true);
    expect(s.low).toBe(0.7);
    const s2 = toggleKill(s, 'low');
    expect(s2.killLow).toBe(false);
  });
  it('handles mid / hi independently', () => {
    const s1 = toggleKill(createEq(), 'mid');
    expect(s1.killMid).toBe(true);
    expect(s1.killLow).toBe(false);
    expect(s1.killHi).toBe(false);
    const s2 = toggleKill(s1, 'hi');
    expect(s2.killHi).toBe(true);
    expect(s2.killMid).toBe(true);
  });
});

describe('approxBandResponseDb', () => {
  it('returns 0 when gain is 0', () => {
    expect(approxBandResponseDb('peak', 1000, 500, 0)).toBe(0);
  });
  it('low shelf applies full gain well below the shelf', () => {
    const v = approxBandResponseDb('lowshelf', 200, 50, 6);
    expect(v).toBeGreaterThan(5);
  });
  it('low shelf dies off well above the shelf', () => {
    const v = approxBandResponseDb('lowshelf', 200, 5000, 6);
    expect(Math.abs(v)).toBeLessThan(1);
  });
  it('high shelf mirrors low shelf', () => {
    const v = approxBandResponseDb('highshelf', 8000, 20_000, 6);
    expect(v).toBeGreaterThan(5);
  });
  it('peak peaks at the centre frequency', () => {
    const peak = approxBandResponseDb('peak', 1000, 1000, 6);
    const off = approxBandResponseDb('peak', 1000, 4000, 6);
    expect(peak).toBeCloseTo(6, 3);
    expect(off).toBeLessThan(peak / 2);
  });
  it('peak respects Q', () => {
    const wide = approxBandResponseDb('peak', 1000, 2000, 6, 0.3);
    const tight = approxBandResponseDb('peak', 1000, 2000, 6, 5);
    expect(wide).toBeGreaterThan(tight);
  });
});

describe('totalResponseDb — sanity', () => {
  it('returns 0 everywhere at the flat position', () => {
    const flat = createEq();
    for (const f of [50, 200, 1000, 5000, 15000]) {
      expect(totalResponseDb(flat, f)).toBeCloseTo(0, 3);
    }
  });
  it('kill-low creates a deep trough below 200 Hz', () => {
    const s = toggleKill(createEq(), 'low');
    const atLow = totalResponseDb(s, 60);
    expect(atLow).toBeLessThan(-40);
  });
  it('boosting HIGH shows up in the 10 kHz region', () => {
    const s = { ...createEq(), high: 1 };
    const v = totalResponseDb(s, 12000);
    expect(v).toBeGreaterThan(6);
  });
});
