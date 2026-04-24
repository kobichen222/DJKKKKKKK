import { describe, it, expect } from 'vitest';
import {
  peakDb,
  rms,
  peak,
  rmsToLufs,
  phaseCorrelation,
  dbToNorm,
  addToIntegrated,
  integratedLufs,
  makeupLinear,
  gainToDb,
  gonioPoint,
} from '../audio-math';

describe('peakDb / gainToDb', () => {
  it('full scale is 0 dB', () => {
    expect(peakDb(1)).toBeCloseTo(0);
    expect(gainToDb(1)).toBeCloseTo(0);
  });
  it('half amplitude is ~-6 dB', () => {
    expect(peakDb(0.5)).toBeCloseTo(-6.0206);
  });
  it('zero is -Infinity', () => {
    expect(peakDb(0)).toBe(-Infinity);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(peakDb(-1)).toBe(-Infinity);
  });
});

describe('rms / peak', () => {
  // Frequency 0.25 lands exactly on +1 / 0 / -1 / 0 at integer samples,
  // so peak() can assert peak === 1 without tolerance slop.
  const sine = (n: number, freq = 0.25) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * freq * i);
    return a;
  };

  it('full-scale sine: peak = 1, rms = √2/2', () => {
    const s = sine(2048);
    expect(peak(s)).toBeCloseTo(1, 4);
    expect(rms(s)).toBeCloseTo(Math.SQRT1_2, 2);
  });
  it('silence yields zero', () => {
    const zeros = new Float32Array(1024);
    expect(rms(zeros)).toBe(0);
    expect(peak(zeros)).toBe(0);
  });
  it('empty input is safe', () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(peak(new Float32Array(0))).toBe(0);
  });
  it('half-amplitude sine rms is half the full-scale rms', () => {
    const full = sine(2048);
    const half = new Float32Array(full.length);
    for (let i = 0; i < full.length; i++) half[i] = full[i]! * 0.5;
    expect(rms(half)).toBeCloseTo(rms(full) * 0.5, 2);
  });
});

describe('rmsToLufs', () => {
  it('applies the standard -0.691 offset', () => {
    // rms 1.0 → 0 dB - 0.691 = -0.691 LUFS
    expect(rmsToLufs(1)).toBeCloseTo(-0.691, 3);
  });
  it('half-scale rms is ~-6.7 LUFS', () => {
    expect(rmsToLufs(0.5)).toBeCloseTo(-6.0206 - 0.691, 2);
  });
  it('zero is -Infinity', () => {
    expect(rmsToLufs(0)).toBe(-Infinity);
  });
});

describe('phaseCorrelation', () => {
  const mk = (f: (i: number) => number, n = 512) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = f(i);
    return a;
  };
  it('identical L/R = +1 (mono)', () => {
    const l = mk((i) => Math.sin(i / 8));
    const r = mk((i) => Math.sin(i / 8));
    expect(phaseCorrelation(l, r)).toBeCloseTo(1, 4);
  });
  it('inverted L/R = -1 (cancels on mono sum)', () => {
    const l = mk((i) => Math.sin(i / 8));
    const r = mk((i) => -Math.sin(i / 8));
    expect(phaseCorrelation(l, r)).toBeCloseTo(-1, 4);
  });
  it('orthogonal signals ≈ 0', () => {
    // Sine vs cosine integrate to near zero over many cycles
    const l = mk((i) => Math.sin(i / 4));
    const r = mk((i) => Math.cos(i / 4));
    expect(Math.abs(phaseCorrelation(l, r))).toBeLessThan(0.1);
  });
  it('silent channels return 0 (not NaN)', () => {
    const s = new Float32Array(256);
    expect(phaseCorrelation(s, s)).toBe(0);
  });
  it('handles mismatched lengths by using the shorter one', () => {
    const l = mk((i) => Math.sin(i / 8), 1024);
    const r = mk((i) => Math.sin(i / 8), 256);
    expect(phaseCorrelation(l, r)).toBeCloseTo(1, 4);
  });
});

describe('dbToNorm', () => {
  it('maps -60..0 dB to 0..1 by default', () => {
    expect(dbToNorm(-60)).toBe(0);
    expect(dbToNorm(0)).toBe(1);
    expect(dbToNorm(-30)).toBeCloseTo(0.5);
  });
  it('clamps out-of-range values', () => {
    expect(dbToNorm(-90)).toBe(0);
    expect(dbToNorm(6)).toBe(1);
  });
  it('accepts a custom range', () => {
    expect(dbToNorm(-18, -36, 0)).toBeCloseTo(0.5);
  });
  it('-Infinity → 0', () => {
    expect(dbToNorm(-Infinity)).toBe(0);
  });
  it('invalid range → 0', () => {
    expect(dbToNorm(-12, 0, -60)).toBe(0); // high<low
  });
});

describe('integrated LUFS accumulator (EBU-R128 absolute gate)', () => {
  it('empty state reads -Infinity', () => {
    const st = { sumPow10: 0, count: 0 };
    expect(integratedLufs(st)).toBe(-Infinity);
  });
  it('a single loud sample equals its own value', () => {
    const st = { sumPow10: 0, count: 0 };
    addToIntegrated(st, -10);
    expect(integratedLufs(st)).toBeCloseTo(-10);
  });
  it('gates anything quieter than -70 LUFS', () => {
    const st = { sumPow10: 0, count: 0 };
    addToIntegrated(st, -10);
    addToIntegrated(st, -80); // below gate
    addToIntegrated(st, -Infinity);
    expect(st.count).toBe(1);
    expect(integratedLufs(st)).toBeCloseTo(-10);
  });
  it('averages in the power domain, not dB', () => {
    const st = { sumPow10: 0, count: 0 };
    // -10 and -20 LUFS — power average sits closer to -10 than a naive mean
    addToIntegrated(st, -10);
    addToIntegrated(st, -20);
    const v = integratedLufs(st);
    expect(v).toBeGreaterThan(-15); // closer to -10 than to dB-average -15
    expect(v).toBeLessThan(-12);
  });
});

describe('makeupLinear', () => {
  it('0 dB is unity', () => {
    expect(makeupLinear(0)).toBe(1);
  });
  it('+6 dB doubles amplitude', () => {
    expect(makeupLinear(6)).toBeCloseTo(2, 2);
  });
  it('-6 dB halves amplitude', () => {
    expect(makeupLinear(-6)).toBeCloseTo(0.5, 2);
  });
});

describe('gonioPoint (L/R → M/S display)', () => {
  it('mono signal (L=R) is on the vertical axis', () => {
    const p = gonioPoint(0.5, 0.5);
    expect(p.x).toBeCloseTo(0, 4);
    expect(p.y).toBeGreaterThan(0);
  });
  it('anti-mono (L=-R) is on the horizontal axis', () => {
    const p = gonioPoint(0.5, -0.5);
    expect(p.y).toBeCloseTo(0, 4);
    expect(Math.abs(p.x)).toBeGreaterThan(0);
  });
  it('silence is the origin', () => {
    const p = gonioPoint(0, 0);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
  });
});
