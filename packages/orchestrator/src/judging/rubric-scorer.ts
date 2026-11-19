import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { HEURISTIC_CEILING, expectedFileName } from '@arena/shared';
import { normalizeOutput } from '../adapters/normalizer-utils.js';
import { computeOverallScore } from './score-aggregator.js';

/**
 * Automated (fallback) rubric scorer.
 *
 * SECURITY POSTURE — read before changing anything in this file.
 *
 * To score a `correctness` criterion against `brief.expectedOutput`, this module
 * has to RUN the deliverable and diff its stdout. The deliverable is written by a
 * competing model, so running it is arbitrary code execution — and it happens in
 * the orchestrator process, i.e. on the HOST, *even when the Docker sandbox is
 * enabled for the agents themselves*. The sandbox covers the agents; it has never
 * covered this.
 *
 * That is tolerable for a local dev tool and not tolerable for a self-hosted one,
 * so execution is now OFF BY DEFAULT and must be opted into explicitly:
 *
 *     ARENA_ALLOW_HOST_CODE_EXECUTION=true
 *
 * resolved from the process environment only, never from an HTTP request body —
 * the same rule `server/run-options.ts` applies to `ARENA_SKIP_SANDBOX`.
 *
 * When execution is disabled the criterion is reported as SKIPPED and EXCLUDED
 * from the weighted overall score. It is deliberately NOT scored zero: a check
 * that never ran and a check that ran and failed are different facts, and
 * conflating them silently deflates a team's score. See `scoreDeliverable()`.
 */

/** Opt-in env var. Named for what it actually permits: execution on the host. */
export const EXECUTION_ENV_VAR = 'ARENA_ALLOW_HOST_CODE_EXECUTION';

/** Marker prefix so callers/UI can detect a not-evaluated criterion in commentary. */
export const SKIPPED_PREFIX = 'SKIPPED:';

/** Mirrors the `=== 'true'` convention in server/run-options.ts. */
function envFlag(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}

/**
 * True only when the operator explicitly opted in.
 * Read fresh on every call so tests and `.env` reloads see current values.
 */
export function hostCodeExecutionAllowed(): boolean {
  return envFlag(process.env[EXECUTION_ENV_VAR]);
}

function skippedCommentary(): string {
  return (
    `${SKIPPED_PREFIX} not evaluated. Scoring this criterion requires executing the ` +
    `deliverable, which runs model-written code on the host, so it is disabled by ` +
    `default. This criterion was excluded from the overall score rather than scored ` +
    `zero. To enable it, restart the orchestrator with ${EXECUTION_ENV_VAR}=true.`
  );
}

/** Maps file extension to interpreter command + args (content piped via stdin). */
const STDIN_RUNNERS: Record<string, [string, ...string[]]> = {
  '.py': ['python3', '-'],
  '.js': ['node', '--max-old-space-size=64', '-'],
  '.rb': ['ruby', '-'],
  '.sh': ['bash', '--restricted', '-s'],
};

/** Reject files larger than this before attempting execution. */
const MAX_EXEC_BYTES = 100 * 1024; // 100 KB
/** Cap collected stdout to prevent memory exhaustion from runaway output. */
const MAX_STDOUT_BYTES = 512 * 1024; // 512 KB

function executeContent(content: string, ext: string): Promise<{ stdout: string; ok: boolean }> {
  const runner = STDIN_RUNNERS[ext];
  if (!runner) return Promise.resolve({ stdout: '', ok: false });

  // Guard: refuse to execute oversized content
  if (Buffer.byteLength(content, 'utf8') > MAX_EXEC_BYTES) {
    return Promise.resolve({ stdout: '', ok: false });
  }

  return new Promise((resolve) => {
    const child = spawn(runner[0], runner.slice(1), { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let collectedBytes = 0;
    let settled = false;

    const settle = (result: { stdout: string; ok: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ stdout: '', ok: false });
    }, 10_000);

    child.stdout.on('data', (chunk: Buffer) => {
      collectedBytes += chunk.length;
      if (collectedBytes <= MAX_STDOUT_BYTES) {
        chunks.push(chunk);
      } else {
        child.kill('SIGKILL');
        settle({ stdout: '', ok: false });
      }
    });
    child.stdin.end(content, 'utf8');
    child.on('close', (code) => settle({ stdout: Buffer.concat(chunks).toString('utf8'), ok: code === 0 }));
    child.on('error', () => settle({ stdout: '', ok: false }));
  });
}

/**
 * Execute TypeScript content by writing it to a temp file and running tsx.
 * tsx does not support stdin execution, so a temp file is required.
 */
async function executeTsContent(content: string): Promise<{ stdout: string; ok: boolean }> {
  if (Buffer.byteLength(content, 'utf8') > MAX_EXEC_BYTES) {
    return { stdout: '', ok: false };
  }

  const tmpFile = `/tmp/arena-ts-${randomUUID()}.ts`;

  try {
    await writeFile(tmpFile, content, 'utf8');

    return await new Promise((resolve) => {
      const child = spawn('tsx', [tmpFile], { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      let collectedBytes = 0;
      let settled = false;

      const settle = (result: { stdout: string; ok: boolean }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle({ stdout: '', ok: false });
      }, 10_000);

      child.stdout.on('data', (chunk: Buffer) => {
        collectedBytes += chunk.length;
        if (collectedBytes <= MAX_STDOUT_BYTES) {
          chunks.push(chunk);
        } else {
          child.kill('SIGKILL');
          settle({ stdout: '', ok: false });
        }
      });

      child.on('close', (code) => settle({ stdout: Buffer.concat(chunks).toString('utf8'), ok: code === 0 }));
      child.on('error', () => settle({ stdout: '', ok: false }));
    });
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * Execute the first runnable file in the deliverable and compare its stdout
 * to expectedOutput line-by-line. Returns a score in [0, maxScore].
 */
async function scoreByExecution(
  files: Array<{ path: string; content: string }>,
  expectedOutput: string,
  maxScore: number,
): Promise<{ score: number; commentary: string }> {
  const runnable = files.find((f) => STDIN_RUNNERS[extname(f.path)] || extname(f.path) === '.ts');
  if (!runnable) {
    return { score: 0, commentary: 'No runnable file found (supported: .py .js .rb .sh .ts).' };
  }

  const ext = extname(runnable.path);
  const { stdout, ok } = ext === '.ts'
    ? await executeTsContent(runnable.content)
    : await executeContent(runnable.content, ext);

  if (!ok) {
    return { score: 0, commentary: `Execution of ${runnable.path} failed or timed out.` };
  }

  const expected = normalizeOutput(expectedOutput).split('\n');
  const actual = normalizeOutput(stdout).split('\n');

  const matchingLines = expected.filter((line, i) => actual[i] === line).length;
  const ratio = expected.length > 0 ? matchingLines / expected.length : 0;
  const score = Math.round(ratio * maxScore * 10) / 10;

  return {
    score,
    commentary: `Executed ${runnable.path}: ${matchingLines}/${expected.length} lines matched expected output.`,
  };
}

// ── Completeness heuristic ────────────────────────────────────────────────────
//
// Without the AI judge nothing here can read a deliverable and say whether it is
// any good. The old heuristic pretended otherwise: it scaled with character
// count, so ~500 characters of anything (scratch notes, a stray log) earned full
// marks even when every named deliverable was missing.
//
// What the fallback CAN honestly measure is completeness: did the team hand in
// the files the brief asked for, and are they more than a placeholder? That is
// all it scores. Length beyond the placeholder check earns nothing, and because
// quality was never assessed the result is capped at HEURISTIC_CEILING of each
// criterion's maxScore: a complete submission reads as "handed in, not judged",
// never as a perfect score.

/** Marker prefix on heuristic commentary, mirroring SKIPPED_PREFIX. */
export const HEURISTIC_PREFIX = 'HEURISTIC:';

/** Highest share of a criterion's maxScore the completeness heuristic can award (lives in @arena/shared so UI copy matches). */
export { HEURISTIC_CEILING, expectedFileName };

/**
 * A file with fewer non-whitespace characters than this is treated as a
 * placeholder ("TODO", an empty heading). Deliberately low: a one-line solution
 * must clear it. It is a presence check, not a quality scale.
 */
export const MIN_SUBSTANTIVE_CHARS = 40;

/** Credit for a named deliverable that exists but is only a placeholder. */
const PLACEHOLDER_CREDIT = 0.2;

function nonWhitespaceLength(content: string): number {
  return content.replace(/\s+/g, '').length;
}

function findDeliverableFile(
  files: Array<{ path: string; content: string }>,
  expected: string,
): { path: string; content: string } | undefined {
  const want = expected.toLowerCase();
  const wantBase = want.split('/').pop()!;
  const normalized = files.map((f) => ({ file: f, path: f.path.replace(/^\.?\//, '').toLowerCase() }));
  return (
    normalized.find((n) => n.path === want || n.path.endsWith(`/${want}`))?.file ??
    // Fall back to the base name, so `docs/README.md` satisfies `README.md` and
    // `README.md` satisfies `docs/README.md`.
    normalized.find((n) => n.path.split('/').pop() === wantBase)?.file
  );
}

interface Completeness {
  /** In [0, 1]: share of the requested deliverables handed in with substance. */
  ratio: number;
  /** Human-readable reason, without the HEURISTIC_PREFIX. */
  summary: string;
}

/**
 * How complete the submission is against `brief.deliverables`.
 *
 * Each deliverable that names a file earns 1 when that file exists with
 * substance, PLACEHOLDER_CREDIT when it exists but is a placeholder, and 0 when
 * it is missing. Files the brief did not ask for earn nothing. When the brief
 * names no file at all (only descriptions), the best the heuristic can do is
 * check that SOMETHING substantive was handed in.
 */
export function assessCompleteness(
  files: Array<{ path: string; content: string }>,
  deliverables: string[] | undefined,
): Completeness {
  const named = (deliverables ?? [])
    .map(expectedFileName)
    .filter((n): n is string => n !== null);

  if (named.length === 0) {
    const substantive = files.filter((f) => nonWhitespaceLength(f.content) >= MIN_SUBSTANTIVE_CHARS);
    if (substantive.length > 0) {
      return { ratio: 1, summary: `${files.length} file(s) handed in; the brief names no files to check against.` };
    }
    return {
      ratio: files.length > 0 ? PLACEHOLDER_CREDIT : 0,
      summary: `${files.length} file(s) handed in, all under ${MIN_SUBSTANTIVE_CHARS} non-whitespace characters (placeholders).`,
    };
  }

  const missing: string[] = [];
  const placeholders: string[] = [];
  let credit = 0;
  for (const name of named) {
    const file = findDeliverableFile(files, name);
    if (!file) {
      missing.push(name);
    } else if (nonWhitespaceLength(file.content) < MIN_SUBSTANTIVE_CHARS) {
      placeholders.push(name);
      credit += PLACEHOLDER_CREDIT;
    } else {
      credit += 1;
    }
  }

  const present = named.length - missing.length;
  const parts = [`${present}/${named.length} named deliverable(s) present`];
  if (missing.length > 0) parts.push(`missing: ${missing.join(', ')}`);
  if (placeholders.length > 0) parts.push(`placeholder only: ${placeholders.join(', ')}`);
  return { ratio: credit / named.length, summary: `${parts.join('; ')}.` };
}

function heuristicCommentary(completeness: Completeness): string {
  return (
    `${HEURISTIC_PREFIX} AI judge unavailable, so this was scored on completeness only. ` +
    `${completeness.summary} Quality was not assessed; heuristic scores are capped at ` +
    `${Math.round(HEURISTIC_CEILING * 100)}%.`
  );
}

/**
 * Automated rubric scorer (the fallback used when the AI judge fails).
 *
 * When `brief.expectedOutput` is set, the `correctness` criterion is scored by
 * executing the deliverable and comparing stdout line-by-line. Every other
 * criterion (and correctness when no expectedOutput is defined) is scored on
 * completeness against `brief.deliverables`, capped at HEURISTIC_CEILING — see
 * the "Completeness heuristic" note above. The result carries `heuristic: true`
 * so the UI can label it; that flag, not the score, is what says "not judged".
 *
 * Execution requires an explicit opt-in — see the SECURITY POSTURE note at the
 * top of this file. When it is disabled, the affected criterion is reported as
 * SKIPPED and dropped from the weighted average instead of being scored zero.
 *
 * WHY DROPPED RATHER THAN ZEROED: `computeOverallScore()` sums
 * `(score / maxScore) * weight` and assumes the weights it is given total the
 * full rubric. Leaving a never-evaluated criterion in at zero would quietly
 * subtract its entire weight from the team's score, so a team could lose 60% of
 * its mark for a check that was never run. Instead the surviving criteria are
 * rescaled to carry the original total weight, so full marks on what *was*
 * evaluated still yields a full overall score.
 *
 * overallScore is in [0, 1] — the weighted normalised sum of criterion scores.
 * If every criterion was skipped there is nothing to renormalise against and
 * overallScore is 0; the commentary on each criterion explains why.
 */
export async function scoreDeliverable(
  judgeId: string,
  deliverable: Deliverable,
  rubric: Rubric,
  brief?: Brief,
): Promise<JudgeResult> {
  const fileCount = deliverable.files.length;
  const completeness = assessCompleteness(deliverable.files, brief?.deliverables);

  const activeCriteria = rubric.criteria.filter(
    (c) => c.description.trim() && c.weight >= 0.05,
  );

  const evaluated = await Promise.all(
    activeCriteria.map(async (criterion) => {
      let raw = 0;
      let commentary: string;
      let skipped = false;

      if (fileCount === 0) {
        raw = 0;
        commentary = 'No deliverable files found.';
      } else if (criterion.id === 'correctness' && brief?.expectedOutput) {
        if (!hostCodeExecutionAllowed()) {
          // Not a failure — a check we declined to run. Excluded from the average below.
          raw = 0;
          commentary = skippedCommentary();
          skipped = true;
        } else {
          const result = await scoreByExecution(deliverable.files, brief.expectedOutput, criterion.maxScore);
          raw = result.score;
          commentary = result.commentary;
        }
      } else {
        // The heuristic cannot tell criteria apart, so every criterion gets the
        // same completeness score rather than invented per-criterion formulas.
        raw = completeness.ratio * HEURISTIC_CEILING * criterion.maxScore;
        commentary = heuristicCommentary(completeness);
      }

      raw = Math.max(0, Math.round(raw * 10) / 10);
      return { criterion, score: { criterionId: criterion.id, score: raw, commentary }, skipped };
    }),
  );

  const scores: CriterionScore[] = evaluated.map((e) => e.score);

  // Rescale the criteria that actually ran so they carry the full original weight.
  // computeOverallScore() ignores any score whose criterionId is absent from the
  // rubric it is handed, so skipped criteria contribute nothing simply by omission.
  const totalWeight = activeCriteria.reduce((sum, c) => sum + c.weight, 0);
  const scoredCriteria = evaluated.filter((e) => !e.skipped).map((e) => e.criterion);
  const scoredWeight = scoredCriteria.reduce((sum, c) => sum + c.weight, 0);

  const scoringRubric: Rubric =
    scoredWeight > 0
      ? { criteria: scoredCriteria.map((c) => ({ ...c, weight: c.weight * (totalWeight / scoredWeight) })) }
      : { criteria: [] };

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: computeOverallScore(scores, scoringRubric),
    heuristic: true,
  };
}
