# TITAN — Deploy + Supabase wiring guide

Everything that isn't code. Read top to bottom the first time; later
you can jump to the section you need.

## 1. Supabase — the auth / license backend

### 1a. Create the project

1. [supabase.com](https://supabase.com) → **New Project**.
2. Choose a region close to your users (EU-west for Israel, US-east for
   North America). Pick a strong DB password; store it in 1Password
   and never paste it in chat or code.
3. When the project is ready, grab from **Settings → API**:
   - `Project URL` — looks like `https://eliimbfzegwcepbljdwp.supabase.co`
   - `anon / public` key — a long JWT starting with `eyJhbGc...`

### 1b. Run the schema

1. **SQL Editor → New Query**.
2. Paste the full contents of `public/auth.sql` → **Run**.
3. This creates `public.profiles`, the auto-signup trigger, and the RLS
   policies that keep each user scoped to their own row.

### 1c. Google as an OAuth provider

In the Supabase dashboard:

1. **Authentication → Providers → Google → Enable**.
2. You'll need an **OAuth Client** from Google Cloud:
   - [console.cloud.google.com](https://console.cloud.google.com)
     → APIs & Services → Credentials
     → Create credentials → OAuth client ID → **Web application**.
   - **Authorized JavaScript origins**: your Supabase project URL
     (the `https://xxxxx.supabase.co` one).
   - **Authorized redirect URIs**: the callback Supabase shows you,
     in the shape `https://xxxxx.supabase.co/auth/v1/callback`.
   - Save. Google hands back a **Client ID** ending in
     `.apps.googleusercontent.com` and a **Client Secret** starting
     with `GOCSPX-`.
3. Paste both into Supabase → Google provider → **Save**.

### 1d. Deploy the verify-license edge function

```bash
# Install the Supabase CLI once
npm i -g supabase

# Log in + link to your project (uses the ref from Settings → General)
supabase login
supabase link --project-ref eliimbfzegwcepbljdwp   # yours will differ

# Secrets — never commit these. Generate fresh values.
supabase secrets set TITAN_LICENSE_PUBKEY_HEX="$(cat path/to/ed25519.pub.hex)"
supabase secrets set TITAN_JWT_SECRET="$(openssl rand -hex 32)"

# Deploy
supabase functions deploy verify-license
```

Sanity check the function is up:

```bash
curl -X POST https://eliimbfzegwcepbljdwp.supabase.co/functions/v1/verify-license \
     -H 'content-type: application/json' \
     -d '{"license":null}'
# Expect { "ok": false, "error": "malformed" }
```

### 1e. Wire TITAN to it

In the app → **SETTINGS → SUPABASE**:
- **Supabase URL** — the Project URL.
- **Anon Key** — the `anon` key, *not* the `service_role` key.
- **SAVE & CONNECT** — a green "Supabase connected" toast means the
  SDK loaded and the auth session is live.

### 1f. Promote yourself to admin (one-off)

After signing in at least once so your row exists in `profiles`:

```sql
-- Run in Supabase SQL Editor
update public.profiles
set role = 'admin'
where email = 'you@example.com';
```

Reloading the app now shows the **ADMIN** tab and the
`✓ ADMIN · DOWNLOADS OPEN` chip on the installer panel.

---

## 2. Web app — host the static bundle

The entire app is `public/index.html` + the assets around it. You can
host it literally anywhere:

| Host | One-line command / setting |
| --- | --- |
| **Vercel** | `vercel --prod` from the repo root (already has `vercel.json`) |
| **Netlify** | drag-drop the `public/` folder onto the dashboard |
| **GitHub Pages** | enable Pages on the `main` branch, root = `/public` |
| **Cloudflare Pages** | connect the repo, publish directory = `public` |
| **Your own nginx** | `alias /srv/titan/public/` on the server block |

Two requirements for full functionality:

1. **HTTPS** — Web MIDI, Web Audio's AudioWorklet, and clipboard access
   all require a secure context. Vercel/Netlify/Cloudflare give you
   this for free.
2. **Correct MIME** on `titan-keylock-worklet.js` — should serve as
   `application/javascript`. Every host in the table above does this
   out of the box; for nginx make sure the `.js` mapping is in place.

---

## 3. Desktop installers — Electron → GitHub Release

```bash
# from the repo root, on a clean branch
npm ci
npm run electron:build        # all three targets
# or just the one you need:
npm run electron:win          # .exe
npm run electron:mac          # .dmg / .zip
npm run electron:linux        # .AppImage
```

Artefacts land in `dist-electron/`. To hand them to end-users:

1. Tag the commit you want to ship: `git tag v1.0.13 && git push --tags`.
2. GitHub Actions + `electron-builder`'s `publish` step will upload
   the binaries to a **Release** with matching tag.
3. The in-app download panel auto-resolves to the latest release
   (`public/index.html` → `setupDesktopDownloads`), so the download
   buttons update without a new app release.

Signing is left to you — for macOS notarisation and Windows code
signing, add an Apple Developer cert + a Windows EV certificate to
your CI secrets and enable the matching `electron-builder` fields.

---

## 4. Domain + DNS (optional but recommended)

1. Buy a short domain (Namecheap / Google Domains / Route 53).
2. Point it at your web host:
   - Vercel: add the domain under **Project → Settings → Domains**
     → follow the CNAME / A-record instructions.
   - Cloudflare Pages: same pattern, plus you get the Cloudflare CDN.
3. Add the domain to Supabase → **Authentication → URL Configuration**
   → **Site URL** + **Redirect URLs** so OAuth callbacks succeed.

---

## 5. Running the test suite

```bash
npm ci                 # fresh install
npm run typecheck      # src/core strict type check
npm test               # 200+ vitest cases
npm run ci             # typecheck + tests (what CI runs)

# Browser E2E (one-time Chromium download)
npm run e2e:install
npm run e2e
```

CI is already set up in `.github/workflows/ci.yml` and runs on every
push + PR on Node 20 and 22.

---

## 6. Backing up user data

Three pieces of state live outside your Git history:

| State | Location | Backup |
| --- | --- | --- |
| User profiles + sessions | Supabase Postgres | daily auto-backups (pro plan) + on-demand `pg_dump` |
| Crates + tags | Browser `localStorage` under `titan_crates_v1` | user-triggered export JSON |
| Track audio | Browser IndexedDB | no backup; users re-upload from source |

For team installs it's worth migrating crates + tags into Supabase so
they survive browser wipes. That's a day of work once the rest of the
stack is settled.

---

## 7. Cost envelope — what it runs at

| Service | Free tier | Paid starts at |
| --- | --- | --- |
| Supabase | 500 MB DB, 50 k MAU | $25/mo for 8 GB + 100 k MAU |
| Vercel Pro | — | $20/mo + usage |
| GitHub Actions | 2000 min/mo on private repo | $0.008 / min after |
| Apple Developer (signing) | — | $99/yr |
| Windows EV cert | — | $300–600/yr |
| Domain | — | $12/yr |

Total to launch: **under $100/mo** until you have paying users; pay
more when you do.

---

## 8. If something breaks — first places to look

- **"Supabase connected" toast never appears** → wrong URL or anon
  key. Check Settings → API in the Supabase dashboard.
- **Google sign-in redirects and then errors** → redirect URI in
  Google Cloud Console doesn't match. Should be
  `https://xxxxx.supabase.co/auth/v1/callback` exactly.
- **Edge function returns `server-misconfigured`** → one of the two
  secrets is missing. Re-run `supabase secrets set …`.
- **Keylock has no effect** → the AudioWorklet failed to load.
  Browser console will show a `failed to load module` error.
  Usually a MIME-type issue on the static host.
- **Installer panel stays locked after signing in** → the user row
  was created but `banned` is true, or the `profiles` trigger didn't
  run. Check the row directly in the SQL editor.
