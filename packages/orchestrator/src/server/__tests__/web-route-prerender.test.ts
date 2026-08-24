import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guards an invariant of the WEB package from the orchestrator's suite, because
 * `packages/web` has no test runner and giving it one would mean adding a
 * dependency to fix a two-line problem.
 *
 * THE INVARIANT: no route handler under `packages/web/app/api` may be
 * statically prerenderable. Every one of them proxies a live backend, so a
 * cached copy of it is a lie by construction.
 *
 * WHY A TEST AND NOT JUST THE DECLARATIONS: 28 of the 36 handlers are safe
 * because they read the Request object, which structurally cannot be evaluated
 * at build time. The other 8 are arg-less GETs, and several of those were
 * dynamic only by ACCIDENT — because the file also exported a POST, or because
 * one fetch happened to pass `cache: 'no-store'`. Deleting that POST would
 * silently turn a proxy back into a build-time snapshot, and the build would
 * stay green while doing it. Declarations fix today; this fixes tomorrow.
 */

const WEB_API = fileURLToPath(new URL('../../../../web/app/api', import.meta.url));

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

/** A GET whose parameter list is empty is the shape Next evaluates at build time. */
function hasArglessGet(src: string): boolean {
  return /export\s+(?:async\s+)?function\s+GET\s*\(\s*\)/.test(src);
}

function declaresDynamic(src: string): boolean {
  return /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(src);
}

describe('no web API route can be prerendered into a build', () => {
  const files = routeFiles(WEB_API);

  it('finds the route handlers at all (guards against a moved directory)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(
    routeFiles(WEB_API)
      .filter((f) => hasArglessGet(readFileSync(f, 'utf8')))
      .map((f) => [relative(WEB_API, f), f] as const),
  )('%s exports an arg-less GET, so it must declare force-dynamic', (_label, file) => {
    // Failing here means a route proxying the orchestrator would be baked into
    // the bundle at build time: it either aborts the export when no backend is
    // reachable, or — worse, because the build stays green — freezes whatever
    // that build machine's database happened to return and serves it forever.
    expect(declaresDynamic(readFileSync(file, 'utf8'))).toBe(true);
  });
});
