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
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import { CHROMIUM_OPTIONS, prepareModels } from './sizzle-gl.js';

const ENTRY = path.resolve(__dirname, '../src/Root.tsx');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUT_DIR = path.resolve(__dirname, '../out');

interface Target {
  id: string;
  out: string;
}

/** h264 quality. Lower is better/larger. Override with SIZZLE_CRF to re-test. */
// v2 (3D arena scenes): 28 → 34. The 3D footage is far busier than the old
// near-black isometric cut — lit windows, reflections, moving traffic — and at
// 28 the landscape file tripled to 18 MB. Rendered at 28 / 32 / 35 with the
// veryslow preset (16.5 / 11.0 / 8.4 MB) and compared crops of the same frames:
// robot armor, block edges and floor grid hold at all three, with the grid
// slightly softer at 35. 34 sits just inside that.
const CRF = Number(process.env.SIZZLE_CRF ?? 34);
/** x264 effort. Slower presets buy smaller files at the same CRF; override with SIZZLE_PRESET. */
const PRESET = (process.env.SIZZLE_PRESET ?? 'veryslow') as 'medium' | 'slow' | 'slower' | 'veryslow';
/** Held payoff of the arena scene: both cities built, caption up. */
const POSTER_FRAME = Number(process.env.SIZZLE_POSTER_FRAME ?? 880);

const ALL_TARGETS: Target[] = [
  { id: 'SizzleLandscape', out: 'sizzle-16x9.mp4' },
  { id: 'SizzlePortrait',  out: 'sizzle-9x16.mp4' },
  { id: 'SizzleSquare',    out: 'sizzle-1x1.mp4'  },
];

/** Render a subset with SIZZLE_ONLY=SizzleLandscape (comma-separated ids). */
const ONLY = (process.env.SIZZLE_ONLY ?? '').split(',').filter(Boolean);
const TARGETS = ONLY.length ? ALL_TARGETS.filter((t) => ONLY.includes(t.id)) : ALL_TARGETS;

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  prepareModels();
  console.log('bundling…');
  const serveUrl = await bundle({
    entryPoint: ENTRY,
    publicDir: PUBLIC_DIR,
  });
  console.log('  bundle ready');

  for (const target of TARGETS) {
    const outputLocation = path.join(OUT_DIR, target.out);
    console.log(`\nrendering ${target.id} → ${target.out}`);
    const composition = await selectComposition({ serveUrl, id: target.id, chromiumOptions: CHROMIUM_OPTIONS });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      chromiumOptions: CHROMIUM_OPTIONS,
      /**
       * The 16×9 cut is the hero video on arena4.ai — the first thing a stranger
       * downloads, competing with the page render. Remotion's default h264 is
       * near-lossless and produced ~11 MB, which is heavy for that job.
       *
       * CRF is set explicitly and was chosen by LOOKING at the result, not by
       * picking a number: this reel is mostly near-black with thin bright lines
       * and small type, which is exactly the content h264 bands and smears when
       * over-compressed. Override with SIZZLE_CRF to re-test.
       *
       * 28 was chosen by encoding at 23 and 28, pulling the SAME frame out of
       * both files, and comparing the hardest region — the dark territory
       * gradient behind the block city — at 2x. They are indistinguishable:
       * same edge sharpness, same gradient, the dashed "inferred" cap outlines
       * still legible in both. 23 gave 7.4 MB; 28 gives 5.0 MB.
       */
      crf: CRF,
      x264Preset: PRESET,
      outputLocation,
      onProgress: ({ progress }) => {
        if (progress % 0.1 < 0.01) process.stdout.write(`\r  ${Math.round(progress * 100)}%  `);
      },
    });
    console.log(`\n  ✓ ${outputLocation}  (${(fs.statSync(outputLocation).size / 1024 / 1024).toFixed(1)} MB)`);

    // A poster for the landscape cut, so the hero has something sharp to show
    // before the video decodes. POSTER_FRAME is the held payoff of the arena
    // scene — both cities built — rather than an empty floor.
    if (target.id === 'SizzleLandscape') {
      const poster = path.join(OUT_DIR, 'sizzle-poster.jpg');
      await renderStill({
        composition,
        serveUrl,
        output: poster,
        frame: POSTER_FRAME,
        imageFormat: 'jpeg',
        chromiumOptions: CHROMIUM_OPTIONS,
        jpegQuality: 90,
        overwrite: true,
      });
      console.log(`  ✓ ${poster}  (${Math.round(fs.statSync(poster).size / 1024)} KB, frame ${POSTER_FRAME})`);
    }
  }

  console.log('\n✓ all sizzles rendered');
}

run().catch((err) => {
  console.error('render failed:', err);
  process.exit(1);
});
