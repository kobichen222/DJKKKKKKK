import { describe, it, expect } from 'vitest';
import {
  create,
  currentPosition,
  play,
  pause,
  togglePlay,
  seek,
  cueTap,
  setRate,
} from '../player-state';

describe('create / currentPosition', () => {
  it('returns sensible defaults', () => {
    const s = create();
    expect(s.playing).toBe(false);
    expect(s.playbackRate).toBe(1);
    expect(s.offset).toBe(0);
  });
  it('currentPosition is offset when paused', () => {
    const s = create({ offset: 12 });
    expect(currentPosition(s, 9999)).toBe(12);
  });
  it('currentPosition advances at playbackRate when playing', () => {
    const s = create({ playing: true, offset: 10, startTime: 100, playbackRate: 1.08, bufferDuration: 300 });
    expect(currentPosition(s, 102)).toBeCloseTo(10 + 2 * 1.08);
  });
});

describe('play', () => {
  it('refuses to play without a loaded buffer', () => {
    const r = play(create(), 5);
    expect(r.next.playing).toBe(false);
    expect(r.actions[0]).toEqual({ type: 'toast', msg: 'No track loaded', tone: 'error' });
  });
  it('starts when a buffer is loaded', () => {
    const s = create({ bufferDuration: 200, offset: 5 });
    const r = play(s, 10);
    expect(r.next.playing).toBe(true);
    expect(r.next.startTime).toBe(10);
    expect(r.actions.some((a) => a.type === 'start-source')).toBe(true);
    expect(r.actions.some((a) => a.type === 'update-ui')).toBe(true);
  });
  it('is a no-op if already playing (idempotent)', () => {
    const s = create({ playing: true, bufferDuration: 200, offset: 5, startTime: 10 });
    const r = play(s, 20);
    expect(r.next).toBe(s);
    expect(r.actions).toEqual([]);
  });
});

describe('pause', () => {
  it('captures the current position into offset', () => {
    const s = create({ playing: true, offset: 10, startTime: 100, playbackRate: 1.08, bufferDuration: 200 });
    const r = pause(s, 102);
    expect(r.next.playing).toBe(false);
    expect(r.next.offset).toBeCloseTo(10 + 2 * 1.08);
  });
  it('emits stop-source + set-offset + update-ui in that order', () => {
    const s = create({ playing: true, offset: 10, startTime: 100, bufferDuration: 200 });
    const r = pause(s, 102);
    expect(r.actions.map((a) => a.type)).toEqual(['stop-source', 'set-offset', 'update-ui']);
  });
  it('is a no-op if already paused', () => {
    const s = create({ playing: false });
    const r = pause(s, 100);
    expect(r.next).toBe(s);
    expect(r.actions).toEqual([]);
  });
});

describe('togglePlay', () => {
  it('plays when paused', () => {
    const r = togglePlay(create({ bufferDuration: 100 }), 5);
    expect(r.next.playing).toBe(true);
  });
  it('pauses when playing', () => {
    const r = togglePlay(create({ playing: true, bufferDuration: 100, startTime: 0 }), 5);
    expect(r.next.playing).toBe(false);
  });
});

describe('seek', () => {
  it('clamps below 0 and above the buffer', () => {
    const s = create({ bufferDuration: 100 });
    expect(seek(s, -10, 0).next.offset).toBe(0);
    expect(seek(s, 200, 0).next.offset).toBe(100);
  });
  it('while paused only updates offset', () => {
    const s = create({ bufferDuration: 100, offset: 20 });
    const r = seek(s, 50, 0);
    expect(r.next.offset).toBe(50);
    expect(r.next.playing).toBe(false);
    expect(r.actions).toEqual([{ type: 'set-offset', offset: 50 }]);
  });
  it('while playing re-schedules from the new offset without flipping playing', () => {
    const s = create({ playing: true, bufferDuration: 200, offset: 10, startTime: 100, playbackRate: 1.04 });
    const r = seek(s, 40, 150);
    expect(r.next.playing).toBe(true);
    expect(r.next.offset).toBe(40);
    expect(r.next.startTime).toBe(150);
    expect(r.actions.map((a) => a.type)).toEqual(['stop-source', 'start-source']);
  });
});

describe('cueTap', () => {
  it('paused & off-cue → sets a new cue at the current position', () => {
    const s = create({ bufferDuration: 100, offset: 42, cuePoint: 0 });
    const r = cueTap(s, 0);
    expect(r.next.cuePoint).toBe(42);
    expect(r.actions.some((a) => a.type === 'toast')).toBe(true);
  });
  it('paused & within tolerance → seeks precisely to the cue', () => {
    const s = create({ bufferDuration: 100, offset: 20.01, cuePoint: 20 });
    const r = cueTap(s, 0);
    expect(r.next.offset).toBe(20);
    expect(r.actions).toEqual([{ type: 'set-offset', offset: 20 }]);
  });
  it('playing → stop + seek to cue + pause, then announce', () => {
    const s = create({ playing: true, bufferDuration: 100, offset: 10, startTime: 100, cuePoint: 5 });
    const r = cueTap(s, 102);
    expect(r.next.playing).toBe(false);
    expect(r.next.offset).toBe(5);
    expect(r.actions.some((a) => a.type === 'stop-source')).toBe(true);
    expect(r.actions.some((a) => a.type === 'start-source')).toBe(true);
    expect(r.actions.some((a) => a.type === 'set-offset' && a.offset === 5)).toBe(true);
    expect(r.actions.some((a) => a.type === 'toast')).toBe(true);
  });
  it('custom tolerance changes set-vs-seek classification', () => {
    const s = create({ bufferDuration: 100, offset: 20.2, cuePoint: 20 });
    // Strict tolerance → set a new cue
    expect(cueTap(s, 0, 0.1).next.cuePoint).toBe(20.2);
    // Loose tolerance → seek to existing cue
    expect(cueTap(s, 0, 0.5).next.cuePoint).toBe(20);
  });
});

describe('setRate', () => {
  it('updates state and emits a set-rate action', () => {
    const r = setRate(create({ playbackRate: 1 }), 1.08);
    expect(r.next.playbackRate).toBe(1.08);
    expect(r.actions).toEqual([{ type: 'set-rate', rate: 1.08 }]);
  });
  it('is a no-op when the rate is unchanged', () => {
    const s = create({ playbackRate: 1.08 });
    const r = setRate(s, 1.08);
    expect(r.next).toBe(s);
    expect(r.actions).toEqual([]);
  });
  it('clamps extreme values', () => {
    expect(setRate(create(), 5).next.playbackRate).toBe(1.5);
    expect(setRate(create(), 0.1).next.playbackRate).toBe(0.5);
  });
});
