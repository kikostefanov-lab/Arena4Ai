import { spawn } from 'node:child_process';
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { computeOverallScore } from './score-aggregator.js';
import { extractJson } from '../utils/extract-json.js';
import { buildBriefContext, truncateFiles, JUDGE_CONTEXT } from '../utils/brief-context.js';
import { resolveJudgeModel, getProviderConfig } from '../adapters/model-registry.js';

export const JUDGE_IDS = {
  automated: 'automated',
  aiClaude: 'ai-claude',
  aiAdversarial: 'ai-adversarial',
} as const;

/** Providers that can host a judge. Same set the competitors run under. */
export type JudgeProvider = 'claude' | 'codex' | 'gemini';

/**
 * Canonical, self-describing judge id.
 *
 * A scorecard that just says "ai-claude" cannot answer "which model produced
 * this number?", which is exactly the gap that let one vendor's model quietly
 * mark its own homework. Provider AND model, always.
 */
export function judgeIdFor(provider: JudgeProvider, model: string, adversarial = false): string {
  return `ai-${provider}/${model}${adversarial ? '+adversarial' : ''}`;
}

export interface AiJudgeOptions {
  /** Model identifier to label this judge, e.g. 'ai-claude'. */
  judgeId: string;
  /** Which CLI hosts the judge. Defaults to 'claude' — existing callers unchanged. */
  provider?: JudgeProvider;
  /** Path to the judge CLI binary. Defaults to the provider's registry `bin`. */
  claudeBin?: string;
  /**
   * Model to pin the judge to. Defaults to the registry judge model.
   * Pinned so scores stay comparable across time — an unpinned judge silently
   * changes model whenever the CLI's default moves.
   */
  model?: string;
  /**
   * Hard kill after this many ms. Default 120s, which is tuned for a normal
   * competition. A re-judge over a large stored deliverable set legitimately
   * needs longer, and a timeout there means paying for the run twice.
   */
  timeoutMs?: number;
}

/** Why the AI judge could not score. Distinguishes "broken setup" from "bad output". */
export type AiJudgeFailureKind =
  | 'cli-missing'
  | 'auth'
  | 'rate-limit'
  | 'model-unavailable'
  | 'timeout'
  | 'cli-error'
  | 'bad-output';

export interface AiJudgeFailure {
  kind: AiJudgeFailureKind;
  /** Actionable one-liner safe to show a user. */
  message: string;
  /** Raw stderr / parse error, for logs. */
  detail?: string;
}

/**
 * A JudgeResult plus an explicit failure marker.
 *
 * Structurally assignable to JudgeResult, so callers that don't care are
 * unaffected — but callers that DO care no longer have to infer failure by
 * string-matching commentary.
 */
export interface AiJudgeResult extends JudgeResult {
  /** Present iff the judge failed and `scores` are the zero fallback. */
  failure?: AiJudgeFailure;
  /** Model the judge was pinned to for this run. */
  model?: string;
  /** Provider whose CLI produced this score. */
  provider?: JudgeProvider;
}

const CLI_HINT = 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in';

/**
 * How one provider's CLI is driven in judge mode.
 *
 * Three things genuinely differ between the CLIs and all three have bitten us:
 *  - how the prompt is delivered (claude reads stdin; codex and gemini take argv);
 *  - which stream carries the final answer (verified against codex-cli 0.144.1 —
 *    its *progress log* goes to stderr but the final message goes to stdout);
 *  - whether stdin must be closed (codex `exec` otherwise blocks forever on
 *    "Reading additional input from stdin...", which looks exactly like a hang).
 *
 * Judges are read-only by construction: a judge that can write to the workspace
 * is a judge that can edit the thing it is grading.
 */
interface JudgeInvocation {
  args: string[];
  promptVia: 'stdin' | 'argv';
  answerStream: 'stdout' | 'stderr';
}

export function buildJudgeInvocation(
  provider: JudgeProvider,
  model: string,
  prompt: string,
): JudgeInvocation {
  const modelFlag = getProviderConfig(provider)?.modelFlag ?? '--model';
  switch (provider) {
    case 'codex':
      // -s read-only: the judge may not modify the workspace it is scoring.
      return {
        args: ['exec', '--skip-git-repo-check', '-s', 'read-only', modelFlag, model, prompt],
        promptVia: 'argv',
        answerStream: 'stdout',
      };
    case 'gemini':
      // --approval-mode plan is gemini's read-only mode; --yolo would grant a
      // judge tool access it has no need for.
      return {
        args: ['-p', prompt, modelFlag, model, '--approval-mode', 'plan'],
        promptVia: 'argv',
        answerStream: 'stdout',
      };
    case 'claude':
    default:
      return {
        args: ['--print', '-', '--output-format', 'text', modelFlag, model, '--dangerously-skip-permissions'],
        promptVia: 'stdin',
        answerStream: 'stdout',
      };
  }
}

/**
 * Turn a spawn/exit failure into an actionable message.
 * A missing binary, an expired login, a rate limit and a retired model id all
 * used to produce the same silent all-zero scorecard.
 */
export function classifyJudgeFailure(
  err: unknown,
  stderr: string,
  claudeBin: string,
  model: string,
  provider: JudgeProvider = 'claude',
): AiJudgeFailure {
  const detail = (stderr || '').trim() || (err instanceof Error ? err.message : String(err));
  const hint = getProviderConfig(provider)?.installHint ?? CLI_HINT;
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const haystack = `${detail}`.toLowerCase();

  if (code === 'ENOENT' || code === 'EACCES' || /command not found|no such file or directory/.test(haystack)) {
    return {
      kind: 'cli-missing',
      message: `AI judge unavailable: the "${claudeBin}" CLI was not found on PATH. ${hint}.`,
      detail,
    };
  }
  if (/not logged in|log ?in|unauthor|authentication|invalid api key|401|403|credential/.test(haystack)) {
    return {
      kind: 'auth',
      message: `AI judge unavailable: "${claudeBin}" is installed but not authenticated. Run \`${claudeBin}\` once to sign in, or set ANTHROPIC_API_KEY.`,
      detail,
    };
  }
  if (/rate limit|429|quota|overloaded|too many requests/.test(haystack)) {
    return {
      kind: 'rate-limit',
      message: `AI judge unavailable: rate limited by the ${provider} API. Re-judge this competition once the limit resets.`,
      detail,
    };
  }
  if (/model/.test(haystack) && /(not found|unknown|invalid|unsupported|deprecat|retire|404)/.test(haystack)) {
    return {
      kind: 'model-unavailable',
      message: `AI judge unavailable: model "${model}" was rejected by the CLI. Update DEFAULT_JUDGE_MODEL in model-registry.ts or set ARENA_JUDGE_MODEL.`,
      detail,
    };
  }
  if (err instanceof Error && /timed out/i.test(err.message)) {
    return { kind: 'timeout', message: 'AI judge unavailable: timed out after 120s.', detail };
  }
  if (err instanceof Error && /exited with code/i.test(err.message)) {
    return { kind: 'cli-error', message: `AI judge unavailable: ${err.message}.`, detail };
  }
  return {
    kind: 'bad-output',
    message: 'AI judge unavailable: the CLI returned output that could not be parsed as scores.',
    detail,
  };
}

/**
 * The resolution the judge prompt asks for: one decimal place on the criterion's
 * own scale. Scores are quantised to this grid — never to whole numbers.
 *
 * AA-063: the prompt used to say only `<number 0–maxScore>`, so claude-opus-5
 * volunteered whole numbers (4 distinct values across 18 cells) and a 0.865 vs
 * 0.855 launch margin turned out to be rounding rather than judgement. Asking
 * for a decimal is only half the fix — the parse layer has to keep it.
 */
export const SCORE_RESOLUTION = 0.1;

/**
 * Snap to the one-decimal grid without ever collapsing to an integer.
 *
 * Divide-then-multiply (`Math.round(s / 0.1) * 0.1`) is the obvious spelling and
 * it is wrong twice over, because 0.1 is not representable in binary64:
 *   - it CORRUPTS clean input — 8.2 comes back as 8.200000000000001, so a score
 *     the judge stated exactly is stored wrong by a function whose only job is
 *     numeric fidelity;
 *   - it ROUNDS THE WRONG WAY at the boundary — 6.35 / 0.1 is 63.49999999999999,
 *     so it yields 6.3 where 6.4 is correct.
 * Scaling by the integer inverse keeps every intermediate exact.
 */
const SCORE_STEPS = Math.round(1 / SCORE_RESOLUTION);

export function quantizeScore(score: number): number {
  return Math.round(score * SCORE_STEPS) / SCORE_STEPS;
}

/**
 * Turn whatever the judge CLI emitted into criterion scores we are willing to
 * store.
 *
 * The old code cast the parsed JSON straight to `CriterionScore[]` and clamped
 * it, which meant a string `"8.5"`, a `null`, a NaN or an id that matches no
 * criterion all travelled onward untyped. Every entry now has to name a real
 * rubric criterion and carry a finite number; anything else is dropped, and an
 * empty result is reported to the caller as a judge failure rather than as a
 * zero-scored match.
 *
 * Resolution is preserved: scores are quantised to {@link SCORE_RESOLUTION}
 * (one decimal), then clamped to the criterion's own [0, maxScore].
 */
export function normalizeJudgeScores(raw: unknown, rubric: Rubric): CriterionScore[] {
  if (!Array.isArray(raw)) return [];
  const out: CriterionScore[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;

    const criterionId = typeof e.criterionId === 'string' ? e.criterionId.trim() : '';
    if (!criterionId || seen.has(criterionId)) continue;
    const criterion = rubric.criteria.find((c) => c.id === criterionId);
    if (!criterion) continue;

    // Models occasionally quote the number ("8.5"). Accept it, but only if it
    // really is a number — never let NaN through as a silent zero.
    const rawScore = typeof e.score === 'string' ? Number(e.score.trim()) : e.score;
    if (typeof rawScore !== 'number' || !Number.isFinite(rawScore)) continue;

    const max = criterion.maxScore ?? 10;
    const score = Math.max(0, Math.min(max, quantizeScore(rawScore)));

    seen.add(criterionId);
    out.push({
      criterionId,
      score,
      commentary: typeof e.commentary === 'string' ? e.commentary : '',
    });
  }

  return out;
}

/**
 * Build the judge prompt for a deliverable and rubric.
 * When judgeId includes 'adversarial', critical evaluation instructions are added.
 */
export function buildJudgePrompt(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  judgeId: string,
): string {
  const briefContext = buildBriefContext(brief, JUDGE_CONTEXT);

  const perFile = JUDGE_CONTEXT.fileTruncation ?? 12000;
  const totalBudget = JUDGE_CONTEXT.fileBudget ?? 80000;
  const filesText = truncateFiles(deliverable.files, perFile, totalBudget);

  const adversarialClause = judgeId.includes('adversarial')
    ? '\n\nIMPORTANT: You are an adversarial judge. Look for weaknesses, gaps, and missed edge cases. Score critically — be specific about what is missing or wrong.'
    : '';

  return `You are an impartial competition judge. Evaluate the following deliverable against the problem statement and rubric criteria.${adversarialClause}

# Competition Brief
${briefContext}

## Deliverable Files
${filesText || '(no files submitted)'}

## Scoring Instructions
For each rubric criterion, evaluate whether the deliverable:
1. Addresses the stated problem and its requirements
2. Honors the constraints listed above
3. Produced the expected deliverable files
4. Demonstrates quality and completeness relative to the criterion

## Score Resolution — REQUIRED
Report every score to EXACTLY ONE DECIMAL PLACE (e.g. 7.3, 8.6, 9.1). This is not
cosmetic. Two strong entries must stay distinguishable: whole numbers collapse a
10-point scale into a handful of buckets, and a competition then gets decided by
rounding rather than by judgement.
- Do NOT default to whole numbers. A score ending in .0 must be a deliberate,
  exact verdict, not a rounded one — treat it as rare.
- Do NOT reuse the same value for two criteria unless the deliverable really is
  equally strong on both; prefer 7.8 vs 8.2 over 8 vs 8.
- Use the whole range. Reserve 9.0+ for work with no material weakness, and go
  below 5.0 when the criterion is genuinely unmet.
- The tenths digit carries the fine judgement: use it to record that one entry
  is slightly ahead of another on the same criterion.

Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore, one decimal place>, "commentary": "<2–3 sentences referencing specific deliverable content>" }
  ]
}`;
}

/**
 * Ask a Claude model to evaluate a deliverable against a rubric.
 *
 * Builds a structured prompt, calls the claude CLI asynchronously,
 * and parses the JSON response back into a JudgeResult.
 *
 * On failure it returns zero scores AND an explicit `failure` field naming the
 * cause (missing binary, expired auth, rate limit, retired model id, unparseable
 * output). Callers must branch on `failure`, not on the score values — the
 * automated scorer is the safety net, but the reason must never be silent.
 */
export async function aiJudge(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  options: AiJudgeOptions,
): Promise<AiJudgeResult> {
  const { judgeId } = options;
  const provider: JudgeProvider = options.provider ?? 'claude';
  const claudeBin = options.claudeBin ?? getProviderConfig(provider)?.bin ?? provider;
  const model = options.model ?? resolveJudgeModel(judgeId, provider);

  const prompt = buildJudgePrompt(brief, deliverable, rubric, judgeId);
  const invocation = buildJudgeInvocation(provider, model, prompt);

  let failure: AiJudgeFailure | undefined;
  let scores: CriterionScore[] = rubric.criteria.map((c) => ({
    criterionId: c.id,
    score: 0,
    commentary: 'AI judge unavailable — fallback to zero.',
  }));

  let stderr = '';
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      // stdin is 'ignore' unless the prompt travels that way. codex `exec`
      // blocks forever on an open, silent stdin — indistinguishable from a hang.
      const child = spawn(
        claudeBin,
        invocation.args,
        {
          env: claudeEnv(),
          stdio: [invocation.promptVia === 'stdin' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        },
      );

      // Kill on a deadline to avoid hanging the judging phase.
      const timeoutMs = options.timeoutMs ?? 120_000;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`AI judge timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const settle = (fn: () => void) => { clearTimeout(timer); fn(); };

      if (invocation.promptVia === 'stdin' && child.stdin) {
        child.stdin.on('error', () => {/* EPIPE when the CLI is missing — surfaced by 'error' */});
        child.stdin.write(prompt);
        child.stdin.end();
      }

      // Capture both streams, then hand the caller whichever one this provider
      // puts its final answer on.
      let out = '';
      child.stdout?.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('close', (code) => settle(() => {
        const answer = invocation.answerStream === 'stderr' ? stderr : out;
        if (code === 0) resolve(answer);
        else reject(new Error(`AI judge exited with code ${code}`));
      }));
      child.on('error', (err) => settle(() => reject(err)));
    });

    const parsed = JSON.parse(extractJson(stdout)) as { scores?: unknown };
    const normalized = normalizeJudgeScores(parsed.scores, rubric);
    if (normalized.length > 0) {
      scores = normalized;
    } else {
      failure = classifyJudgeFailure(new Error('judge returned no scores'), '', claudeBin, model, provider);
    }
  } catch (err) {
    failure = classifyJudgeFailure(err, stderr, claudeBin, model, provider);
  }

  if (failure) {
    // Loud on purpose: this used to be a bare `catch {}`, which is why four
    // months of model-id drift never announced itself.
    console.error(`[arena] ${judgeId} (${provider}/${model}) failed for ${deliverable.teamId}: ${failure.message}`);
    if (failure.detail) console.error(`[arena]   detail: ${failure.detail.slice(0, 500)}`);
    scores = scores.map((s) => ({ ...s, commentary: failure!.message }));
  }

  // Quantising + clamping already happened in normalizeJudgeScores(); the only
  // other path to `scores` is the zeroed fallback, which needs neither.

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: computeOverallScore(scores, rubric),
    model,
    provider,
    ...(failure ? { failure } : {}),
  };
}
