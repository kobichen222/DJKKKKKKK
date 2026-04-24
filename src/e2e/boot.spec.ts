import { test, expect } from '@playwright/test';

/**
 * These tests answer exactly one question: does the app actually boot
 * and render its primary UI without throwing a runtime error?
 *
 * The vitest smoke test verifies that the script parses. This one makes
 * sure the script *runs* — catches the class of bugs where a find/replace
 * left behind a call to a function that was deleted, or where a deck
 * initialisation path dereferences a null because the DOM isn't ready.
 */

test.describe('TITAN boots cleanly', () => {
  test('no uncaught errors during load', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/index.html', { waitUntil: 'load' });
    // Let the deferred init code settle (setTimeout-wrapped wiring in
    // DOMContentLoaded handlers)
    await page.waitForTimeout(800);

    // Filter the known noisy "failed to load YouTube API" error that only
    // appears when offline. It's not a regression.
    const real = errors.filter(
      (e) => !/youtube|iframe_api|blocked by cors|Failed to load resource/i.test(e),
    );
    expect(real).toEqual([]);
  });

  test('the four deck chassis render', async ({ page }) => {
    await page.goto('/index.html');
    for (const d of ['A', 'B', 'C', 'D']) {
      await expect(page.locator(`.cdj[data-deck="${d}"]`)).toHaveCount(1);
    }
  });

  test('CUE + PLAY transport buttons exist and are clickable', async ({ page }) => {
    await page.goto('/index.html');
    const cueA = page.locator('.big-btn.cue[data-deck="A"]');
    const playA = page.locator('.big-btn.play[data-deck="A"]');
    await expect(cueA).toBeVisible();
    await expect(playA).toBeVisible();
    // A click on an empty deck should NOT crash — the handler toasts "No track"
    await cueA.click({ trial: false });
    await playA.click({ trial: false });
  });

  test('switching tabs exposes the SOUND mastering UI', async ({ page }) => {
    await page.goto('/index.html');
    const soundTab = page.locator('.tab-btn[data-tab="studio"]');
    if ((await soundTab.count()) === 0) test.skip(true, 'SOUND tab not in this build');
    await soundTab.click();
    await expect(page.locator('#ampVuNeedleL')).toBeVisible();
    await expect(page.locator('#ampPpmL')).toBeAttached();
    await expect(page.locator('#ampGonio')).toBeVisible();
  });

  test('library search does not throw', async ({ page }) => {
    await page.goto('/index.html');
    const search = page.locator('#searchInput');
    await search.fill('nothing-should-match-12345');
    // Sort + filter changes trigger renderLibrary — the virtualized path
    // must survive all of them without crashing.
    await page.selectOption('#sortSelect', 'title');
    await page.selectOption('#filterSource', 'all');
  });
});
