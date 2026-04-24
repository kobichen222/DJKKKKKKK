# TITAN — the pivot from "compete with Serato" to "DJ for everyone"

## The insight

> למה להלחם על DJ מקצועי שאפשר לתת לאנשים ללמוד ולנסות חוויה בכל בית או משרד

Why fight in the pro-DJ market when you can let people *learn* and
*try the DJ experience* at home or in the office?

This is the single most important strategic call the project has
surfaced. Everything in this document follows from it.

## Why this wins

| Old strategy — "rekordbox killer" | New strategy — "DJ for everyone" |
| --- | --- |
| Serato + rekordbox dominate pros for 15+ years | **No clear leader**. Closest: looplabs.com, Beatwave — both anaemic. |
| Web Audio latency (30ms) is disqualifying for clubs | 30ms is **completely fine** when you're learning |
| ASIO + controller mandatory | Browser + headphones = enough |
| Target: ~500 k working DJs worldwide | Target: **anyone curious about music** — tens of millions |
| You compete with Elastique DSP quality | You compete with **YouTube tutorials** |
| Sale: $200–500 one-off, hard to justify without gigs | Sale: **$5–15 / month**, easy for a hobby |
| Hardware brand deals gate distribution | Distribution = SEO + social clips + word of mouth |
| Every technical limitation is a blocker | Most limitations are **not blockers** — they're irrelevant |

## Who did this in adjacent markets

- **Yousician** — learn guitar in a browser. Today a unicorn.
- **Duolingo** — learn a language on your phone. $15 B public
  company.
- **Simply Piano** (JoyTunes) — learn piano with interactive
  feedback. Acquired by ByteDance for ~$250 M.
- **BandLab** — social DAW in a browser. 100 M+ users.

There is no equivalent to these for DJ-ing. TITAN can be it, and
it already has 80 % of the infrastructure.

## What TITAN already has that maps to this

- Four decks + mixer + FX running in a browser, no install.
- Professional metering, mastering tab, MIDI support — useful
  for an "advanced mode" once learners are ready.
- Crates, smart crates, tags — the library model schools need.
- OAuth + user profiles via Supabase — ready for seat-based
  billing the moment a school wants 30 accounts.
- Service Worker — works offline, good for classrooms with
  spotty Wi-Fi.
- Electron / Tauri desktop build — a local install option for
  offices that don't allow browser apps.

## What was just built (this commit)

**TITAN ACADEMY — an interactive lesson system.**

- New `🎓 LEARN` tab in the main navigation (green = the beginner
  colour the rest of the UI now treats as the "friendly" track).
- Hero card with XP + progress bar, the same feedback loop that
  drives Duolingo's retention.
- A library of 10 starter lessons across 3 difficulty tiers:
  - **Beginner** — first play, volume + EQ, cross-fade.
  - **Intermediate** — beatmatching + SYNC, hot cues, loops, filters.
  - **Advanced** — key-matched mixing, mastering, recording your set.
- Each lesson = sequenced steps, each step a plain-English
  instruction with an automated **completion check** that polls
  the live app state 3× per second. When the learner actually
  does the thing, the step marks itself done.
- **UI highlight**: the next control to touch pulses green so
  beginners don't have to hunt.
- **Hints**: a soft "💡" tip surfaces after 6 seconds of
  inactivity.
- Progress + XP persist to `localStorage` under
  `titan_learn_progress_v1` so returning users pick up where
  they left off.
- Difficulty filter lets users drill into their current level.

## The business model this enables

| Tier | Price | For |
| --- | --- | --- |
| **Free** | $0 | 3 starter lessons, 2 decks, Jamendo-only music |
| **Pro** | $7 / mo | All lessons, 4 decks, full FX, Spotify/YouTube linking |
| **Classroom** | $3 / seat / mo, min 10 | Teacher dashboard, student progress export, shared library |
| **Pro DJ** | $15 / mo | Everything + the full mastering tab + MIDI + recording |

Education licensing is the breakaway — once a single school adopts
TITAN, you have 30 students × 10 months × repeat cohorts. That's
the math that built Yousician.

## What has to be true to ship this as the main product

- A **first-time experience**. Right now the app drops users into
  a full pro console. Boot should default to the LEARN tab for
  anyone without a completed lesson.
- **Curated demo tracks** with clear beats, visible phrase marks,
  and permissive licensing — tracks beginners can actually mix
  without feeling stupid.
- **Simplified "Beginner" mode**: hides the TITAN LAB, SOUND
  mastering, ADMIN, office tabs. Shows DECKS + LEARN + LIBRARY
  only. Toggle in Settings.
- **Achievement narrative** — not just XP numbers. "You're now
  a Bedroom DJ." "You're a Club DJ." "You're a Festival DJ."
- **Social proof** — lessons ending with "share your first mix"
  → uploads to a TITAN CDN, shareable link.
- **Teacher tools** (for the Classroom tier): a dashboard page
  showing which students are stuck where.

## What to do next

1. **This commit** — LEARN tab live. Pivot announced in this
   document.
2. **Next session** — Beginner mode toggle + boot-to-LEARN when
   no progress exists.
3. **Week 1–2** — Record 20 more lessons. Curate demo tracks.
   Ship an announcement post.
4. **Month 1** — Private beta with 20 parents / students /
   hobby DJs. Weekly lesson releases, feedback → lesson
   refinement.
5. **Month 2** — Pitch to one local school of music. Build
   whatever teacher-dashboard slice they need.
6. **Month 3** — Public launch on ProductHunt /
   r/BeginnerDJ / TikTok with short "you learned 3 DJ moves in
   10 minutes" clips.
7. **Month 6** — First paid classroom deal. That's the proof the
   tier works.

## The honest version

The *pro-DJ* roadmap in `ROADMAP.md` was realistic but expensive
(~$400 k/yr, 12 months, unclear path to revenue). This one is
cheaper, faster, has a clearer customer, and plays to what TITAN
already does well.

Serato won't even notice. Their customer isn't a 14-year-old
curious about DJ-ing, a 45-year-old office worker wanting a
Friday-afternoon stress relief, or a school teaching electronic
music production. Those are **your** customers, and nobody is
fighting you for them.

This is the move.
