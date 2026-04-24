# TITAN — Technical roadmap

An honest document about where the project stands and what a serious run
at industry leadership would actually cost. Written for a founder, not
for marketing.

## Where we are (state as of this commit)

**Code base**

- `public/index.html` — single-file vanilla HTML/CSS/JS (~18 k lines,
  ~900 KB). The whole product.
- `src/core/` — TypeScript modules extracted from the monolith with
  strict `noUncheckedIndexedAccess` type checking.
- `src/e2e/` — Playwright smoke tests that boot the real HTML.
- `supabase/functions/` — Deno edge functions for server-side checks.
- `electron/` — desktop wrapper.

**Automated quality gates** (all pass in CI on Node 20 + 22)

| Suite | Count |
| --- | --- |
| Pure logic (`src/core/__tests__/*.test.ts`) | 155 |
| HTML smoke (`src/__tests__/smoke.test.ts`) | 11 |
| Browser E2E (`src/e2e/boot.spec.ts`) | 5 |
| **Total** | **171** |

**Modules already extracted**

- `dj-math` — dB / amp / Camelot / sync-percent / CUE decision / time
- `beat-math` — beat + bar duration, phase, downbeat snap
- `deck-state` — loop reducers + hot-cue action classifier
- `mixer-math` — crossfader curves, channel gain, BPM / rate conversions
- `audio-math` — peak / RMS / LUFS / phase correlation / goniometer
- `player-state` — PLAY / PAUSE / SEEK / CUE transitions as action lists
- `crate-state` — crates, smart crates, tags (Serato-style organisation)

**Security posture**

- No hard-coded admin codes in the renderer (the `KOBI2100` backdoor
  is gone and guarded against by a regression test).
- Google OAuth via Supabase, RLS policies on the profiles table.
- Server-side license verification via edge function with a 24-hour
  HMAC entitlement token the client caches.

---

## What is realistic vs. what is not

### ✅ Realistic in a session or two

- More module extractions (mixer, library, waveform drawing, effects).
- More unit + smoke coverage (aim for 300 tests).
- Library features: crates UI, smart crates UI, tagging UI.
- Minor UX: keyboard shortcuts manager, theme export, session
  backup/restore.
- Server-side DRM improvements: rate-limit premium API calls by
  entitlement token.

### ⚠️ Realistic in a few weeks with focus

- Full TypeScript migration of the monolith (~200 h of mechanical
  refactor + test writing).
- Playwright coverage of every primary workflow, not just the smoke
  paths. Wire E2E into CI with browser caching.
- Basic phase-vocoder AudioWorklet for keylock. Not as good as
  Elastique, but noticeably better than the current `playbackRate`
  pitch-shift. Quality is acceptable to ±10 % tempo.
- Better beatgrid analysis: onset detection + downbeat hypothesis
  scoring. Tap-to-grid editor. Use the existing `phaseOffsetSeconds`
  math that's already tested.
- Web HID / WebMIDI 2.0 support for more controllers, including LED
  / jog-feedback messages out.

### ❌ Not realistic for a single developer + AI assistant

The things below are what *actually* separates Serato from a prosumer
app. They require different skill sets, large up-front work, and
often legal / commercial deals.

- **Audio thread at native latency.** Web Audio is 20–50 ms
  round-trip on the best hardware; native ASIO / CoreAudio is
  2–5 ms. The only way to close that gap is a native shell (Tauri
  + Rust + CPAL) that does mixing and FX outside the renderer. This
  is a structural change, not a feature — it means rewriting the
  audio graph from scratch.

- **Time-stretching at commercial quality.** The Elastique algorithm
  behind rekordbox / Serato is proprietary (zplane.de). Rubber Band
  is GPL/LGPL and usable, but integration + tuning + edge cases is
  months of work by someone who has shipped DSP before.

- **Key detection that's actually right.** Mixed In Key and rekordbox
  use DNNs trained on thousands of hand-labelled tracks. The
  closest open alternative is Essentia.js — a 10 MB WASM bundle
  with its own integration cost and no UX for training/fine-tuning.

- **True MIDI HID feedback.** Lighting pad RGB, platter haptic feedback,
  display images — every controller has a proprietary protocol that
  Serato/rekordbox have reverse-engineered over years.

- **Brand + distribution.** Even if the software caught up tomorrow,
  Pioneer / Numark sell their hardware bundled with rekordbox /
  Serato. That's a commercial moat you close with a controller OEM
  deal, not with code.

---

## A realistic 12-month plan

### Months 1–2 — Foundation (1 engineer, full-time)

Goal: hand a clean codebase to the team that arrives in month 3.

- Finish extracting every pure module out of the monolith. Target:
  `public/index.html` becomes an HTML + CSS shell only. All logic
  lives in `src/core/**` (TypeScript) and `src/ui/**` (for DOM
  wiring).
- Move CSS to a proper build (PostCSS or Vite). Split per component.
- Coverage: 500+ unit tests. Playwright runs every core workflow
  (load track, play, sync, loop, cue, FX, save session).
- Move the Electron shell to Tauri. Binary sizes drop 10×; opens
  the door to native-audio work later.
- Hook up the existing Supabase integration for: session sync,
  analytics, license enforcement. Wire it to the app's actual
  state so cross-device resume works.

### Months 3–6 — Audio team (1–2 DSP engineers)

Goal: audio quality you can demo against rekordbox without being
embarrassed.

- Rust DSP crate compiled to WASM or exposed over a native Tauri
  bridge. Start with the master bus (gain + limiter + true-peak
  detection).
- Port the SOUND-tab multi-band compressor, de-esser, and tape
  saturation to the Rust crate. Measure on the same input against
  iZotope Ozone. Target: ≤ 0.5 LU difference.
- Phase vocoder or Rubber Band integration for keylock. Benchmark
  on ±16 % shift; target: no audible artefacts for the ±8 % range
  DJs actually use in a set.
- Onset + downbeat detection to populate `deck.beatgrid.origin`
  automatically on import. Let the user drag to correct; persist
  the correction.
- Hook up the Web MIDI output path for Pioneer DDJ-FLX6, DDJ-1000,
  and one Numark controller. LED feedback on active cues.

### Months 7–9 — Product fit (full team + designer)

Goal: a first cohort of DJs using TITAN for paid gigs.

- Private beta with 50 DJs. Weekly releases. Crash reports and
  session analytics flow back to the team.
- Library parity with Serato: crates, smart crates, tags, smart
  search, iTunes / Traktor / rekordbox library import.
- Streaming integrations: Beatport LINK, TIDAL, Soundcloud Go+.
  Each one is a 1-month effort in legal + caching + DRM.
- Cloud sync for sessions, cue points, beatgrids. This is where
  the Supabase groundwork pays off.

### Months 10–12 — Launch

- Public beta. App Store + Microsoft Store submissions (Tauri
  makes both realistic; Electron essentially made them pointless).
- OEM talks with a second-tier controller brand for a bundle.
- Paid tier: $8–15/month, with free tier capped at 2 decks +
  no streaming.

### Budget envelope

- 1 founder + 2 engineers + 1 designer + part-time DSP consultant.
- ~$400 k annual burn at modest salaries; double that for US-rate
  engineers or DSP specialists.
- Cloud + Supabase + license signing + CI: <$500 / month.

---

## What would change the calculus

- **Acquisition by a hardware OEM.** Numark, Hercules, or Reloop
  want a rekordbox alternative for their own controllers. That
  shortens the commercial runway from years to months.
- **An open DSP library reaching parity.** Rubber Band v4 or a
  Rust crate hitting Elastique quality would remove the biggest
  single technical gap.
- **Browser-native audio workload running in a proper low-latency
  worker.** W3C is discussing this. It's not here yet.

---

## The honest TL;DR

TITAN today is a strong **prosumer** DJ app with pro-level metering,
server-side auth, a reasonable test suite, and an architecture that
can be extended. Serato and rekordbox exist in a different league —
one protected by decades of DSP work, commercial deals, and brand
trust that code alone can't close.

The path above is real, but it's a year with serious capital.
Anyone who tells you "overtake Serato in three months" is not being
honest. The tests in this repo will still pass on that day, though —
and that counts for more than people think.
