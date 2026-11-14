/**
 * Network exposure: default bind, startup warning, WebSocket Origin allow-list,
 * and the web proxy's same-origin check.
 *
 * packages/web has no test runner, so its pure origin check is imported here by
 * a computed path (kept out of tsc's rootDir on purpose).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_HOST,
  resolveHost,
  isLoopbackHost,
  exposureWarning,
  isAllowedWsOrigin,
} from '../network.js';

describe('resolveHost', () => {
  it('defaults to loopback', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(resolveHost(undefined, {})).toBe('127.0.0.1');
    expect(resolveHost('', { ARENA_HOST: '  ' })).toBe('127.0.0.1');
  });
  it('honours ARENA_HOST, and the flag beats the env var', () => {
    expect(resolveHost(undefined, { ARENA_HOST: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveHost('10.0.0.5', { ARENA_HOST: '0.0.0.0' })).toBe('10.0.0.5');
  });
});

describe('exposureWarning', () => {
  it('is silent on loopback, with or without a key', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(exposureWarning('127.0.0.1', {})).toBeNull();
  });
  it('warns when exposed without a key', () => {
    expect(exposureWarning('0.0.0.0', {})).toMatch(/ARENA_API_KEY unset/);
    expect(exposureWarning('192.168.1.4', {})).not.toBeNull();
  });
  it('is silent when exposed with a key', () => {
    expect(exposureWarning('0.0.0.0', { ARENA_API_KEY: 'k' })).toBeNull();
  });
});

describe('isAllowedWsOrigin', () => {
  it('allows no Origin (non-browser clients) and loopback origins by default', () => {
    expect(isAllowedWsOrigin(undefined, {})).toBe(true);
    expect(isAllowedWsOrigin('http://localhost:3001', {})).toBe(true);
    expect(isAllowedWsOrigin('http://127.0.0.1:3001', {})).toBe(true);
    expect(isAllowedWsOrigin('http://[::1]:3001', {})).toBe(true);
  });
  it('rejects other origins by default', () => {
    expect(isAllowedWsOrigin('https://evil.example', {})).toBe(false);
    expect(isAllowedWsOrigin('http://localhost.evil.example', {})).toBe(false);
    expect(isAllowedWsOrigin('null', {})).toBe(false);
  });
  it('honours ARENA_ALLOWED_ORIGINS', () => {
    const env = { ARENA_ALLOWED_ORIGINS: 'https://arena.example.com/, https://b.example' };
    expect(isAllowedWsOrigin('https://arena.example.com', env)).toBe(true);
    expect(isAllowedWsOrigin('https://b.example', env)).toBe(true);
    expect(isAllowedWsOrigin('https://evil.example', env)).toBe(false);
    expect(isAllowedWsOrigin('https://evil.example', { ARENA_ALLOWED_ORIGINS: '*' })).toBe(true);
  });
});

describe('web same-origin check (packages/web/lib/origin-check.ts)', () => {
  type Check = (i: {
    method: string;
    pathname: string;
    header: (n: string) => string | undefined;
    allowedOrigins?: string;
  }) => { ok: boolean; reason?: string };
  let check: Check;

  beforeAll(async () => {
    const p = fileURLToPath(new URL('../../../../web/lib/origin-check.ts', import.meta.url));
    check = ((await import(/* @vite-ignore */ p)) as { checkMutationOrigin: Check }).checkMutationOrigin;
  });

  const call = (
    method: string,
    headers: Record<string, string>,
    extra: { pathname?: string; allowedOrigins?: string } = {},
  ) =>
    check({
      method,
      pathname: extra.pathname ?? '/api/competitions',
      header: (n) => headers[n.toLowerCase()],
      allowedOrigins: extra.allowedOrigins,
    });

  it('passes reads and non-api paths regardless of headers', () => {
    expect(call('GET', { 'sec-fetch-site': 'cross-site' }).ok).toBe(true);
    expect(call('POST', { 'sec-fetch-site': 'cross-site' }, { pathname: '/competitions' }).ok).toBe(true);
  });
  it('passes same-origin browser requests and user-initiated ones', () => {
    expect(call('POST', { 'sec-fetch-site': 'same-origin' }).ok).toBe(true);
    expect(call('DELETE', { 'sec-fetch-site': 'none' }).ok).toBe(true);
  });
  it('blocks cross-site and same-site (other localhost port) mutations', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(call(m, { 'sec-fetch-site': 'cross-site' }).ok).toBe(false);
    }
    expect(call('POST', { 'sec-fetch-site': 'same-site' }).ok).toBe(false);
  });
  it('falls back to Origin vs Host when Sec-Fetch-Site is absent', () => {
    const host = 'localhost:3001';
    expect(call('POST', { origin: 'http://localhost:3001', host }).ok).toBe(true);
    expect(call('POST', { origin: 'http://localhost:4000', host }).ok).toBe(false);
    expect(call('POST', { origin: 'https://evil.example', host }).ok).toBe(false);
    expect(call('POST', { origin: 'garbage', host }).ok).toBe(false);
    expect(call('POST', { origin: 'https://app.example', host: 'internal:3001', 'x-forwarded-host': 'app.example' }).ok).toBe(true);
  });
  it('allows requests with neither header (curl, server-side, local dev scripts)', () => {
    expect(call('POST', {}).ok).toBe(true);
  });
  it('honours ARENA_WEB_ALLOWED_ORIGINS', () => {
    const allowedOrigins = 'https://ui.example.com';
    expect(call('POST', { 'sec-fetch-site': 'cross-site', origin: 'https://ui.example.com' }, { allowedOrigins }).ok).toBe(true);
    expect(call('POST', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, { allowedOrigins }).ok).toBe(false);
  });
});

describe('every web proxy fetch to the orchestrator sends credentials', () => {
  // With ARENA_API_KEY set the orchestrator guards reads too, so a proxy GET
  // without orchestratorHeaders() would 401 in the UI.
  const WEB_API = fileURLToPath(new URL('../../../../web/app/api', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const f = join(dir, e);
      return statSync(f).isDirectory() ? files(f) : f.endsWith('.ts') ? [f] : [];
    });

  it('passes orchestratorHeaders (or a headers variable built from it) to each fetch', () => {
    const offenders: string[] = [];
    for (const f of files(WEB_API)) {
      if (f.endsWith(join('health', 'route.ts'))) continue; // /health is intentionally open
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bfetch\(/g)) {
        const window = src.slice(m.index!, m.index! + 400);
        if (!/orchestratorHeaders|\{ headers \}/.test(window)) offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
