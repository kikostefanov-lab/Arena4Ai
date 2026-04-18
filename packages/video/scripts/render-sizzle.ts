/**
 * Render the Arena4Ai sizzle in three aspect ratios.
 *
 * Outputs to packages/video/out/
 *   - sizzle-16x9.mp4  (1920×1080 — YouTube, landing hero)
 *   - sizzle-9x16.mp4  (1080×1920 — Reels, TikTok, Twitter)
 *   - sizzle-1x1.mp4   (1080×1080 — IG feed)
 *
 * Run:
 *   npx tsx packages/video/scripts/render-sizzle.ts
 */

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(__dirname, '../src/Root.tsx');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUT_DIR = path.resolve(__dirname, '../out');

interface Target {
  id: string;
  out: string;
}

const TARGETS: Target[] = [
  { id: 'SizzleLandscape', out: 'sizzle-16x9.mp4' },
  { id: 'SizzlePortrait',  out: 'sizzle-9x16.mp4' },
  { id: 'SizzleSquare',    out: 'sizzle-1x1.mp4'  },
];

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('bundling…');
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: PUBLIC_DIR,
  });
  console.log('  bundle ready');

  for (const target of TARGETS) {
    const outputLocation = path.join(OUT_DIR, target.out);
    console.log(`\nrendering ${target.id} → ${target.out}`);
    const composition = await selectComposition({ serveUrl, id: target.id });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation,
      onProgress: ({ progress }) => {
        if (progress % 0.1 < 0.01) process.stdout.write(`\r  ${Math.round(progress * 100)}%  `);
      },
    });
    console.log(`\n  ✓ ${outputLocation}  (${Math.round(fs.statSync(outputLocation).size / 1024 / 1024)} MB)`);
  }

  console.log('\n✓ all sizzles rendered');
}

run().catch((err) => {
  console.error('render failed:', err);
  process.exit(1);
});
