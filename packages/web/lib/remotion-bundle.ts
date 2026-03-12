import { bundle } from '@remotion/bundler';
import path from 'path';

// Promise-singleton: bundle() is called at most once per process lifetime.
// Two simultaneous POST /reel requests both await the same promise safely.
let bundlePromise: Promise<string> | null = null;

export function getBundle(): Promise<string> {
  if (!bundlePromise) {
    // process.cwd() = packages/web (Next.js is invoked from there)
    const entryPoint = path.resolve(process.cwd(), '../video/src/index.ts');
    bundlePromise = bundle({ entryPoint });
  }
  return bundlePromise;
}
