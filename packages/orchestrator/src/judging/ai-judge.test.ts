import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';
import { buildJudgePrompt, aiJudge, classifyJudgeFailure, buildJudgeInvocation, judgeIdFor, normalizeJudgeScores, quantizeScore, SCORE_RESOLUTION } from './ai-judge.js';
import { resolveJudgeModel as resolveJudgeModelFn, requireDefaultModel as requireDefaultModelFn } from '../adapters/model-registry.js';
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

// ── AA-046: provider-agnostic judging ────────────────────────────────────────
describe('buildJudgeInvocation — the three CLIs differ in ways that have bitten us', () => {
  it('claude takes the prompt on stdin and answers on stdout', () => {
    const inv = buildJudgeInvocation('claude', 'claude-opus-5', 'PROMPT');
    expect(inv.promptVia).toBe('stdin');
    expect(inv.answerStream).toBe('stdout');
    expect(inv.args).toContain('--model');
    expect(inv.args).toContain('claude-opus-5');
    expect(inv.args).not.toContain('PROMPT'); // prompt must NOT be an argv entry
  });

  it('codex takes the prompt on argv, is read-only, and answers on stdout', () => {
    const inv = buildJudgeInvocation('codex', 'gpt-5.6-sol', 'PROMPT');
    expect(inv.promptVia).toBe('argv');
    expect(inv.answerStream).toBe('stdout');
    expect(inv.args).toContain('PROMPT');
    expect(inv.args).toContain('-m');           // codex's model flag, from the registry
    expect(inv.args).toContain('gpt-5.6-sol');
    // A judge that can write can edit the thing it is grading.
    expect(inv.args.join(' ')).toContain('-s read-only');
    expect(inv.args).not.toContain('workspace-write');
  });

  it('gemini uses its read-only plan mode rather than --yolo', () => {
    const inv = buildJudgeInvocation('gemini', 'gemini-3-flash', 'PROMPT');
    expect(inv.promptVia).toBe('argv');
    expect(inv.args).toContain('--approval-mode');
    expect(inv.args).toContain('plan');
    expect(inv.args).not.toContain('--yolo');
    expect(inv.args).toContain('--model');
  });

  it('uses each provider\'s own model flag from the registry', () => {
    expect(buildJudgeInvocation('codex', 'M', 'P').args).toContain('-m');
    expect(buildJudgeInvocation('claude', 'M', 'P').args).toContain('--model');
    expect(buildJudgeInvocation('gemini', 'M', 'P').args).toContain('--model');
  });
});

describe('judgeIdFor — a scorecard must name the judge that produced it', () => {
  it('records provider AND model', () => {
    expect(judgeIdFor('codex', 'gpt-5.6-sol')).toBe('ai-codex/gpt-5.6-sol');
    expect(judgeIdFor('claude', 'claude-opus-5')).toBe('ai-claude/claude-opus-5');
  });
  it('marks an adversarial judge, and stays detectable by the adversarial check', () => {
    const id = judgeIdFor('gemini', 'gemini-3-pro', true);
    expect(id).toBe('ai-gemini/gemini-3-pro+adversarial');
    expect(id.includes('adversarial')).toBe(true); // buildJudgePrompt keys off this
  });
});

describe('resolveJudgeModel is provider-aware', () => {
  it('pins a codex judge to a codex model, not a claude one', () => {
    const m = resolveJudgeModelFn('ai-codex', 'codex');
    expect(m).not.toMatch(/^claude/);
    expect(m).toBe(requireDefaultModelFn('codex'));
  });
  it('leaves the claude default unchanged for existing callers', () => {
    expect(resolveJudgeModelFn('ai-claude')).toBe(resolveJudgeModelFn('ai-claude', 'claude'));
  });
});

describe('quantizeScore — the grid must not corrupt what the judge already stated (AA-063)', () => {
  it('leaves a value that is already on the grid exactly alone', () => {
    // The naive spelling `Math.round(s / 0.1) * 0.1` returns 8.200000000000001
    // here: 0.1 is not representable in binary64, so a function whose only job
    // is numeric fidelity was corrupting clean input.
    expect(quantizeScore(8.2)).toBe(8.2);
    expect(quantizeScore(7.8)).toBe(7.8);
    expect(quantizeScore(9)).toBe(9);
  });

  it('rounds a half-step UP rather than down', () => {
    // 6.35 / 0.1 is 63.49999999999999, so divide-then-multiply yields 6.3.
    expect(quantizeScore(6.35)).toBe(6.4);
    expect(quantizeScore(8.15)).toBe(8.2);
    expect(quantizeScore(7.25)).toBe(7.3);
  });

  it('never returns a value off the one-decimal grid', () => {
    for (let raw = 0; raw <= 10.0001; raw += 0.017) {
      const q = quantizeScore(raw);
      expect(Math.abs(q * 10 - Math.round(q * 10))).toBeLessThan(1e-9);
    }
  });

  it('keeps the declared resolution as the single source of truth', () => {
    expect(SCORE_RESOLUTION).toBe(0.1);
  });
});

describe('normalizeJudgeScores — what the judge emits is untrusted input (AA-063)', () => {
  const rubric = {
    criteria: [
      { id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 },
      { id: 'clarity', description: 'Clear', weight: 1, maxScore: 5 },
    ],
  };

  it('preserves one decimal place end to end', () => {
    // The whole point of AA-063: a decimal the judge reports must survive into
    // the stored scorecard. A prompt asking for 7.3 is worthless if the parse
    // layer rounds it to 7.
    const out = normalizeJudgeScores(
      [{ criterionId: 'correctness', score: 7.3, commentary: 'ok' }],
      rubric,
    );
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(7.3);
  });

  it('accepts a quoted number, because models sometimes emit one', () => {
    const out = normalizeJudgeScores([{ criterionId: 'correctness', score: '8.6' }], rubric);
    expect(out[0].score).toBe(8.6);
  });

  it('drops NaN rather than letting it become a silent zero', () => {
    const out = normalizeJudgeScores(
      [
        { criterionId: 'correctness', score: 'not a number' },
        { criterionId: 'clarity', score: Number.NaN },
      ],
      rubric,
    );
    expect(out).toHaveLength(0);
  });

  it('drops a criterionId that is not in the rubric', () => {
    const out = normalizeJudgeScores(
      [
        { criterionId: 'invented-criterion', score: 9 },
        { criterionId: 'clarity', score: 4.2 },
      ],
      rubric,
    );
    expect(out).toHaveLength(1);
    expect(out[0].criterionId).toBe('clarity');
  });

  it('keeps only the first entry when a criterion is scored twice', () => {
    const out = normalizeJudgeScores(
      [
        { criterionId: 'clarity', score: 4.2 },
        { criterionId: 'clarity', score: 1.1 },
      ],
      rubric,
    );
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(4.2);
  });

  it("clamps to the criterion's OWN maxScore, not a global 10", () => {
    const out = normalizeJudgeScores(
      [
        { criterionId: 'clarity', score: 9.7 },
        { criterionId: 'correctness', score: -3 },
      ],
      rubric,
    );
    const byId = Object.fromEntries(out.map((s) => [s.criterionId, s.score]));
    expect(byId.clarity).toBe(5);
    expect(byId.correctness).toBe(0);
  });

  it('returns empty for a non-array, so the caller reports a judge FAILURE', () => {
    // An empty result is what makes aiJudge report a failure instead of
    // recording a legitimate-looking all-zero scorecard.
    expect(normalizeJudgeScores(null, rubric)).toEqual([]);
    expect(normalizeJudgeScores({ scores: [] }, rubric)).toEqual([]);
    expect(normalizeJudgeScores('[]', rubric)).toEqual([]);
  });

  it('defaults commentary to a string when the judge omits it', () => {
    const out = normalizeJudgeScores([{ criterionId: 'clarity', score: 3.3 }], rubric);
    expect(out[0].commentary).toBe('');
  });
});
