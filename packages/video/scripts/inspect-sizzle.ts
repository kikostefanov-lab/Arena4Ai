// Render single-frame stills from the sizzle to verify scenes look right.

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';
import { CHROMIUM_OPTIONS, prepareModels } from './sizzle-gl.js';

const ENTRY = path.resolve(__dirname, '../src/Root.tsx');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUT_DIR = path.resolve(__dirname, '../out/frames');

// Frames to grab — midpoints of scenes where content should be fully visible
const CHECKPOINTS = [
  { frame: 30,   label: '01-intro' },
  { frame: 160,  label: '02-question' },
  { frame: 262,  label: '03a-robot-reveal-landing' },
  { frame: 390,  label: '03b-robot-reveal-lineup' },
  { frame: 550,  label: '04-brief' },
  { frame: 680,  label: '05a-district-wide' },
  { frame: 760,  label: '05b-district-hero-a' },
  { frame: 830,  label: '05c-district-hero-b' },
  { frame: 900,  label: '05d-district-hold' },
  { frame: 1100, label: '06-verdict' },
  { frame: 1400, label: '07-forge' },
  { frame: 1650, label: '08-pillars' },
  { frame: 1820, label: '09-outro' },
];

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  prepareModels();
  console.log('bundling…');
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR });
  console.log('  bundle ready');

  const composition = await selectComposition({ serveUrl, id: process.env.SIZZLE_COMP ?? 'SizzleLandscape', chromiumOptions: CHROMIUM_OPTIONS });

  const only = (process.env.SIZZLE_FRAMES ?? '').split(',').filter(Boolean).map(Number);
  for (const ck of CHECKPOINTS.filter((c) => !only.length || only.includes(c.frame))) {
    const outputLocation = path.join(OUT_DIR, `${ck.label}.png`);
    console.log(`→ frame ${ck.frame} (${ck.label})`);
    await renderStill({ composition, serveUrl, output: outputLocation, frame: ck.frame, chromiumOptions: CHROMIUM_OPTIONS });
  }
  console.log(`✓ frames saved to ${OUT_DIR}`);
}

run().catch((err) => {
  console.error('inspect failed:', err);
  process.exit(1);
});
