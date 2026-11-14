import { describe, it, expect, afterEach, vi } from 'vitest';

// createApp() pulls in the database client at import time; CI has no database.
vi.mock('../db/client.js', () => ({ db: {} }));
vi.mock('../server/routes/briefs-seed.js', () => ({ seedYamlBriefs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../db/seed-personas-agents.js', () => ({ seedPersonasAgents: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../server/repo.js', () => ({ repo: {} }));

import request from 'supertest';
import { spawn } from 'node:child_process';
import { issueStreamTicket, verifyStreamTicket, isStreamAuthorized, STREAM_TICKET_TTL_MS } from '../server/stream-ticket.js';
import { helperEnv } from '../utils/claude-helper.js';
import { createApp } from '../server/app.js';
import { BaseAdapter, shutdownAllAdapters } from '../adapters/base-adapter.js';

const KEY = 'test-key-not-a-real-secret';

describe('stream tickets', () => {
  it('a ticket opens only the competition it was issued for, until it expires', () => {
    const now = 1_000_000;
    const t = issueStreamTicket('comp-a', KEY, now);
    expect(verifyStreamTicket(t, 'comp-a', KEY, now + 1)).toBe(true);
    expect(verifyStreamTicket(t, 'comp-b', KEY, now + 1)).toBe(false);
    expect(verifyStreamTicket(t, 'comp-a', KEY, now + STREAM_TICKET_TTL_MS + 1)).toBe(false);
    expect(verifyStreamTicket(t, 'comp-a', 'another-key', now + 1)).toBe(false);
  });

  it('rejects malformed and tampered tickets', () => {
    const now = 1_000_000;
    const t = issueStreamTicket('comp-a', KEY, now);
    const [exp, mac] = t.split('.');
    // Extending the expiry invalidates the signature.
    expect(verifyStreamTicket(`${Number(exp) + 60_000}.${mac}`, 'comp-a', KEY, now)).toBe(false);
    for (const bad of ['', 'nope', '.abc', `${exp}.`, `${exp}.zz`, null, undefined]) {
      expect(verifyStreamTicket(bad, 'comp-a', KEY, now)).toBe(false);
    }
  });

  it('the stream is open with no key, and needs the key or a ticket once one is set', () => {
    const now = 1_000_000;
    const noKey = {} as NodeJS.ProcessEnv;
    const withKey = { ARENA_API_KEY: KEY } as NodeJS.ProcessEnv;
    expect(isStreamAuthorized({ headers: {} }, 'c', '', noKey, now)).toBe(true);
    expect(isStreamAuthorized({ headers: {} }, 'c', '', withKey, now)).toBe(false);
    expect(isStreamAuthorized({ headers: { authorization: `Bearer ${KEY}` } }, 'c', '', withKey, now)).toBe(true);
    expect(isStreamAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'c', '', withKey, now)).toBe(false);
    const ticket = encodeURIComponent(issueStreamTicket('c', KEY, now));
    expect(isStreamAuthorized({ headers: {} }, 'c', `ticket=${ticket}`, withKey, now)).toBe(true);
    expect(isStreamAuthorized({ headers: {} }, 'other', `ticket=${ticket}`, withKey, now)).toBe(false);
  });
});

describe('stream-ticket route', () => {
  const saved = process.env.ARENA_API_KEY;
  afterEach(() => { if (saved === undefined) delete process.env.ARENA_API_KEY; else process.env.ARENA_API_KEY = saved; });

  it('answers null with no key, refuses without the key, and issues a valid ticket with it', async () => {
    delete process.env.ARENA_API_KEY;
    const open = await request(createApp()).get('/competitions/abc/stream-ticket');
    expect(open.status).toBe(200);
    expect(open.body.ticket).toBeNull();

    process.env.ARENA_API_KEY = KEY;
    const app = createApp();
    expect((await request(app).get('/competitions/abc/stream-ticket')).status).toBe(401);
    const ok = await request(app).get('/competitions/abc/stream-ticket').set('Authorization', `Bearer ${KEY}`);
    expect(ok.status).toBe(200);
    expect(verifyStreamTicket(ok.body.ticket, 'abc', KEY)).toBe(true);
  });
});

describe('browser origins on the HTTP API', () => {
  it('refuses a foreign origin, echoes an allowed one, and ignores requests with no Origin', async () => {
    const app = createApp();
    const foreign = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(403);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();

    const local = await request(app).get('/health').set('Origin', 'http://localhost:3001');
    expect(local.status).toBe(200);
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:3001');

    const none = await request(app).get('/health');
    expect(none.status).toBe(200);
    expect(none.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses a foreign-origin write even with no key set', async () => {
    const res = await request(createApp()).post('/competitions').set('Origin', 'https://evil.example').send({});
    expect(res.status).toBe(403);
  });
});

describe('judge environment for non-claude providers', () => {
  const host = {
    PATH: '/usr/bin', HOME: '/home/op',
    DATABASE_URL: 'postgres://secret', ARENA_API_KEY: 'k', GITHUB_TOKEN: 'g', AWS_SECRET_ACCESS_KEY: 'a', SSH_AUTH_SOCK: '/s',
    ANTHROPIC_API_KEY: 'ant', OPENAI_API_KEY: 'oai', CODEX_HOME: '/c', GEMINI_API_KEY: 'gem', GOOGLE_CLOUD_PROJECT: 'p',
  } as NodeJS.ProcessEnv;

  it.each([
    ['codex', ['OPENAI_API_KEY', 'CODEX_HOME'], ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT']],
    ['gemini', ['GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT'], ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_HOME']],
    ['claude', ['ANTHROPIC_API_KEY'], ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT']],
  ] as const)('%s gets its own namespace and none of the operator secrets', (provider, kept, dropped) => {
    const env = helperEnv(provider, host);
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/op');
    for (const k of kept) expect(env[k]).toBeDefined();
    for (const k of [...dropped, 'DATABASE_URL', 'ARENA_API_KEY', 'GITHUB_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK']) {
      expect(env[k]).toBeUndefined();
    }
  });
});

describe('shutdownAllAdapters', () => {
  it.skipIf(process.platform === 'win32')('stops every agent process this process started', async () => {
    class Stub extends BaseAdapter {
      async startExecution(): Promise<void> {
        this.process = spawn('sh', ['-c', 'sleep 30'], { detached: true, stdio: 'ignore' });
      }
      pid(): number | undefined { return this.process?.pid; }
    }
    const a = new Stub('team-a', '/tmp', 'c1'), b = new Stub('team-b', '/tmp', 'c1');
    a.shutdownGraceMs = 300; b.shutdownGraceMs = 300;
    await a.startExecution(); await b.startExecution();
    const pids = [a.pid()!, b.pid()!];
    await shutdownAllAdapters();
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  });
});
