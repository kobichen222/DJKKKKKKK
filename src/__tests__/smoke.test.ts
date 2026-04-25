/**
 * Smoke test — load the full public/index.html, verify its single inline
 * <script> parses and doesn't throw on identifiers / typos that only fail
 * at load time. A build-step is not required for this to work; we parse
 * the script body with `new Function(...)` (same mechanism the earlier
 * validation commands used during our manual debug passes) plus a
 * spot-check that the deferred tools are wired up.
 *
 * This catches the class of regressions where a find/replace typo or a
 * half-finished refactor leaves behind a `functoin foo()` or a dangling
 * template-literal — the kinds of issues that used to slip past because
 * there was no automated gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HTML_PATH = resolve(process.cwd(), 'public/index.html');
const HTML = readFileSync(HTML_PATH, 'utf8');

function extractScripts(html: string): string[] {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] && m[1].trim()) out.push(m[1]);
  }
  return out;
}

describe('public/index.html — structural smoke checks', () => {
  it('is large enough to be the real file (≥ 500 KB)', () => {
    expect(HTML.length).toBeGreaterThan(500_000);
  });

  it('has the TITAN brand in the <title>', () => {
    expect(HTML).toMatch(/<title>[^<]*TITAN[^<]*<\/title>/);
  });

  it('contains the monolith inline <script> block', () => {
    // The renderer used to be exactly one inline script. The landing-page
    // gate (Aug-2025) added a small second one that drives the splash-then-
    // hide animation, so we now assert "at least one" plus a size floor on
    // the largest block to guarantee the real monolith is still embedded.
    const scripts = extractScripts(HTML);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    const longest = scripts.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(longest.length).toBeGreaterThan(400_000);
  });

  it('every inline <script> parses as valid JavaScript', () => {
    const scripts = extractScripts(HTML);
    expect(scripts.length).toBeGreaterThanOrEqual(1);
    // new Function() throws a SyntaxError on parse failure without executing.
    // This is strictly a parse check — we never call the function.
    for (const s of scripts) {
      expect(() => new Function(s)).not.toThrow();
    }
  });

  it('declares the four decks A, B, C, D', () => {
    expect(HTML).toMatch(/decks\s*=\s*\{\s*A:\s*createDeck\('A'\)\s*,\s*B:\s*createDeck\('B'\)/);
  });

  it('has the CUE + PLAY transport buttons wired (verified handler hooks exist)', () => {
    expect(HTML).toMatch(/data-action="cue"/);
    expect(HTML).toMatch(/data-action="play"/);
    expect(HTML).toMatch(/function cueDeck/);
    expect(HTML).toMatch(/function togglePlay/);
  });

  it('has the SOUND tab mastering chain present', () => {
    expect(HTML).toMatch(/STUDIO MASTERING/);
    expect(HTML).toMatch(/id="ampVuNeedleL"/);
    expect(HTML).toMatch(/id="ampPpmL"/);
    expect(HTML).toMatch(/id="ampGonio"/);
  });

  it('does not contain any KOBI2100 backdoor anymore', () => {
    // Security regression guard — this string shipped for a while as a
    // hardcoded admin-unlock code in the renderer. If it ever comes back,
    // this test must fail so we notice before shipping.
    expect(HTML).not.toMatch(/KOBI2100/);
    expect(HTML).not.toMatch(/titan_installer_unlocked_kobi/);
  });

  it('admin office page no longer ships a hardcoded unlock code', () => {
    // Companion to the renderer guard above: the admin panel
    // (`app/office/page.tsx`) used the same shared secret. It now
    // gates on Supabase auth + profiles.role === 'admin', so the
    // string must not reappear in the source either.
    const officeSource = readFileSync(
      resolve(process.cwd(), 'app/office/page.tsx'),
      'utf8',
    );
    expect(officeSource).not.toMatch(/KOBI2100/);
    expect(officeSource).not.toMatch(/titan_office_unlocked/);
    expect(officeSource).toMatch(/profiles[\s\S]*role/);
  });

  it('has the Supabase auth modal (sign-in gate for downloads)', () => {
    expect(HTML).toMatch(/id="authGoogleBtn"/);
    expect(HTML).toMatch(/_supa\.auth\.signInWithOAuth/);
  });

  it('library virtualization is in place (not the old forEach bloat)', () => {
    expect(HTML).toMatch(/_libRenderWindow/);
    expect(HTML).toMatch(/_libView/);
  });

  it('MIDI subsystem has hot-plug + preset support', () => {
    expect(HTML).toMatch(/midiAccess\.onstatechange/);
    expect(HTML).toMatch(/MIDI_PRESETS/);
    expect(HTML).toMatch(/applyMidiPreset/);
  });
});
