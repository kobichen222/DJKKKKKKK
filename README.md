# DJ TITAN

Professional DJ studio — four decks, full mixer, turntables, effects, AI-assisted mixing and offline-first operation. Available as a Windows desktop app and as a web version (GitHub Pages / Vercel).

---

## Features

- **4× TITAN-3K decks** with sync, cue, loop, hotcues and performance pads
- **TITAN CORE mixer** — 4-channel with EQ, filter, sends, channel FX
- **TITAN VINYL turntables** — jog-wheel scrub, pitch-bend, key-lock
- **TITAN LAB production** — sampler, recorder, track analysis
- **AI mixing** — automatic BPM/key detection via off-thread Web Worker, Camelot harmonic guidance, shortcut help overlay
- **MIDI controller support** with mapping persistence
- **Cloud library sync** — push/pull sessions via Supabase
- **Offline-first** — service worker caches the shell and loaded tracks
- **Themes** — ONYX, PULSE, BLADE, Euphonia, Gold, Pioneer, Light and more
- **Auto-updates** on desktop via GitHub Releases

## Download

Latest Windows installer: [**github.com/kobichen222/TITAN/releases/latest**](https://github.com/kobichen222/TITAN/releases/latest)

Web version: whichever host is currently serving `public/pioneer-dj-pro-max-v2.html` (GitHub Pages / Vercel).

## Development

```bash
npm install
npm run electron        # run the desktop app against the local public/ HTML
npm run dev             # run the Next.js office-admin panel (app/office)
npm run electron:win    # build the Windows installer to dist-electron/
```

`electron-builder` output lives in `dist-electron/` (gitignored).

## Tech

- **Renderer** — single-file vanilla HTML/JS/CSS (`public/pioneer-dj-pro-max-v2.html`)
- **Desktop wrapper** — Electron 32, `contextIsolation` + sandboxed renderer, preload-only IPC
- **Admin panel** — Next.js 15 + React 19 (`app/office`)
- **Auth / storage** — Supabase (client-configured; see `public/auth.sql`)
- **Analysis** — Web Worker BPM/key pipeline (`public/analyzer.worker.js`)
- **Distribution** — GitHub Actions → signed-by-publisher NSIS installer + `electron-updater` differential updates

## Repository layout

```
electron/            Electron main + preload
public/              All renderer assets (HTML, SW, worker, icons, SQL)
app/office/          Next.js admin panel
tools/gen-license.js CLI to sign license JWTs
.github/workflows/   Windows build + GitHub Pages deploy
```

## License

Proprietary — all rights reserved. See `docs/PRO-LICENSING.md` for commercial licensing terms.
