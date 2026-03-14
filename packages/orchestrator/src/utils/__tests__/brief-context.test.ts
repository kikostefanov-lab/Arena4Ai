import { describe, it, expect } from 'vitest';
import {
  buildBriefContext,
  truncateFiles,
  JUDGE_CONTEXT,
  PRESENTER_CONTEXT,
  SYNTHESIS_CONTEXT,
  FORGE_CONTEXT,
} from '../brief-context.js';
import type { Brief } from '@arena/shared';
import { CompetitionFormat } from '@arena/shared';

const mockBrief = (overrides: Partial<Brief> = {}): Brief => ({
  id: 'fizzbuzz-cli',
  title: 'FizzBuzz CLI',
  problem: 'Build a fizzbuzz program that prints numbers 1 to 100.',
  constraints: ['Must use stdout', 'No external libraries'],
  deliverables: ['solution.py', 'README.md'],
  rubric: {
    criteria: [
      { id: 'correctness', description: 'Output matches expected', weight: 0.6, maxScore: 10 },
      { id: 'code-quality', description: 'Clean, readable code', weight: 0.4, maxScore: 10 },
    ],
  },
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 120000,
  ...overrides,
});

// ---------- buildBriefContext ----------

describe('buildBriefContext', () => {
  it('includes only requested fields', () => {
    const result = buildBriefContext(mockBrief(), {
      include: ['title', 'problem'],
      rubricDetail: 'full',
    });
    expect(result).toContain('FizzBuzz CLI');
    expect(result).toContain('Build a fizzbuzz program');
    expect(result).not.toContain('Constraints');
    expect(result).not.toContain('Deliverables');
    expect(result).not.toContain('Rubric');
  });

  it('includes all sections when all fields requested', () => {
    const result = buildBriefContext(mockBrief(), {
      include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
      rubricDetail: 'full',
    });
    expect(result).toContain('## Title');
    expect(result).toContain('## Problem');
    expect(result).toContain('## Constraints');
    expect(result).toContain('## Deliverables');
    expect(result).toContain('## Rubric');
  });

  describe('rubricDetail modes', () => {
    it('full mode includes weight, maxScore, and description', () => {
      const result = buildBriefContext(mockBrief(), {
        include: ['rubric'],
        rubricDetail: 'full',
      });
      expect(result).toContain('**correctness** (weight 60%, max 10)');
      expect(result).toContain('Output matches expected');
      expect(result).toContain('**code-quality** (weight 40%, max 10)');
      expect(result).toContain('Clean, readable code');
    });

    it('weights-only mode includes weight and description but not maxScore', () => {
      const result = buildBriefContext(mockBrief(), {
        include: ['rubric'],
        rubricDetail: 'weights-only',
      });
      expect(result).toContain('**correctness** (weight 60%)');
      expect(result).toContain('Output matches expected');
      expect(result).not.toContain('max 10');
    });

    it('descriptions-only mode includes id and description but not weight', () => {
      const result = buildBriefContext(mockBrief(), {
        include: ['rubric'],
        rubricDetail: 'descriptions-only',
      });
      expect(result).toContain('**correctness**:');
      expect(result).toContain('Output matches expected');
      expect(result).not.toContain('weight');
      expect(result).not.toContain('max');
    });
  });

  it('omits constraints section when constraints array is empty', () => {
    const result = buildBriefContext(mockBrief({ constraints: [] }), {
      include: ['title', 'problem', 'constraints'],
      rubricDetail: 'full',
    });
    expect(result).toContain('## Title');
    expect(result).toContain('## Problem');
    expect(result).not.toContain('## Constraints');
  });

  it('includes format when requested', () => {
    const result = buildBriefContext(mockBrief(), {
      include: ['format'],
      rubricDetail: 'full',
    });
    expect(result).toContain('## Format');
    expect(result).toContain('SPRINT');
  });

  it('includes deliverableType when requested', () => {
    const result = buildBriefContext(mockBrief({ deliverableType: 'code' }), {
      include: ['deliverableType'],
      rubricDetail: 'full',
    });
    expect(result).toContain('## Deliverable Type');
    expect(result).toContain('code');
  });

  it('omits deliverableType section when field is undefined', () => {
    const brief = mockBrief();
    delete brief.deliverableType;
    const result = buildBriefContext(brief, {
      include: ['deliverableType'],
      rubricDetail: 'full',
    });
    expect(result).not.toContain('## Deliverable Type');
  });

  it('uses ## headers for each section', () => {
    const result = buildBriefContext(mockBrief(), {
      include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
      rubricDetail: 'full',
    });
    const headers = result.match(/^## .+$/gm) || [];
    expect(headers).toHaveLength(5);
  });
});

// ---------- truncateFiles ----------

describe('truncateFiles', () => {
  it('passes through small files unchanged', () => {
    const files = [
      { path: 'main.py', content: 'print("hello")' },
      { path: 'README.md', content: '# Hello' },
    ];
    const result = truncateFiles(files, 8000, 50000);
    expect(result).toContain('### main.py');
    expect(result).toContain('print("hello")');
    expect(result).toContain('### README.md');
    expect(result).toContain('# Hello');
    expect(result).not.toContain('truncated');
    expect(result).not.toContain('omitted');
  });

  it('truncates individual files exceeding per-file limit', () => {
    const longContent = 'x'.repeat(200);
    const files = [{ path: 'big.py', content: longContent }];
    const result = truncateFiles(files, 50, 50000);
    expect(result).toContain('### big.py');
    expect(result).toContain('[truncated at 50 chars]');
    // The content in the output should be the truncated portion
    expect(result).not.toContain(longContent);
  });

  it('respects total budget and adds omission note', () => {
    const files = [
      { path: 'a.py', content: 'a'.repeat(100) },
      { path: 'b.py', content: 'b'.repeat(100) },
      { path: 'c.py', content: 'c'.repeat(100) },
    ];
    // Budget only allows ~1 file worth of content (including markdown overhead)
    const result = truncateFiles(files, 8000, 150);
    expect(result).toContain('### a.py');
    expect(result).toContain('omitted');
  });

  it('handles empty file list', () => {
    const result = truncateFiles([], 8000, 50000);
    expect(result).toBe('');
  });

  it('wraps content in code fences', () => {
    const files = [{ path: 'main.py', content: 'print("hi")' }];
    const result = truncateFiles(files, 8000, 50000);
    expect(result).toContain('```\nprint("hi")\n```');
  });
});

// ---------- Preset constants ----------

describe('preset constants', () => {
  it('JUDGE_CONTEXT has correct values', () => {
    expect(JUDGE_CONTEXT.include).toEqual(['title', 'problem', 'constraints', 'deliverables', 'rubric']);
    expect(JUDGE_CONTEXT.rubricDetail).toBe('full');
    expect(JUDGE_CONTEXT.fileTruncation).toBe(12000);
    expect(JUDGE_CONTEXT.fileBudget).toBe(80000);
  });

  it('PRESENTER_CONTEXT has correct values', () => {
    expect(PRESENTER_CONTEXT.include).toEqual(['title', 'problem', 'constraints', 'deliverables', 'rubric']);
    expect(PRESENTER_CONTEXT.rubricDetail).toBe('weights-only');
    expect(PRESENTER_CONTEXT.fileTruncation).toBe(8000);
    expect(PRESENTER_CONTEXT.fileBudget).toBe(50000);
  });

  it('SYNTHESIS_CONTEXT has correct values', () => {
    expect(SYNTHESIS_CONTEXT.include).toEqual(['title', 'problem', 'constraints', 'rubric']);
    expect(SYNTHESIS_CONTEXT.rubricDetail).toBe('full');
    expect(SYNTHESIS_CONTEXT.fileTruncation).toBe(8000);
    expect(SYNTHESIS_CONTEXT.fileBudget).toBe(50000);
  });

  it('FORGE_CONTEXT has correct values', () => {
    expect(FORGE_CONTEXT.include).toEqual(['title', 'problem', 'constraints', 'rubric']);
    expect(FORGE_CONTEXT.rubricDetail).toBe('full');
    expect(FORGE_CONTEXT.fileTruncation).toBe(6000);
    expect(FORGE_CONTEXT.fileBudget).toBe(40000);
  });
});
