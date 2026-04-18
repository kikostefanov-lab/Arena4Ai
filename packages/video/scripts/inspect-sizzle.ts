// Render single-frame stills from the sizzle to verify scenes look right.

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import fs from 'node:fs';

const ENTRY = path.resolve(__dirname, '../src/Root.tsx');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const OUT_DIR = path.resolve(__dirname, '../out/frames');

// Frames to grab — midpoints of scenes where content should be fully visible
const CHECKPOINTS = [
  { frame: 30,   label: '01-intro' },
  { frame: 160,  label: '02-question' },
  { frame: 330,  label: '03-gladiator-reveal' },
  { frame: 550,  label: '04-brief' },
  { frame: 800,  label: '05-battle-highlights' },
  { frame: 1100, label: '06-verdict' },
  { frame: 1400, label: '07-forge' },
  { frame: 1650, label: '08-pillars' },
  { frame: 1820, label: '09-outro' },
];

async function run(): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('bundling…');
  const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: PUBLIC_DIR });
  console.log('  bundle ready');

  const composition = await selectComposition({ serveUrl, id: 'SizzleLandscape' });

  for (const ck of CHECKPOINTS) {
    const outputLocation = path.join(OUT_DIR, `${ck.label}.png`);
    console.log(`→ frame ${ck.frame} (${ck.label})`);
    await renderStill({ composition, serveUrl, output: outputLocation, frame: ck.frame });
  }
  console.log(`✓ frames saved to ${OUT_DIR}`);
}

run().catch((err) => {
  console.error('inspect failed:', err);
  process.exit(1);
});
