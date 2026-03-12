import { bundle } from '@remotion/bundler';
import path from 'path';

// Promise-singleton: bundle() is called at most once per process lifetime.
// Two simultaneous POST /reel requests both await the same promise safely.
let bundlePromise: Promise<string> | null = null;

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    // path.resolve from this file: packages/web/lib/remotion-bundle.ts
    // → packages/video/src/index.ts
    const entryPoint = path.resolve(__dirname, '../../video/src/index.ts');
    bundlePromise = bundle({ entryPoint });
  }
  return bundlePromise;
}
