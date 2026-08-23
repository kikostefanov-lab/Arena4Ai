/**
 * Every stage that shells out to the `claude` CLI must pin its model.
 *
 * An unpinned stage inherits whatever the CLI defaults to that week, so the
 * same competition re-run produces different synthesis text, different
 * presentations and different Forge artifacts for no recorded reason. The judge
 * was pinned first (resolveJudgeModel); these are the leftovers.
 *
 * The Forge additionally hardcoded `spawn('claude', …)`, ignoring CLAUDE_BIN —
 * a self-hoster whose binary lives elsewhere got a working app with a silently
 * broken Forge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompetitionFormat } from '@arena/shared';
import type { Brief, Deliverable } from '@arena/shared';

// One response blob that is "valid enough" for every stage we drive here; the
// assertions are about the spawn arguments, not the parsed result.
const RESPONSE = JSON.stringify({
  overallRationale: 'r',
  perCriterion: [],
  synthesis: '# s',
  summary: 's',
  highlights: [],
  criteriaMapping: [],
  src: {},
  tests: {},
  readme: '# readme',
  domain: 'software',
  questions: [],
});

const spawnCalls = vi.hoisted(() => [] as Array<{ bin: string; args: string[] }>);

vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events');
  type Emitter = InstanceType<typeof EventEmitter>;
  return {
    spawn: vi.fn((bin: string, args: string[]) => {
      spawnCalls.push({ bin, args });
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

import { DEFAULT_STAGE_MODEL, resolveStageModel } from '../adapters/model-registry.js';
import { synthesizeDeliverables } from '../synthesis/merge-engine.js';
import { generateAllPresentations } from '../presentation/presentation-generator.js';
import { CommentaryAgent } from '../commentary/commentary-agent.js';
import { generateStarterKit } from '../forge/forge-orchestrator.js';
import { runIntake } from '../brief/intake.js';

const brief: Brief = {
  id: 'pin-001',
  title: 'Pinning Test',
  format: CompetitionFormat.SPRINT,
  problem: 'Write fizzbuzz',
  constraints: [],
  deliverables: ['solution.py'],
  timeLimitMs: 60_000,
  deliverableType: 'code',
  rubric: { criteria: [{ id: 'correctness', description: 'Correct?', weight: 1, maxScore: 10 }] },
};

const deliverable: Deliverable = {
  teamId: 'team-a',
  files: [{ path: 'solution.py', content: 'print(1)' }],
  collectedAt: new Date().toISOString(),
};

/** `['--model', 'x']` appears as an adjacent pair in the arg list. */
function pinnedModel(args: string[]): string | undefined {
  const i = args.indexOf('--model');
  return i === -1 ? undefined : args[i + 1];
}

describe('helper stages pin their model', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
  });

  it('synthesis (merge-engine)', async () => {
    await synthesizeDeliverables(brief, [deliverable, { ...deliverable, teamId: 'team-b' }], {});
    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('presentations (presentation-generator)', async () => {
    await generateAllPresentations(brief, [deliverable], new Map([['team-a', 'claude:architect']]));
    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('commentary (commentary-agent)', async () => {
    const { EventEmitter } = await import('node:events');
    const runner = new EventEmitter() as InstanceType<typeof EventEmitter> & { competitionId: string };
    runner.competitionId = 'comp-1';

    const agent = new CommentaryAgent(runner as never, { batchSize: 1 });
    agent.start();
    runner.emit('arenaEvent', {
      eventId: 'e1', competitionId: 'comp-1', teamId: 'team-a',
      type: 'REASONING', timestamp: new Date().toISOString(), payload: { text: 'thinking' },
    });
    await new Promise((r) => setTimeout(r, 30));
    agent.stop();

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('forge (forge-orchestrator)', async () => {
    await generateStarterKit(brief, [{ teamId: 'team-a', files: deliverable.files }]);
    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('brief intake (brief/intake)', async () => {
    await runIntake('build me a thing').catch(() => undefined);
    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('brief generation (POST /generate-brief/generate)', async () => {
    const [{ default: express }, request, { generateBriefRouter }] = await Promise.all([
      import('express'),
      import('supertest').then((m) => m.default),
      import('../server/routes/generate-brief.js'),
    ]);
    const app = express();
    app.use(express.json());
    app.use('/generate-brief', generateBriefRouter);

    await request(app).post('/generate-brief/generate').send({
      idea: 'build me a thing',
      domain: 'software',
      answers: [],
    });

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe(DEFAULT_STAGE_MODEL);
  });

  it('honours ARENA_STAGE_MODEL', async () => {
    const previous = process.env['ARENA_STAGE_MODEL'];
    process.env['ARENA_STAGE_MODEL'] = 'claude-haiku-4-5';
    try {
      expect(resolveStageModel()).toBe('claude-haiku-4-5');
      await synthesizeDeliverables(brief, [deliverable, { ...deliverable, teamId: 'team-b' }], {});
      for (const call of spawnCalls) expect(pinnedModel(call.args)).toBe('claude-haiku-4-5');
    } finally {
      if (previous === undefined) delete process.env['ARENA_STAGE_MODEL'];
      else process.env['ARENA_STAGE_MODEL'] = previous;
    }
  });
});

describe('the Forge respects CLAUDE_BIN', () => {
  const previous = process.env['CLAUDE_BIN'];

  beforeEach(() => {
    spawnCalls.length = 0;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env['CLAUDE_BIN'];
    else process.env['CLAUDE_BIN'] = previous;
  });

  it('spawns the operator-configured binary, not a hardcoded "claude"', async () => {
    process.env['CLAUDE_BIN'] = '/opt/homebrew/bin/claude-custom';
    await generateStarterKit(brief, [{ teamId: 'team-a', files: deliverable.files }]);

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(call.bin).toBe('/opt/homebrew/bin/claude-custom');
  });

  it('falls back to "claude" when CLAUDE_BIN is unset', async () => {
    delete process.env['CLAUDE_BIN'];
    await generateStarterKit(brief, [{ teamId: 'team-a', files: deliverable.files }]);

    expect(spawnCalls.length).toBeGreaterThan(0);
    for (const call of spawnCalls) expect(call.bin).toBe('claude');
  });
});
