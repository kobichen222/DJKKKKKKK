import { describe, it, expect } from 'vitest';
import {
  beatDuration,
  barDuration,
  beatPhase,
  snapToBeat,
  phaseOffsetSeconds,
  isBeatLocked,
} from '../beat-math';

describe('beatDuration / barDuration', () => {
  it('120 BPM → 0.5 s per beat, 2 s per bar', () => {
    expect(beatDuration(120)).toBeCloseTo(0.5);
    expect(barDuration(120)).toBeCloseTo(2.0);
  });
  it('128 BPM → ~0.4688 s per beat', () => {
    expect(beatDuration(128)).toBeCloseTo(60 / 128, 6);
  });
  it('0 / negative BPM → 0', () => {
    expect(beatDuration(0)).toBe(0);
    expect(beatDuration(-120)).toBe(0);
    expect(barDuration(0)).toBe(0);
  });
  it('supports non-standard meters', () => {
    expect(barDuration(120, 3)).toBeCloseTo(1.5); // 3/4
    expect(barDuration(120, 7)).toBeCloseTo(3.5); // 7/4
  });
});

describe('beatPhase', () => {
  it('is 0 exactly on the anchor', () => {
    expect(beatPhase(10, 10, 120)).toBeCloseTo(0);
  });
  it('is 0.5 halfway through a bar', () => {
    // 120 BPM, bar = 2 s; halfway = 1 s past anchor
    expect(beatPhase(11, 10, 120)).toBeCloseTo(0.5);
  });
  it('wraps cleanly on multiple bars', () => {
    expect(beatPhase(14, 10, 120)).toBeCloseTo(0);          // 4 s past = 2 bars
    expect(beatPhase(14.5, 10, 120)).toBeCloseTo(0.25);     // quarter-bar past
  });
  it('handles seeking backwards relative to anchor', () => {
    expect(beatPhase(9.5, 10, 120)).toBeCloseTo(0.75);      // half-beat before downbeat
  });
  it('returns 0 for invalid BPM', () => {
    expect(beatPhase(10, 0, 0)).toBe(0);
  });
});

describe('snapToBeat', () => {
  it('rounds to the nearest beat', () => {
    // 120 BPM → 0.5 s per beat. target 10.24 s (anchor 10) → round to beat 0 → 10 s
    expect(snapToBeat(10.24, 10, 120)).toBeCloseTo(10.0);
    expect(snapToBeat(10.26, 10, 120)).toBeCloseTo(10.5);
  });
  it('snapForward always takes the next beat', () => {
    expect(snapToBeat(10.01, 10, 120, true)).toBeCloseTo(10.5);
    expect(snapToBeat(10.5, 10, 120, true)).toBeCloseTo(10.5);
    expect(snapToBeat(10.51, 10, 120, true)).toBeCloseTo(11.0);
  });
  it('passes through unchanged on zero BPM', () => {
    expect(snapToBeat(12.3, 0, 0)).toBe(12.3);
  });
});

describe('phaseOffsetSeconds', () => {
  it('returns 0 when both decks are on the downbeat together', () => {
    const off = phaseOffsetSeconds(
      { currentTime: 10, gridAnchor: 10, bpm: 128 },
      { currentTime: 20, gridAnchor: 20, bpm: 128 },
    );
    expect(off).toBeCloseTo(0);
  });
  it('detects self 1/4 bar ahead', () => {
    // 120 BPM, bar=2s, 0.25 ahead ≡ 0.5 s ahead
    const off = phaseOffsetSeconds(
      { currentTime: 10.5, gridAnchor: 10, bpm: 120 },
      { currentTime: 20, gridAnchor: 20, bpm: 120 },
    );
    expect(off).toBeCloseTo(0.5);
  });
  it('wraps to the nearest (not the longer) adjustment', () => {
    // 120 BPM, bar=2s. Self is 3/4 bar "ahead" → really 1/4 BEHIND → -0.5 s.
    const off = phaseOffsetSeconds(
      { currentTime: 11.5, gridAnchor: 10, bpm: 120 },
      { currentTime: 20, gridAnchor: 20, bpm: 120 },
    );
    expect(off).toBeCloseTo(-0.5);
  });
});

describe('isBeatLocked', () => {
  it('returns true inside the default 10ms tolerance', () => {
    expect(isBeatLocked(0)).toBe(true);
    expect(isBeatLocked(0.009)).toBe(true);
    expect(isBeatLocked(-0.009)).toBe(true);
  });
  it('returns false outside tolerance', () => {
    expect(isBeatLocked(0.012)).toBe(false);
    expect(isBeatLocked(-0.015)).toBe(false);
  });
  it('accepts a custom tolerance', () => {
    expect(isBeatLocked(0.03, 50)).toBe(true);
    expect(isBeatLocked(0.06, 50)).toBe(false);
  });
});
