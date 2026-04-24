import { describe, it, expect } from 'vitest';
import {
  ampToDb,
  dbToAmp,
  isHarmonic,
  computeSyncPercent,
  syncWithinRange,
  cueActionFor,
  fmtTime,
} from '../dj-math';

describe('ampToDb / dbToAmp', () => {
  it('round-trips common values', () => {
    for (const db of [-40, -20, -6, -3, 0, 3, 6]) {
      expect(ampToDb(dbToAmp(db))).toBeCloseTo(db, 6);
    }
  });
  it('maps 0 amplitude to -Infinity', () => {
    expect(ampToDb(0)).toBe(-Infinity);
    expect(ampToDb(-0.01)).toBe(-Infinity);
  });
  it('dbToAmp of -Infinity returns 0', () => {
    expect(dbToAmp(-Infinity)).toBe(0);
  });
});

describe('isHarmonic (Camelot wheel)', () => {
  it('matches equal keys', () => {
    expect(isHarmonic('8A', '8A')).toBe(true);
  });
  it('matches relative major/minor (same number, swapped letter)', () => {
    expect(isHarmonic('8A', '8B')).toBe(true);
    expect(isHarmonic('11B', '11A')).toBe(true);
  });
  it('matches ±1 step around the wheel', () => {
    expect(isHarmonic('8A', '9A')).toBe(true);
    expect(isHarmonic('8A', '7A')).toBe(true);
    expect(isHarmonic('1A', '12A')).toBe(true); // wrap
    expect(isHarmonic('12A', '1A')).toBe(true); // wrap
  });
  it('rejects 2+ steps apart', () => {
    expect(isHarmonic('8A', '10A')).toBe(false);
    expect(isHarmonic('1A', '3A')).toBe(false);
  });
  it('rejects letter-swap + wheel step (not a safe move)', () => {
    expect(isHarmonic('8A', '9B')).toBe(false);
    expect(isHarmonic('1A', '12B')).toBe(false);
  });
  it('handles missing / sentinel keys gracefully', () => {
    expect(isHarmonic('--', '8A')).toBe(false);
    expect(isHarmonic('', '8A')).toBe(false);
    expect(isHarmonic('8A', 'foo')).toBe(false);
  });
  it('rejects out-of-range numbers', () => {
    expect(isHarmonic('13A', '12A')).toBe(false);
    expect(isHarmonic('0A', '1A')).toBe(false);
  });
});

describe('computeSyncPercent / syncWithinRange', () => {
  it('returns 0 for identical BPMs and no source tempo', () => {
    expect(computeSyncPercent(128, 128, 0)).toBeCloseTo(0);
  });
  it('returns a positive percent when target is faster', () => {
    const pct = computeSyncPercent(120, 128, 0);
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeCloseTo(((128 / 120) - 1) * 100, 6);
  });
  it('accounts for the source deck already having a tempo offset', () => {
    // Source at 128 BPM playing +4% → effective 133.12 BPM
    const pct = computeSyncPercent(120, 128, 4);
    expect(pct).toBeCloseTo(((133.12 / 120) - 1) * 100, 4);
  });
  it('returns null for invalid inputs', () => {
    expect(computeSyncPercent(0, 128, 0)).toBeNull();
    expect(computeSyncPercent(120, 0, 0)).toBeNull();
    expect(computeSyncPercent(-128, 120, 0)).toBeNull();
  });
  it('syncWithinRange enforces the deck tempo range', () => {
    expect(syncWithinRange(7.5, 8)).toBe(true);
    expect(syncWithinRange(-8, 8)).toBe(true);
    expect(syncWithinRange(9, 8)).toBe(false);
    expect(syncWithinRange(null, 8)).toBe(false);
    // default range of 8 when 0 / falsy is passed
    expect(syncWithinRange(7, 0 as unknown as number)).toBe(true);
  });
});

describe('cueActionFor', () => {
  it('seeks and pauses while the deck is playing', () => {
    expect(cueActionFor({ playing: true, currentTime: 10, cuePoint: 5 })).toBe('seek-and-pause');
  });
  it('sets a new cue when paused far from the cue point', () => {
    expect(cueActionFor({ playing: false, currentTime: 10, cuePoint: 5 })).toBe('set-cue');
  });
  it('seeks exactly to the cue when paused within tolerance', () => {
    expect(cueActionFor({ playing: false, currentTime: 5.02, cuePoint: 5 })).toBe('seek-to-cue');
  });
  it('respects a custom tolerance', () => {
    expect(cueActionFor({ playing: false, currentTime: 5.2, cuePoint: 5, tolerance: 0.3 }))
      .toBe('seek-to-cue');
    expect(cueActionFor({ playing: false, currentTime: 5.2, cuePoint: 5, tolerance: 0.1 }))
      .toBe('set-cue');
  });
});

describe('fmtTime', () => {
  it('formats zero as 00:00.0', () => {
    expect(fmtTime(0)).toBe('00:00.0');
  });
  it('formats minutes and seconds', () => {
    expect(fmtTime(65.4)).toBe('01:05.4');
    expect(fmtTime(3599.9)).toBe('59:59.9');
  });
  it('pads single-digit seconds', () => {
    expect(fmtTime(61)).toBe('01:01.0');
  });
  it('prefixes "-" for negative values (used by the remain display)', () => {
    expect(fmtTime(-15.5)).toBe('-00:15.5');
  });
  it('returns a placeholder on Infinity / NaN', () => {
    expect(fmtTime(Infinity)).toBe('--:--');
    expect(fmtTime(NaN)).toBe('--:--');
  });
});
