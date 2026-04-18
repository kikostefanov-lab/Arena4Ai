// Quick visual preview of marketing/index.html post-edits.
// Serves via file:// — sizzle video won't autoplay in this context (CORS on file://)
// but layout, copy, and styling are verifiable.

import { chromium } from 'playwright';
import path from 'node:path';

const PAGE = 'file://' + path.resolve(__dirname, '../../../marketing/index.html');

async function run(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const outDir = path.resolve(__dirname, '../out/marketing-preview');
  const fs = await import('node:fs');
  fs.mkdirSync(outDir, { recursive: true });

  await page.screenshot({ path: path.join(outDir, 'hero.png'), fullPage: false });
  await page.screenshot({ path: path.join(outDir, 'full.png'), fullPage: true });
  console.log(`✓ previews at ${outDir}`);
  await browser.close();
}
run().catch((e) => { console.error(e); process.exit(1); });
