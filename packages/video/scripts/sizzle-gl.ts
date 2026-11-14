/**
 * What the 3D scenes need from the render scripts.
 *
 * - The robots: `packages/web/public/models/gladiators.glb` is the one copy in
 *   git (the app serves it). It is copied into this package's public dir at
 *   render time rather than committed twice.
 * - A real GL backend: headless Chromium has no WebGL unless asked for one.
 */
import path from 'node:path';
import fs from 'node:fs';

export const CHROMIUM_OPTIONS = { gl: 'angle' as const };

export function prepareModels(): void {
  const src = path.resolve(__dirname, '../../web/public/models/gladiators.glb');
  const dstDir = path.resolve(__dirname, '../public/models');
  if (!fs.existsSync(src)) {
    throw new Error(`robot model missing at ${src} — build it with: blender -b -P tools/blender/build_gladiators.py -- --out packages/web/public/models`);
  }
  fs.mkdirSync(dstDir, { recursive: true });
  fs.copyFileSync(src, path.join(dstDir, 'gladiators.glb'));
}
