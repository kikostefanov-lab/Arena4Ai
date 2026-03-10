import { spawn } from 'node:child_process';
import { extname } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { normalizeOutput } from '../adapters/normalizer-utils.js';
import { computeOverallScore } from './score-aggregator.js';

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

/**
 * Automated rubric scorer.
 *
 * When `brief.expectedOutput` is set, the `correctness` criterion is scored by
 * executing the deliverable and comparing stdout line-by-line. All other
 * criteria (and all criteria when no expectedOutput is defined) use simple
 * heuristics (file count, content length).
 *
 * overallScore is in [0, 1] — the weighted normalised sum of criterion scores.
 */
export async function scoreDeliverable(
  judgeId: string,
  deliverable: Deliverable,
  rubric: Rubric,
  brief?: Brief,
): Promise<JudgeResult> {
  const totalChars = deliverable.files.reduce((s, f) => s + f.content.length, 0);
  const fileCount = deliverable.files.length;

  const activeCriteria = rubric.criteria.filter(
    (c) => c.description.trim() && c.weight >= 0.05,
  );
  const filteredRubric: Rubric = { criteria: activeCriteria };

  const scores: CriterionScore[] = await Promise.all(
    activeCriteria.map(async (criterion) => {
      let raw = 0;
      let commentary: string;

      if (fileCount === 0) {
        raw = 0;
        commentary = 'No deliverable files found.';
      } else if (criterion.id === 'correctness' && brief?.expectedOutput) {
        const result = await scoreByExecution(deliverable.files, brief.expectedOutput, criterion.maxScore);
        raw = result.score;
        commentary = result.commentary;
      } else {
        switch (criterion.id) {
          case 'correctness':
            raw = Math.min(criterion.maxScore, (totalChars / fileCount / 50) * criterion.maxScore);
            commentary = `Heuristic: ${fileCount} file(s), ${totalChars} chars (no expectedOutput defined).`;
            break;
          case 'quality':
          case 'code-quality':
            raw = Math.min(criterion.maxScore, fileCount * 2 + (totalChars > 200 ? 2 : 0));
            commentary = `Heuristic: ${fileCount} file(s), ${totalChars} chars.`;
            break;
          default:
            raw = Math.min(criterion.maxScore, (totalChars / 500) * criterion.maxScore);
            commentary = `Heuristic: ${totalChars} chars across ${fileCount} file(s).`;
        }
      }

      raw = Math.max(0, Math.round(raw * 10) / 10);
      return { criterionId: criterion.id, score: raw, commentary };
    }),
  );

  return {
    judgeId,
    teamId: deliverable.teamId,
    scores,
    overallScore: computeOverallScore(scores, filteredRubric),
  };
}
