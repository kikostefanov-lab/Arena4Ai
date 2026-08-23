import { spawn } from 'node:child_process';
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';
import { computeOverallScore } from './score-aggregator.js';
import { extractJson } from '../utils/extract-json.js';
import { buildBriefContext, truncateFiles, JUDGE_CONTEXT } from '../utils/brief-context.js';
import { resolveJudgeModel } from '../adapters/model-registry.js';

export const JUDGE_IDS = {
  automated: 'automated',
  aiClaude: 'ai-claude',
  aiAdversarial: 'ai-adversarial',
} as const;

export interface AiJudgeOptions {
  /** Model identifier to label this judge, e.g. 'ai-claude'. */
  judgeId: string;
  /** Path to the claude CLI binary. Defaults to 'claude'. */
  claudeBin?: string;
  /**
   * Model to pin the judge to. Defaults to the registry judge model.
   * Pinned so scores stay comparable across time — an unpinned judge silently
   * changes model whenever the CLI's default moves.
   */
  model?: string;
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
}

const CLI_HINT = 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in';

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
): AiJudgeFailure {
  const detail = (stderr || '').trim() || (err instanceof Error ? err.message : String(err));
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  const haystack = `${detail}`.toLowerCase();

  if (code === 'ENOENT' || code === 'EACCES' || /command not found|no such file or directory/.test(haystack)) {
    return {
      kind: 'cli-missing',
      message: `AI judge unavailable: the "${claudeBin}" CLI was not found on PATH. ${CLI_HINT}.`,
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
      message: 'AI judge unavailable: rate limited by the Claude API. Re-judge this competition once the limit resets.',
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

Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore>, "commentary": "<2–3 sentences referencing specific deliverable content>" }
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
  const { judgeId, claudeBin = 'claude' } = options;
  const model = options.model ?? resolveJudgeModel(judgeId);

  const prompt = buildJudgePrompt(brief, deliverable, rubric, judgeId);

  let failure: AiJudgeFailure | undefined;
  let scores: CriterionScore[] = rubric.criteria.map((c) => ({
    criterionId: c.id,
    score: 0,
    commentary: 'AI judge unavailable — fallback to zero.',
  }));

  let stderr = '';
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', '-', '--output-format', 'text', '--model', model, '--dangerously-skip-permissions'],
        { env: claudeEnv(), stdio: ['pipe', 'pipe', 'pipe'] },
      );

      // Kill after 120s to avoid hanging the judging phase
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('AI judge timed out'));
      }, 120_000);
      const settle = (fn: () => void) => { clearTimeout(timer); fn(); };

      child.stdin.on('error', () => {/* EPIPE when the CLI is missing — surfaced by 'error' */});
      child.stdin.write(prompt);
      child.stdin.end();

      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('close', (code) => settle(() => {
        if (code === 0) resolve(out);
        else reject(new Error(`AI judge exited with code ${code}`));
      }));
      child.on('error', (err) => settle(() => reject(err)));
    });

    const parsed = JSON.parse(extractJson(stdout)) as { scores: CriterionScore[] };
    if (Array.isArray(parsed.scores) && parsed.scores.length > 0) {
      scores = parsed.scores;
    } else {
      failure = classifyJudgeFailure(new Error('judge returned no scores'), '', claudeBin, model);
    }
  } catch (err) {
    failure = classifyJudgeFailure(err, stderr, claudeBin, model);
  }

  if (failure) {
    // Loud on purpose: this used to be a bare `catch {}`, which is why four
    // months of model-id drift never announced itself.
    console.error(`[arena] ${judgeId} (${model}) failed for ${deliverable.teamId}: ${failure.message}`);
    if (failure.detail) console.error(`[arena]   detail: ${failure.detail.slice(0, 500)}`);
    scores = scores.map((s) => ({ ...s, commentary: failure!.message }));
  }

  // Clamp scores to [0, maxScore]
  scores = scores.map((s) => {
    const criterion = rubric.criteria.find((c) => c.id === s.criterionId);
    const max = criterion?.maxScore ?? 10;
    return { ...s, score: Math.max(0, Math.min(max, s.score)) };
  });

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: computeOverallScore(scores, rubric),
    model,
    ...(failure ? { failure } : {}),
  };
}
