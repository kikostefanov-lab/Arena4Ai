import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { parseBrief } from './parser.js';
import { CompetitionFormat } from '@arena/shared';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const briefsDir = resolve(__dirname, '../../briefs');

// ─── Helper: write a temp YAML brief for inline tests ────────────────────────

async function writeTempBrief(content: string): Promise<string> {
  const dir = resolve(tmpdir(), 'arena-parser-tests');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `brief-${Date.now()}-${Math.random().toString(36).slice(2)}.yml`);
  await writeFile(path, content, 'utf8');
  return path;
}

async function withTempBrief(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const path = await writeTempBrief(content);
  try {
    await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

// ─── Minimal valid brief YAML ─────────────────────────────────────────────────

function minimalBriefYaml(opts: {
  timeLimitMs?: number;
  criteriaBlock?: string;
} = {}): string {
  const timeLimitMs = opts.timeLimitMs ?? 60000;
  const criteriaBlock = opts.criteriaBlock ?? `    - id: correctness
      description: Correct answer
      weight: 0.5
      maxScore: 10
    - id: quality
      description: Code quality
      weight: 0.5
      maxScore: 10`;

  return `id: test-001
title: "Test Brief"
format: SPRINT
timeLimitMs: ${timeLimitMs}
problem: |
  A simple test problem.
constraints:
  - "One constraint"
deliverables:
  - solution.py
rubric:
  criteria:
${criteriaBlock}
`;
}

// ─── Existing file-based tests ────────────────────────────────────────────────

describe('parseBrief()', () => {
  it('parses code-challenge.yml successfully', async () => {
    const brief = await parseBrief(resolve(briefsDir, 'code-challenge.yml'));
    expect(brief.id).toBe('code-challenge-001');
    expect(brief.format).toBe(CompetitionFormat.SPRINT);
    expect(brief.rubric.criteria).toHaveLength(4);
    const totalWeight = brief.rubric.criteria.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1, 3);
  });

  it('parses architecture-decision.yml successfully', async () => {
    const brief = await parseBrief(resolve(briefsDir, 'architecture-decision.yml'));
    expect(brief.id).toBe('architecture-decision-001');
    expect(brief.deliverables.length).toBeGreaterThanOrEqual(1);
  });

  it('parses analysis.yml successfully', async () => {
    const brief = await parseBrief(resolve(briefsDir, 'analysis.yml'));
    expect(brief.id).toBe('analysis-001');
    expect(brief.timeLimitMs).toBe(3_600_000);
  });

  it('throws a descriptive error for a missing file', async () => {
    await expect(parseBrief('/no/such/file.yml')).rejects.toThrow(/failed to parse brief/i);
  });

  it('throws a descriptive error for invalid YAML content', async () => {
    // Pass a path to a file with missing required fields by writing inline
    // We simulate this by pointing at a non-YAML file (package.json has wrong shape)
    const packageJson = resolve(__dirname, '../../package.json');
    await expect(parseBrief(packageJson)).rejects.toThrow(/failed to parse brief/i);
  });

  // ── timeLimitMs bounds tests ──────────────────────────────────────────────

  it('does not throw when timeLimitMs is valid (60s)', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 60_000 }), async (path) => {
      await expect(parseBrief(path)).resolves.toBeDefined();
    });
  });

  it('throws when timeLimitMs is less than 10 seconds', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 5_000 }), async (path) => {
      await expect(parseBrief(path)).rejects.toThrow('timeLimitMs must be at least 10 seconds');
    });
  });

  it('throws when timeLimitMs is exactly 9999 ms (below 10s threshold)', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 9_999 }), async (path) => {
      await expect(parseBrief(path)).rejects.toThrow('timeLimitMs must be at least 10 seconds');
    });
  });

  it('does not throw when timeLimitMs is exactly 10000 ms (lower bound)', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 10_000 }), async (path) => {
      await expect(parseBrief(path)).resolves.toBeDefined();
    });
  });

  it('throws when timeLimitMs exceeds 1 hour (3600001 ms)', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 3_600_001 }), async (path) => {
      await expect(parseBrief(path)).rejects.toThrow('timeLimitMs cannot exceed 1 hour');
    });
  });

  it('does not throw when timeLimitMs is exactly 1 hour (3600000 ms, upper bound)', async () => {
    await withTempBrief(minimalBriefYaml({ timeLimitMs: 3_600_000 }), async (path) => {
      await expect(parseBrief(path)).resolves.toBeDefined();
    });
  });

  // ── Rubric criteria tests ─────────────────────────────────────────────────

  it('parses successfully when rubric weights sum to exactly 1.0', async () => {
    await withTempBrief(minimalBriefYaml(), async (path) => {
      await expect(parseBrief(path)).resolves.toBeDefined();
    });
  });

  it('throws when rubric criteria is empty (Zod enforces at least one criterion)', async () => {
    // The Zod schema enforces .min(1) on criteria, so an empty array fails schema validation.
    // This test verifies the guard is in place (either via Zod or post-parse check).
    const yaml = minimalBriefYaml({ criteriaBlock: '' });
    await withTempBrief(yaml, async (path) => {
      // Empty criteria block produces null in YAML; Zod rejects it
      await expect(parseBrief(path)).rejects.toThrow();
    });
  });
});
