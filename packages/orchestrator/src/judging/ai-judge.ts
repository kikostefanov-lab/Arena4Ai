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

    const parsed = JSON.parse(extractJson(stdout)) as { scores: CriterionScore[] };
    if (Array.isArray(parsed.scores) && parsed.scores.length > 0) {
      scores = parsed.scores;
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
    provider,
    ...(failure ? { failure } : {}),
  };
}
