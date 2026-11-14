/**
 * Every helper stage that spawns `claude` must run tool-less with a minimal
 * environment, because its prompt embeds agent-written (untrusted) files.
 * Competitor adapters are intentionally not covered here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';

const RESPONSE = JSON.stringify({
  overallRationale: 'r', perCriterion: [], synthesis: '# s', summary: 's', highlights: [],
  criteriaMapping: [], src: {}, tests: {}, readme: '# readme', domain: 'software', questions: [],
  scores: [], systemPrompt: 'p', name: 'n', description: 'd',
});

type Call = { bin: string; args: string[]; env: NodeJS.ProcessEnv | undefined };
const spawnCalls = vi.hoisted(() => [] as Call[]);

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  type Emitter = InstanceType<typeof EventEmitter>;
  return {
    spawn: vi.fn((bin: string, args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      spawnCalls.push({ bin, args, env: opts?.env });
      const child = new EventEmitter() as Emitter & Record<string, unknown>;
      child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      setTimeout(() => {
        (child.stdout as Emitter).emit('data', Buffer.from(RESPONSE));
        child.emit('close', 0);
      }, 1);
      return child;
    }),
  };
});

import { helperClaudeArgs, helperClaudeEnv } from '../utils/claude-helper.js';
import { synthesizeDeliverables } from '../synthesis/merge-engine.js';
import { generateAllPresentations } from '../presentation/presentation-generator.js';
import { CommentaryAgent } from '../commentary/commentary-agent.js';
import { generateStarterKit } from '../forge/forge-orchestrator.js';
import { runIntake } from '../brief/intake.js';
import { aiJudge } from '../judging/ai-judge.js';

const brief: Brief = {
  id: 'h-001', title: 'Hardening', format: CompetitionFormat.SPRINT, problem: 'Write fizzbuzz',
  constraints: [], deliverables: ['solution.py'], timeLimitMs: 60_000, deliverableType: 'code',
  rubric: { criteria: [{ id: 'correctness', description: 'Correct?', weight: 1, maxScore: 10 }] },
};
const deliverable: Deliverable = {
  teamId: 'team-a', files: [{ path: 'solution.py', content: 'print(1)' }],
  collectedAt: new Date().toISOString(),
};

const SECRETS = {
  DATABASE_URL: 'postgres://u:p@h/db',
  ARENA_API_KEY: 'arena-secret',
  OPENAI_API_KEY: 'sk-openai',
  GITHUB_TOKEN: 'ghp_x',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  CLAUDECODE: '1',
};

function expectHardened(call: Call) {
  expect(call.args).not.toContain('--dangerously-skip-permissions');
  const t = call.args.indexOf('--tools');
  expect(t).toBeGreaterThan(-1);
  expect(call.args[t + 1]).toBe('');
  expect(call.args[call.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
  expect(call.args).toContain('--strict-mcp-config');
  expect(call.args).toContain('--disable-slash-commands');
  expect(call.env).toBeDefined();
  for (const k of Object.keys(SECRETS)) expect(call.env, k).not.toHaveProperty(k);
  expect(call.env).toHaveProperty('PATH');
  expect(call.env).toHaveProperty('HOME');
}

describe('helper arg/env builders', () => {
  it('args pin the model and disable tools', () => {
    const a = helperClaudeArgs({ model: 'm-1' });
    expect(a[a.indexOf('--model') + 1]).toBe('m-1');
    expect(a).not.toContain('--dangerously-skip-permissions');
  });

  it('env keeps auth/runtime variables and drops everything else', () => {
    const env = helperClaudeEnv({
      PATH: '/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k', CLAUDE_CONFIG_DIR: '/c',
      CLAUDE_CODE_OAUTH_TOKEN: 't', HTTPS_PROXY: 'p', LC_ALL: 'C',
      CLAUDE_CODE_SSE_PORT: '1', CLAUDE_BRIDGE_TOKEN: 'x', ARENA_JUDGE_MODEL: 'm',
      ...SECRETS,
    });
    expect(Object.keys(env).sort()).toEqual(
      ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'HOME', 'HTTPS_PROXY', 'LC_ALL', 'PATH'],
    );
  });

  it('forwards AWS_* only when Bedrock is enabled', () => {
    const base = { PATH: '/bin', AWS_PROFILE: 'p' };
    expect(helperClaudeEnv(base)).not.toHaveProperty('AWS_PROFILE');
    expect(helperClaudeEnv({ ...base, CLAUDE_CODE_USE_BEDROCK: '1' })).toHaveProperty('AWS_PROFILE');
  });
});

describe('every helper spawn site is hardened', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    spawnCalls.length = 0;
    for (const [k, v] of Object.entries(SECRETS)) { saved[k] = process.env[k]; process.env[k] = v; }
  });
  afterEach(() => {
    for (const k of Object.keys(SECRETS)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  it('synthesis', async () => {
    await synthesizeDeliverables(brief, [deliverable, { ...deliverable, teamId: 'team-b' }], {});
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('presentations', async () => {
    await generateAllPresentations(brief, [deliverable], new Map([['team-a', 'claude:architect']]));
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('judge (claude provider)', async () => {
    await aiJudge(brief, deliverable, brief.rubric, { judgeId: 'j1' });
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('commentary', async () => {
    const { EventEmitter } = await import('node:events');
    const runner = new EventEmitter() as InstanceType<typeof EventEmitter> & { competitionId: string };
    runner.competitionId = 'c1';
    const agent = new CommentaryAgent(runner as never, { batchSize: 1 });
    agent.start();
    runner.emit('arenaEvent', {
      eventId: 'e1', competitionId: 'c1', teamId: 'team-a', type: 'REASONING',
      timestamp: new Date().toISOString(), payload: { text: 'x' },
    });
    await new Promise((r) => setTimeout(r, 30));
    agent.stop();
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('forge', async () => {
    await generateStarterKit(brief, [{ teamId: 'team-a', files: deliverable.files }]);
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('brief intake', async () => {
    await runIntake('an idea').catch(() => undefined);
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('brief generation route', async () => {
    const [{ default: express }, request, { generateBriefRouter }] = await Promise.all([
      import('express'),
      import('supertest').then((m) => m.default),
      import('../server/routes/generate-brief.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/generate-brief', generateBriefRouter);
    await request(app).post('/generate-brief/generate').send({ idea: 'build me a thing', domain: 'software', answers: [] });
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
  });

  it('persona generation route', async () => {
    const [{ default: express }, request, { generatePersonaRouter }] = await Promise.all([
      import('express'),
      import('supertest').then((m) => m.default),
      import('../server/routes/generate-persona.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/generate-persona', generatePersonaRouter);
    await request(app).post('/generate-persona').send({ mode: 'full', idea: 'a careful reviewer' });
    expect(spawnCalls.length).toBeGreaterThan(0);
    spawnCalls.forEach(expectHardened);
    for (const c of spawnCalls) expect(c.args).toContain('--model');
  });
});
