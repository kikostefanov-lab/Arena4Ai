import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBrief } from './parser.js';
import { CompetitionFormat } from '@arena/shared';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const briefsDir = resolve(__dirname, '../../briefs');

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
});
