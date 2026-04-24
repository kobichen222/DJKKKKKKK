import { describe, it, expect } from 'vitest';
import {
  createDeck,
  clampSeek,
  projectOffset,
  setLoopIn,
  setLoopOut,
  toggleReloop,
  setAutoLoop,
  triggerHotCue,
} from '../deck-state';

describe('createDeck', () => {
  it('returns sane defaults', () => {
    const d = createDeck();
    expect(d.playing).toBe(false);
    expect(d.offset).toBe(0);
    expect(d.cuePoint).toBe(0);
    expect(d.playbackRate).toBe(1);
    expect(d.loop.active).toBe(false);
    expect(d.hotCues).toEqual({});
  });
  it('accepts partial overrides', () => {
    const d = createDeck({ playbackRate: 1.08, bufferDuration: 210 });
    expect(d.playbackRate).toBe(1.08);
    expect(d.bufferDuration).toBe(210);
  });
});

describe('clampSeek', () => {
  it('clamps below zero to zero', () => {
    expect(clampSeek(-3, 100)).toBe(0);
  });
  it('clamps above duration to duration', () => {
    expect(clampSeek(150, 100)).toBe(100);
  });
  it('returns 0 for an unloaded deck', () => {
    expect(clampSeek(30, 0)).toBe(0);
  });
});

describe('projectOffset', () => {
  it('stays put when paused', () => {
    const d = createDeck({ offset: 10, bufferDuration: 100 });
    expect(projectOffset(d, 5)).toBe(10);
  });
  it('advances at playbackRate when playing', () => {
    const d = createDeck({ offset: 10, bufferDuration: 100, playing: true, playbackRate: 1.08 });
    expect(projectOffset(d, 2)).toBeCloseTo(10 + 2 * 1.08);
  });
  it('clamps to the buffer end', () => {
    const d = createDeck({ offset: 95, bufferDuration: 100, playing: true });
    expect(projectOffset(d, 30)).toBe(100);
  });
});

describe('loop reducers', () => {
  it('setLoopIn records the start and clears active', () => {
    const d = setLoopIn(createDeck({ loop: { start: 5, end: 10, active: true, loopInSet: true } }), 30);
    expect(d.loop.start).toBe(30);
    expect(d.loop.loopInSet).toBe(true);
    expect(d.loop.active).toBe(false);
  });
  it('setLoopOut refuses to activate when no LOOP IN was set', () => {
    const d = setLoopOut(createDeck(), 20);
    expect(d.loop.active).toBe(false);
  });
  it('setLoopOut refuses zero-length loops', () => {
    const base = createDeck({ loop: { start: 30, end: null, active: false, loopInSet: true } });
    const same = setLoopOut(base, 30);
    expect(same).toBe(base);
  });
  it('setLoopOut activates a valid loop', () => {
    const base = createDeck({ loop: { start: 30, end: null, active: false, loopInSet: true } });
    const out = setLoopOut(base, 34);
    expect(out.loop.active).toBe(true);
    expect(out.loop.end).toBe(34);
  });
  it('toggleReloop is a no-op without an existing loop', () => {
    const base = createDeck();
    expect(toggleReloop(base)).toBe(base);
  });
  it('toggleReloop flips active when a loop exists', () => {
    const base = createDeck({ loop: { start: 30, end: 34, active: false, loopInSet: true } });
    const on = toggleReloop(base);
    expect(on.loop.active).toBe(true);
    const off = toggleReloop(on);
    expect(off.loop.active).toBe(false);
  });
  it('setAutoLoop computes beat length from BPM', () => {
    // 120 BPM + no tempo = 0.5 s/beat; 4-beat loop = 2 s
    const d = setAutoLoop(createDeck(), 10, 4, 120);
    expect(d.loop.start).toBe(10);
    expect(d.loop.end).toBeCloseTo(12);
    expect(d.loop.active).toBe(true);
  });
  it('setAutoLoop respects tempo offset', () => {
    // 120 BPM * +8% = 129.6 BPM → beat = 60/129.6 ≈ 0.4630 s; 4 beats ≈ 1.852 s
    const d = setAutoLoop(createDeck(), 10, 4, 120, 8);
    expect(d.loop.end! - d.loop.start!).toBeCloseTo(4 * (60 / 129.6), 3);
  });
  it('setAutoLoop rejects invalid inputs', () => {
    const base = createDeck();
    expect(setAutoLoop(base, 10, 4, 0)).toBe(base);
    expect(setAutoLoop(base, 10, 0, 120)).toBe(base);
  });
});

describe('triggerHotCue', () => {
  it('sets a new cue on first press', () => {
    const d = createDeck();
    const r = triggerHotCue(d, 1, 12.5);
    expect(r.action).toBe('set');
    expect(r.next.hotCues[1]).toBe(12.5);
  });
  it('seeks to an existing cue when pressed again while away', () => {
    const d = createDeck({ hotCues: { 1: 10 } });
    const r = triggerHotCue(d, 1, 40);
    expect(r.action).toBe('seek');
    expect(r.seekTo).toBe(10);
    expect(r.next).toBe(d); // no state change
  });
  it('clears an existing cue when pressed at the cue position while paused', () => {
    const d = createDeck({ hotCues: { 3: 42 } });
    const r = triggerHotCue(d, 3, 42.05);
    expect(r.action).toBe('clear');
    expect(r.next.hotCues[3]).toBeUndefined();
  });
  it('respects shift to force clear even when playing', () => {
    const d = createDeck({ hotCues: { 2: 20 }, playing: true });
    const r = triggerHotCue(d, 2, 30, { shift: true });
    expect(r.action).toBe('clear');
    expect(r.next.hotCues[2]).toBeUndefined();
  });
  it('does NOT clear when playing through the cue (no shift)', () => {
    const d = createDeck({ hotCues: { 2: 20 }, playing: true });
    const r = triggerHotCue(d, 2, 20.05);
    expect(r.action).toBe('seek');
    expect(r.next.hotCues[2]).toBe(20);
  });
});
