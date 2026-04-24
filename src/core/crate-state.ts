/**
 * Crate / tag state — the library organisation layer.
 *
 * Serato's biggest "workflow" advantage is crates + smart crates + tags.
 * Adding them to TITAN doesn't require native code, just a tiny reducer
 * over pure in-memory structures. Persisted by the renderer to
 * IndexedDB (callers pass `toJSON()` output to storage and `fromJSON`
 * on boot).
 */

export interface Crate {
  id: string;              // ULID-ish — caller supplies
  name: string;
  trackIds: string[];      // preserves user-ordered sort
  createdAt: number;
  color?: string;          // optional UI hint
}

export interface SmartCrate {
  id: string;
  name: string;
  rules: SmartRule[];      // ALL rules must match (AND)
  limit?: number;          // cap the result set, e.g. "top 50"
}

export type SmartRule =
  | { kind: 'bpm-range'; min: number; max: number }
  | { kind: 'key-is'; keys: string[] }
  | { kind: 'rating-gte'; min: number }
  | { kind: 'added-days'; within: number }
  | { kind: 'title-contains'; query: string }
  | { kind: 'tag'; tag: string };

export interface TrackMeta {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  rating: number;
  addedAt: number;
  tags?: string[];
}

export interface CrateState {
  crates: Record<string, Crate>;
  smartCrates: Record<string, SmartCrate>;
  tags: Record<string, string[]>; // trackId → tags
}

export function createEmpty(): CrateState {
  return { crates: {}, smartCrates: {}, tags: {} };
}

/* ───────── CRATE REDUCERS ───────── */

export function addCrate(s: CrateState, crate: Crate): CrateState {
  if (s.crates[crate.id]) return s; // idempotent on duplicate ID
  return { ...s, crates: { ...s.crates, [crate.id]: crate } };
}

export function renameCrate(s: CrateState, id: string, name: string): CrateState {
  const c = s.crates[id];
  if (!c) return s;
  return { ...s, crates: { ...s.crates, [id]: { ...c, name } } };
}

export function deleteCrate(s: CrateState, id: string): CrateState {
  if (!s.crates[id]) return s;
  const { [id]: _removed, ...rest } = s.crates;
  return { ...s, crates: rest };
}

export function addTrackToCrate(s: CrateState, crateId: string, trackId: string): CrateState {
  const c = s.crates[crateId];
  if (!c) return s;
  if (c.trackIds.includes(trackId)) return s; // no duplicates
  return { ...s, crates: { ...s.crates, [crateId]: { ...c, trackIds: [...c.trackIds, trackId] } } };
}

export function removeTrackFromCrate(
  s: CrateState,
  crateId: string,
  trackId: string,
): CrateState {
  const c = s.crates[crateId];
  if (!c || !c.trackIds.includes(trackId)) return s;
  return {
    ...s,
    crates: { ...s.crates, [crateId]: { ...c, trackIds: c.trackIds.filter((t) => t !== trackId) } },
  };
}

/* ───────── TAG REDUCERS ───────── */

export function tagTrack(s: CrateState, trackId: string, tag: string): CrateState {
  const existing = s.tags[trackId] ?? [];
  if (existing.includes(tag)) return s;
  return { ...s, tags: { ...s.tags, [trackId]: [...existing, tag] } };
}

export function untagTrack(s: CrateState, trackId: string, tag: string): CrateState {
  const existing = s.tags[trackId];
  if (!existing || !existing.includes(tag)) return s;
  const next = existing.filter((t) => t !== tag);
  if (!next.length) {
    const { [trackId]: _x, ...rest } = s.tags;
    return { ...s, tags: rest };
  }
  return { ...s, tags: { ...s.tags, [trackId]: next } };
}

export function tagsFor(s: CrateState, trackId: string): string[] {
  return s.tags[trackId] ?? [];
}

/* ───────── SMART CRATE EVALUATION ───────── */

/**
 * Apply a smart crate's rule set to a library and return the matching
 * tracks in their natural order. All rules must match (AND semantics);
 * optional `limit` caps the result set after filtering.
 */
export function evaluateSmartCrate(
  state: CrateState,
  smart: SmartCrate,
  library: TrackMeta[],
): TrackMeta[] {
  const now = Date.now();
  const matches = library.filter((t) =>
    smart.rules.every((rule) => ruleMatches(rule, t, state, now)),
  );
  return smart.limit ? matches.slice(0, smart.limit) : matches;
}

function ruleMatches(r: SmartRule, t: TrackMeta, s: CrateState, now: number): boolean {
  switch (r.kind) {
    case 'bpm-range':
      return t.bpm >= r.min && t.bpm <= r.max;
    case 'key-is':
      return r.keys.includes(t.key);
    case 'rating-gte':
      return (t.rating ?? 0) >= r.min;
    case 'added-days':
      return now - t.addedAt <= r.within * 24 * 60 * 60 * 1000;
    case 'title-contains':
      return t.title.toLowerCase().includes(r.query.toLowerCase());
    case 'tag': {
      const tags = s.tags[t.id] ?? t.tags ?? [];
      return tags.includes(r.tag);
    }
  }
}

/* ───────── PERSIST ───────── */

export function toJSON(s: CrateState): string {
  return JSON.stringify(s);
}

export function fromJSON(str: string | null | undefined): CrateState {
  if (!str) return createEmpty();
  try {
    const parsed = JSON.parse(str);
    if (!parsed || typeof parsed !== 'object') return createEmpty();
    return {
      crates: parsed.crates ?? {},
      smartCrates: parsed.smartCrates ?? {},
      tags: parsed.tags ?? {},
    };
  } catch {
    return createEmpty();
  }
}
