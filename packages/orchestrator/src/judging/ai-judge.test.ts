import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';
import { buildJudgePrompt, aiJudge, classifyJudgeFailure, buildJudgeInvocation, readJudgeOutput, judgeIdFor, normalizeJudgeScores, quantizeScore, SCORE_RESOLUTION } from './ai-judge.js';
import { helperClaudeArgs, helperEnv, CODEX_HELPER_DISABLED_FEATURES, GEMINI_DENY_ALL_POLICY } from '../utils/claude-helper.js';
import { CLI_DEFAULT_MODEL } from '@arena/shared';
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

describe('aiJudge incomplete output', () => {
  const twoCriteria = {
    criteria: [
      { id: 'correctness', description: 'Correct', weight: 0.5, maxScore: 10 },
      { id: 'clarity', description: 'Clear', weight: 0.5, maxScore: 10 },
    ],
  };

  it('treats a response that omits a criterion as bad-output naming the missing id', async () => {
    const bin = fakeClaude(
      'claude-partial',
      '{"scores":[{"criterionId":"correctness","score":10,"commentary":"great"}]}',
    );
    const result = await aiJudge({ ...brief, rubric: twoCriteria }, deliverable, twoCriteria, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure?.kind).toBe('bad-output');
    expect(result.failure?.message).toContain('clarity');
    expect(result.failure?.message).not.toContain('correctness');
    // Never a silently half-scored 0.5.
    expect(result.overallScore).toBe(0);
  });

  it('accepts a response that covers every criterion', async () => {
    const bin = fakeClaude(
      'claude-complete',
      '{"scores":[{"criterionId":"correctness","score":10},{"criterionId":"clarity","score":8}]}',
    );
    const result = await aiJudge({ ...brief, rubric: twoCriteria }, deliverable, twoCriteria, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure).toBeUndefined();
    expect(result.overallScore).toBeCloseTo(0.9, 5);
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
    ['provider overloaded (503)', new Error('AI judge timed out after 240s'),
      'Attempt 1 failed with status 503. {"code":503,"message":"This model is currently experiencing high demand."}', 'rate-limit'],
    ['a hang whose log merely mentions an unknown model', new Error('AI judge timed out after 120s'),
      'warning: unknown setting for model routing', 'timeout'],
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

  it('points a rejected codex or gemini judge model at that provider\'s own override', () => {
    const failure = classifyJudgeFailure(
      new Error('AI judge exited with code 1'), 'unknown model: x', 'gemini', 'x', 'gemini',
    );
    expect(failure.message).toContain('ARENA_JUDGE_MODEL_GEMINI');
  });
});

// ── AA-046: provider-agnostic judging ────────────────────────────────────────
const SCRATCH = { workdir: '/scratch/work', policyPath: '/scratch/deny-all.toml' };

describe('buildJudgeInvocation — the three CLIs differ in ways that have bitten us', () => {
  it('claude takes the prompt on stdin and answers on stdout', () => {
    const inv = buildJudgeInvocation('claude', 'claude-opus-5', 'PROMPT', SCRATCH);
    expect(inv.promptVia).toBe('stdin');
    expect(inv.answerStream).toBe('stdout');
    expect(inv.args).toContain('--model');
    expect(inv.args).toContain('claude-opus-5');
    expect(inv.args).not.toContain('PROMPT'); // prompt must NOT be an argv entry
    expect(inv.args).toEqual(helperClaudeArgs({ model: 'claude-opus-5' }));
  });

  it('codex takes the prompt on argv, is read-only, and answers on stdout', () => {
    const inv = buildJudgeInvocation('codex', 'gpt-5.6-sol', 'PROMPT', SCRATCH);
    expect(inv.promptVia).toBe('argv');
    expect(inv.answerStream).toBe('stdout');
    expect(inv.args.at(-1)).toBe('PROMPT');
    expect(inv.args).toContain('-m');           // codex's model flag, from the registry
    expect(inv.args).toContain('gpt-5.6-sol');
    // A judge that can write can edit the thing it is grading.
    expect(inv.args.join(' ')).toContain('-s read-only');
    expect(inv.args).not.toContain('workspace-write');
  });

  it('codex runs tool-less: no user config (MCP, plugins), no shell, no web, in the scratch dir', () => {
    const args = buildJudgeInvocation('codex', CLI_DEFAULT_MODEL, 'PROMPT', SCRATCH).args;
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('--ephemeral');
    expect(args.join(' ')).toContain('-c web_search="disabled"');
    expect(args.join(' ')).toContain('-C /scratch/work');
    for (const f of CODEX_HELPER_DISABLED_FEATURES) expect(args.join(' ')).toContain(`--disable ${f}`);
    expect(CODEX_HELPER_DISABLED_FEATURES).toContain('shell_tool');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).not.toContain('-m'); // cli-default: no model flag
  });

  it('gemini runs tool-less under a deny-all admin policy, never --yolo or plan mode', () => {
    const inv = buildJudgeInvocation('gemini', 'gemini-3-flash', 'PROMPT', SCRATCH);
    expect(inv.promptVia).toBe('argv');
    expect(inv.answerFormat).toBe('gemini-json');
    expect(inv.args.join(' ')).toContain('--admin-policy /scratch/deny-all.toml');
    expect(inv.args.join(' ')).toContain('-o json');
    expect(inv.args).toContain('--allowed-mcp-server-names');
    expect(inv.args).toContain('--extensions');
    expect(inv.args).not.toContain('--yolo');
    expect(inv.args).not.toContain('plan');
    expect(inv.args).toContain('--model');
    expect(GEMINI_DENY_ALL_POLICY).toMatch(/toolName = "\*"\s*\ndecision = "deny"/);
  });

  it('uses each provider\'s own model flag from the registry', () => {
    expect(buildJudgeInvocation('codex', 'M', 'P', SCRATCH).args).toContain('-m');
    expect(buildJudgeInvocation('claude', 'M', 'P', SCRATCH).args).toContain('--model');
    expect(buildJudgeInvocation('gemini', 'M', 'P', SCRATCH).args).toContain('--model');
  });
});

describe('readJudgeOutput — record the model the CLI actually ran on', () => {
  const text = { answerStream: 'stdout', answerFormat: 'text' } as const;
  it('reads codex\'s model from its stderr banner', () => {
    const out = readJudgeOutput(text, 'codex', '{"scores":[]}', 'OpenAI Codex\nworkdir: /x\nmodel: gpt-5.6-sol\nprovider: openai\n');
    expect(out).toEqual({ answer: '{"scores":[]}', model: 'gpt-5.6-sol' });
  });
  it('unwraps gemini\'s -o json and names the model that did the work', () => {
    const wrapper = JSON.stringify({
      response: '```json\n{"scores":[]}\n```',
      stats: { models: {
        'gemini-router-lite': { tokens: { total: 40 } },
        'gemini-3-pro': { tokens: { total: 9000 } },
      } },
    });
    const out = readJudgeOutput({ answerStream: 'stdout', answerFormat: 'gemini-json' }, 'gemini', wrapper, '');
    expect(out.answer).toContain('"scores"');
    expect(out.model).toBe('gemini-3-pro');
  });
  it('falls back to the raw text and no model when the CLI does not say', () => {
    expect(readJudgeOutput(text, 'claude', 'X', 'model: nope')).toEqual({ answer: 'X' });
    expect(readJudgeOutput({ answerStream: 'stdout', answerFormat: 'gemini-json' }, 'gemini', 'not json', ''))
      .toEqual({ answer: 'not json' });
  });
});

describe('helperEnv for codex and gemini judges', () => {
  it('drops injecting and operator-handle variables inside the vendor namespace, keeps auth', () => {
    const src = {
      PATH: '/bin', HOME: '/h', GEMINI_API_KEY: 'g', GEMINI_CLI_HOME: '/gh',
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: '/evil.json', GEMINI_CLI_IDE_SERVER_PORT: '1234',
      OPENAI_API_KEY: 'o', CODEX_HOME: '/ch', DATABASE_URL: 'pg://x', ARENA_API_KEY: 'k',
    };
    const gemini = helperEnv('gemini', src);
    expect(gemini).toMatchObject({ GEMINI_API_KEY: 'g', GEMINI_CLI_HOME: '/gh', PATH: '/bin' });
    expect(gemini['GEMINI_CLI_SYSTEM_SETTINGS_PATH']).toBeUndefined();
    expect(gemini['GEMINI_CLI_IDE_SERVER_PORT']).toBeUndefined();
    expect(gemini['OPENAI_API_KEY']).toBeUndefined();
    const codex = helperEnv('codex', src);
    expect(codex).toMatchObject({ OPENAI_API_KEY: 'o', CODEX_HOME: '/ch' });
    for (const env of [gemini, codex]) {
      expect(env['DATABASE_URL']).toBeUndefined();
      expect(env['ARENA_API_KEY']).toBeUndefined();
    }
  });
});

describe('aiJudge runs the judge in an empty scratch directory', () => {
  it('spawns with a fresh empty cwd outside the checkout, and removes it after', async () => {
    const bin = join(scratch, 'claude-cwd');
    const cwdLog = join(scratch, 'claude-cwd.pwd');
    writeFileSync(bin, `#!/bin/sh\npwd > ${cwdLog}\nls -A >> ${cwdLog}\ncat > /dev/null\necho '{"scores":[{"criterionId":"correctness","score":5}]}'\n`);
    chmodSync(bin, 0o755);
    const result = await aiJudge(brief, deliverable, rubric, { judgeId: 'ai-claude', claudeBin: bin });
    expect(result.failure).toBeUndefined();
    const [cwd, ...listing] = readFileSync(cwdLog, 'utf8').trim().split('\n');
    expect(cwd).toContain('arena-judge-');
    expect(cwd).not.toBe(process.cwd());
    expect(listing).toEqual([]);
    expect(existsSync(cwd!)).toBe(false);
  });

  it('reads a gemini judge\'s answer and model out of its JSON wrapper', async () => {
    const wrapper = JSON.stringify({
      response: '{"scores":[{"criterionId":"correctness","score":6.5,"commentary":"ok"}]}',
      stats: { models: { 'gemini-3-pro': { tokens: { total: 10 } } } },
    });
    const bin = fakeClaude('gemini-json', wrapper);
    const result = await aiJudge(brief, deliverable, rubric, {
      judgeId: 'ai-gemini', provider: 'gemini', claudeBin: bin, model: CLI_DEFAULT_MODEL,
    });
    expect(result.failure).toBeUndefined();
    expect(result.scores[0]!.score).toBe(6.5);
    expect(result.model).toBe('gemini-3-pro');
    const argv = recordedArgv('gemini-json');
    const policy = argv[argv.indexOf('--admin-policy') + 1]!;
    expect(policy).toContain('arena-judge-');
    expect(existsSync(policy)).toBe(false); // cleaned up with the scratch dir
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
