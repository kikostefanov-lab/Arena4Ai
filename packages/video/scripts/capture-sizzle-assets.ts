/**
 * Screen-grab capture for the Arena4Ai sizzle video.
 *
 * Navigates the running app (web on :3001, API on :3000), takes retina-resolution
 * PNGs of key product moments, and saves them to
 * `packages/video/public/sizzle-assets/`.
 *
 * Run:
 *   npx tsx packages/video/scripts/capture-sizzle-assets.ts
 *
 * Prereqs:
 *   - orchestrator API running on 3000
 *   - web UI running on 3001
 *   - `arena4ai-launch-strategy-001` competition `78c7452f-...` is COMPLETE + has forge artifacts
 */

import { chromium, Browser, Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const LAUNCH_COMPETITION_ID = '78c7452f-bab5-47cf-915e-188249503c80';
const WEB = 'http://localhost:3001';

const OUT_DIR = path.resolve(__dirname, '../public/sizzle-assets');

async function shot(page: Page, filename: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  const file = path.join(OUT_DIR, filename);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, type: 'png' });
  console.log(`  ✓ ${filename}`);
}

async function waitForArena(page: Page): Promise<void> {
  // Wait for canvas to be present (v2 arena renders in a canvas)
  await page.waitForSelector('canvas', { timeout: 5000 }).catch(() => {});
  // Give RAF a few frames to settle (pose lerp + winner banner fade-in)
  await page.waitForTimeout(1500);
}

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Retina-ish viewport — 1.5× scale approximates 2880×1620 final output
  const browser: Browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();

  console.log('→ capturing homepage');
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '01-homepage.png', { fullPage: false });
  await shot(page, '01-homepage-full.png', { fullPage: true });

  console.log('→ capturing brief library');
  await page.goto(`${WEB}/briefs`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '02-briefs.png', { fullPage: false });

  console.log('→ capturing brief builder (new competition)');
  await page.goto(`${WEB}/competitions/new`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '03-brief-builder.png', { fullPage: false });

  console.log('→ capturing stats');
  await page.goto(`${WEB}/stats`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await shot(page, '04-stats.png', { fullPage: false });

  console.log('→ capturing launch-strategy competition');
  await page.goto(`${WEB}/competitions/${LAUNCH_COMPETITION_ID}`, { waitUntil: 'networkidle' });
  await waitForArena(page);
  await shot(page, '05-battle-view.png', { fullPage: false });

  // Scroll to Scores tab (default on complete)
  await page.click('text=SCORES').catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '06-scores-tab.png', { fullPage: false });

  // Presentations tab
  await page.click('text=PRESENTATIONS').catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '07-presentations-tab.png', { fullPage: false });

  // Synthesis tab
  await page.click('text=SYNTHESIS').catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '08-synthesis-tab.png', { fullPage: false });

  // Forge tab — the showstopper
  await page.click('text=FORGE').catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, '09-forge-tab.png', { fullPage: false });
  await shot(page, '09-forge-tab-full.png', { fullPage: true });

  // Capture close-ups of a few specific artifacts by clicking
  console.log('→ capturing forge artifact close-ups');
  const artifactNames = ['executive_summary', 'business_case', 'go_to_market'];
  for (const name of artifactNames) {
    // Click on artifact card (by looking for its filename or title text)
    const clicked = await page
      .getByText(name, { exact: false })
      .first()
      .click({ timeout: 1500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await page.waitForTimeout(1000);
      await shot(page, `10-artifact-${name}.png`, { fullPage: false });
      // Close modal if any — try Escape
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  await browser.close();
  console.log(`\n✓ assets saved to ${OUT_DIR}`);
}

run().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});
