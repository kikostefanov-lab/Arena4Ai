import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';
import { buildJudgePrompt, aiJudge, classifyJudgeFailure } from './ai-judge.js';
import { DEFAULT_JUDGE_MODEL, DEFAULT_ADVERSARIAL_JUDGE_MODEL } from '../adapters/model-registry.js';

describe('buildJudgePrompt', () => {
  const rubric = {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  };
  const brief: Brief = {
    id: 'test-brief',
    title: 'Test Brief',
    problem: 'Solve the test problem',
    constraints: ['Must be fast', 'No external deps'],
    deliverables: ['solution.py'],
    rubric,
    format: CompetitionFormat.SPRINT,
    timeLimitMs: 60000,
  };
  const deliverable = {
    teamId: 'team-a',
    files: [{ path: 'solution.py', content: 'print("hello")' }],
    collectedAt: new Date().toISOString(),
  };

  it('includes adversarial instructions when judgeId contains "adversarial"', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-adversarial');
    expect(prompt).toContain('weaknesses');
  });

  it('uses standard instructions for default judge', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).not.toContain('weaknesses');
  });

  it('includes brief context (title, problem, constraints)', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).toContain('Test Brief');
    expect(prompt).toContain('Solve the test problem');
    expect(prompt).toContain('Must be fast');
    expect(prompt).toContain('No external deps');
  });

  it('includes deliverable file content', () => {
    const prompt = buildJudgePrompt(brief, deliverable, rubric, 'ai-claude');
    expect(prompt).toContain('solution.py');
    expect(prompt).toContain('print("hello")');
  });
});

// ── AA-016: the judge must say WHY it failed ─────────────────────────────────

const rubric = {
  criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
};
const brief: Brief = {
  id: 'test-brief',
  title: 'Test Brief',
  problem: 'Solve the test problem',
  constraints: [],
  deliverables: ['solution.py'],
  rubric,
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 60000,
};
const deliverable = {
  teamId: 'team-a',
  files: [{ path: 'solution.py', content: 'print("hello")' }],
  collectedAt: new Date().toISOString(),
};

const scratch = mkdtempSync(join(tmpdir(), 'arena-judge-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Write a stand-in `claude` CLI that records argv and prints `body` on stdout. */
function fakeClaude(name: string, body: string, exitCode = 0): string {
  const bin = join(scratch, name);
  const argvLog = join(scratch, `${name}.argv`);
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > ${argvLog}\ncat > /dev/null\ncat <<'ARENA_EOF'\n${body}\nARENA_EOF\nexit ${exitCode}\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}
function recordedArgv(name: string): string[] {
  const p = join(scratch, `${name}.argv`);
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n') : [];
}

describe('aiJudge failure reporting', () => {
  it('reports a MISSING CLI by name instead of silently scoring zero', async () => {
    const result = await aiJudge(brief, deliverable, rubric, {
      judgeId: 'ai-claude',
      claudeBin: 'arena-definitely-not-a-real-binary',
    });

    expect(result.failure).toBeDefined();
    expect(result.failure!.kind).toBe('cli-missing');
    expect(result.failure!.message).toContain('arena-definitely-not-a-real-binary');
    // The zero scores are still there as a safety net...
    expect(result.scores.every(s => s.score === 0)).toBe(true);
    // ...but the commentary now says why, rather than "fallback to zero".
    expect(result.scores[0]!.commentary).toContain('not found on PATH');
  });

  it('reports unparseable CLI output as bad-output, not as a real score', async () => {
    const bin = fakeClaude('claude-garbage', 'I am terribly sorry, I cannot do that.');
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure?.kind).toBe('bad-output');
  });

  it('does NOT set failure when the CLI returns real scores', async () => {
    const bin = fakeClaude(
      'claude-ok',
      '{"scores":[{"criterionId":"correctness","score":7,"commentary":"solid"}]}',
    );
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure).toBeUndefined();
    expect(result.scores[0]!.score).toBe(7);
  });

  it('treats an empty scores array as a failure, not a zero-scored match', async () => {
    const bin = fakeClaude('claude-empty', '{"scores":[]}');
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure).toBeDefined();
  });
});

describe('aiJudge model pinning (AA-014)', () => {
  it('passes --model with the pinned judge model', async () => {
    const bin = fakeClaude(
      'claude-pin',
      '{"scores":[{"criterionId":"correctness","score":5,"commentary":"ok"}]}',
    );
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-claude', claudeBin: bin });
    const argv = recordedArgv('claude-pin');
    expect(argv).toContain('--model');
    expect(argv[argv.indexOf('--model') + 1]).toBe(DEFAULT_JUDGE_MODEL);
    expect(result.model).toBe(DEFAULT_JUDGE_MODEL);
  });

  it('runs the adversarial judge on a different model than the standard judge', async () => {
    const bin = fakeClaude(
      'claude-adv',
      '{"scores":[{"criterionId":"correctness","score":5,"commentary":"ok"}]}',
    );
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-adversarial', claudeBin: bin });
    expect(result.model).toBe(DEFAULT_ADVERSARIAL_JUDGE_MODEL);
    expect(result.model).not.toBe(DEFAULT_JUDGE_MODEL);
    expect(recordedArgv('claude-adv')).toContain(DEFAULT_ADVERSARIAL_JUDGE_MODEL);
  });

  it('honours an explicit model override', async () => {
    const bin = fakeClaude(
      'claude-override',
      '{"scores":[{"criterionId":"correctness","score":5,"commentary":"ok"}]}',
    );
    const result = await aiJudge(brief, deliverable, rubric, {
      judgeId: 'ai-claude',
      claudeBin: bin,
      model: 'claude-haiku-4-5',
    });
    expect(result.model).toBe('claude-haiku-4-5');
    expect(recordedArgv('claude-override')).toContain('claude-haiku-4-5');
  });
});

describe('classifyJudgeFailure', () => {
  const cases: [string, unknown, string, string][] = [
    ['missing binary', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }), '', 'cli-missing'],
    ['expired auth', new Error('AI judge exited with code 1'), 'Invalid API key · Please run /login', 'auth'],
    ['rate limit', new Error('AI judge exited with code 1'), 'Error: 429 rate limit exceeded', 'rate-limit'],
    ['retired model', new Error('AI judge exited with code 1'), 'model claude-sonnet-3-5 not found', 'model-unavailable'],
    ['timeout', new Error('AI judge timed out'), '', 'timeout'],
    ['generic non-zero exit', new Error('AI judge exited with code 2'), 'boom', 'cli-error'],
    ['unparseable output', new SyntaxError('Unexpected token I in JSON'), '', 'bad-output'],
  ];

  for (const [label, err, stderr, expected] of cases) {
    it(`classifies ${label} as ${expected}`, () => {
      const failure = classifyJudgeFailure(err, stderr, 'claude', 'claude-opus-5');
      expect(failure.kind).toBe(expected);
      expect(failure.message).toBeTruthy();
    });
  }

  it('names the retired model id in the model-unavailable message', () => {
    const failure = classifyJudgeFailure(
      new Error('AI judge exited with code 1'),
      'unknown model: o4-mini',
      'claude',
      'o4-mini',
    );
    expect(failure.kind).toBe('model-unavailable');
    expect(failure.message).toContain('o4-mini');
  });
});
