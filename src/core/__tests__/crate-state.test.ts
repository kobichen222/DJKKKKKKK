import { describe, it, expect } from 'vitest';
import {
  createEmpty,
  addCrate,
  renameCrate,
  deleteCrate,
  addTrackToCrate,
  removeTrackFromCrate,
  tagTrack,
  untagTrack,
  tagsFor,
  evaluateSmartCrate,
  toJSON,
  fromJSON,
} from '../crate-state';
import type { Crate, TrackMeta, SmartCrate } from '../crate-state';

const mkCrate = (id: string, name = id, trackIds: string[] = []): Crate => ({
  id, name, trackIds, createdAt: Date.now(),
});
const mkTrack = (over: Partial<TrackMeta>): TrackMeta => ({
  id: 't1', title: 'Song', artist: 'Artist', bpm: 120, key: '8A',
  rating: 0, addedAt: Date.now(), ...over,
});

describe('crate reducers', () => {
  it('addCrate is idempotent on duplicate id', () => {
    const s = addCrate(createEmpty(), mkCrate('c1'));
    const s2 = addCrate(s, mkCrate('c1', 'different-name'));
    expect(s2).toBe(s);
  });
  it('renameCrate changes the display name', () => {
    const s = renameCrate(addCrate(createEmpty(), mkCrate('c1', 'Old')), 'c1', 'New');
    expect(s.crates['c1']?.name).toBe('New');
  });
  it('renameCrate is a no-op on missing id', () => {
    const s = addCrate(createEmpty(), mkCrate('c1'));
    expect(renameCrate(s, 'missing', 'x')).toBe(s);
  });
  it('deleteCrate removes the entry', () => {
    const s = deleteCrate(addCrate(createEmpty(), mkCrate('c1')), 'c1');
    expect(s.crates['c1']).toBeUndefined();
  });
  it('deleteCrate is a no-op on missing id', () => {
    const s = addCrate(createEmpty(), mkCrate('c1'));
    expect(deleteCrate(s, 'missing')).toBe(s);
  });
});

describe('track membership in a crate', () => {
  it('addTrackToCrate appends and ignores duplicates', () => {
    let s = addCrate(createEmpty(), mkCrate('c1'));
    s = addTrackToCrate(s, 'c1', 't1');
    s = addTrackToCrate(s, 'c1', 't1');
    expect(s.crates['c1']?.trackIds).toEqual(['t1']);
  });
  it('addTrackToCrate does nothing on a missing crate', () => {
    const s = addTrackToCrate(createEmpty(), 'missing', 't1');
    expect(s.crates['missing']).toBeUndefined();
  });
  it('removeTrackFromCrate takes it out', () => {
    let s = addCrate(createEmpty(), mkCrate('c1'));
    s = addTrackToCrate(s, 'c1', 't1');
    s = addTrackToCrate(s, 'c1', 't2');
    s = removeTrackFromCrate(s, 'c1', 't1');
    expect(s.crates['c1']?.trackIds).toEqual(['t2']);
  });
});

describe('tags', () => {
  it('tagTrack / untagTrack round-trips', () => {
    let s = tagTrack(createEmpty(), 't1', 'banger');
    expect(tagsFor(s, 't1')).toEqual(['banger']);
    s = tagTrack(s, 't1', 'warmup');
    expect(tagsFor(s, 't1')).toEqual(['banger', 'warmup']);
    s = untagTrack(s, 't1', 'banger');
    expect(tagsFor(s, 't1')).toEqual(['warmup']);
  });
  it('removing the last tag cleans up the entry', () => {
    let s = tagTrack(createEmpty(), 't1', 'single');
    s = untagTrack(s, 't1', 'single');
    expect(tagsFor(s, 't1')).toEqual([]);
    expect(s.tags['t1']).toBeUndefined();
  });
  it('duplicate tags are ignored', () => {
    const s = tagTrack(tagTrack(createEmpty(), 't1', 'x'), 't1', 'x');
    expect(tagsFor(s, 't1')).toEqual(['x']);
  });
});

describe('smart crate evaluation', () => {
  const lib: TrackMeta[] = [
    mkTrack({ id: 't1', bpm: 122, key: '8A', rating: 5 }),
    mkTrack({ id: 't2', bpm: 128, key: '8B', rating: 3 }),
    mkTrack({ id: 't3', bpm: 140, key: '5A', rating: 4, title: 'Drop Heavy' }),
    mkTrack({ id: 't4', bpm: 124, key: '8A', rating: 5, title: 'Midnight Mix' }),
  ];

  it('BPM range filter', () => {
    const sc: SmartCrate = {
      id: 'sc', name: 'House', rules: [{ kind: 'bpm-range', min: 120, max: 128 }],
    };
    const r = evaluateSmartCrate(createEmpty(), sc, lib);
    expect(r.map((t) => t.id)).toEqual(['t1', 't2', 't4']);
  });
  it('AND semantics across rules', () => {
    const sc: SmartCrate = {
      id: 'sc', name: 'High-rated house in 8A',
      rules: [
        { kind: 'bpm-range', min: 120, max: 130 },
        { kind: 'key-is', keys: ['8A'] },
        { kind: 'rating-gte', min: 5 },
      ],
    };
    const r = evaluateSmartCrate(createEmpty(), sc, lib);
    expect(r.map((t) => t.id)).toEqual(['t1', 't4']);
  });
  it('title-contains is case-insensitive', () => {
    const sc: SmartCrate = {
      id: 'sc', name: 'mix', rules: [{ kind: 'title-contains', query: 'MIDNIGHT' }],
    };
    const r = evaluateSmartCrate(createEmpty(), sc, lib);
    expect(r.map((t) => t.id)).toEqual(['t4']);
  });
  it('tag rule uses crate-state tags when present', () => {
    const s = tagTrack(createEmpty(), 't2', 'warmup');
    const sc: SmartCrate = { id: 'sc', name: 'Warmup', rules: [{ kind: 'tag', tag: 'warmup' }] };
    const r = evaluateSmartCrate(s, sc, lib);
    expect(r.map((t) => t.id)).toEqual(['t2']);
  });
  it('limit caps the result set', () => {
    const sc: SmartCrate = {
      id: 'sc', name: 'Top 2', rules: [{ kind: 'rating-gte', min: 3 }], limit: 2,
    };
    expect(evaluateSmartCrate(createEmpty(), sc, lib).length).toBe(2);
  });
  it('added-days filter matches recent only', () => {
    const now = Date.now();
    const old = mkTrack({ id: 'told', addedAt: now - 30 * 86_400_000 });
    const fresh = mkTrack({ id: 'tnew', addedAt: now - 1 * 86_400_000 });
    const sc: SmartCrate = {
      id: 'sc', name: 'Last week', rules: [{ kind: 'added-days', within: 7 }],
    };
    const r = evaluateSmartCrate(createEmpty(), sc, [old, fresh]);
    expect(r.map((t) => t.id)).toEqual(['tnew']);
  });
});

describe('persistence', () => {
  it('toJSON / fromJSON round-trip', () => {
    const s1 = tagTrack(
      addTrackToCrate(addCrate(createEmpty(), mkCrate('c1')), 'c1', 't1'),
      't1',
      'banger',
    );
    const s2 = fromJSON(toJSON(s1));
    expect(s2.crates['c1']?.trackIds).toEqual(['t1']);
    expect(tagsFor(s2, 't1')).toEqual(['banger']);
  });
  it('fromJSON tolerates missing / bad input', () => {
    expect(fromJSON(null).crates).toEqual({});
    expect(fromJSON('').tags).toEqual({});
    expect(fromJSON('not-valid-json').smartCrates).toEqual({});
  });
});
