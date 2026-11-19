import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CompetitionFormat } from '@arena/shared';
import type { Brief } from '@arena/shared';

// We test injectBrief and collectDeliverables via a minimal concrete subclass.
import { BaseAdapter } from '../base-adapter.js';

class TestAdapter extends BaseAdapter {
  async startExecution(): Promise<void> {}
  getPrompt() { return this.promptText; }
}

const BRIEF: Brief = {
  id: 'test-1',
  title: 'Find Cheapest Hotel',
  problem: 'Find the cheapest hotel in Chicago this weekend.',
  constraints: ['Use only public data sources.'],
  deliverables: ['hotel-report.md with ranked options and prices'],
  rubric: {
    criteria: [
      { id: 'correctness', description: 'Findings are accurate', weight: 0.5, maxScore: 10 },
      { id: 'quality', description: 'Report is well-structured', weight: 0.5, maxScore: 10 },
    ],
  },
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 5 * 60_000,
};

describe('BaseAdapter.injectBrief', () => {
  it('includes the problem statement', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    expect(a.getPrompt()).toContain('Find the cheapest hotel in Chicago');
  });

  it('includes constraints', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    expect(a.getPrompt()).toContain('Use only public data sources.');
  });

  it('includes deliverables', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    expect(a.getPrompt()).toContain('hotel-report.md');
  });

  it('includes rubric criteria', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    const prompt = a.getPrompt();
    expect(prompt).toContain('correctness');
    expect(prompt).toContain('Findings are accurate');
    expect(prompt).toContain('quality');
  });

  it('includes explicit file-writing instruction', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    expect(a.getPrompt()).toContain('write it to a file');
    expect(a.getPrompt()).toContain('score is 0');
  });

  it('includes the persona', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'You are a speedrunner persona.');
    expect(a.getPrompt()).toContain('You are a speedrunner persona.');
  });

  it('includes the time limit', async () => {
    const a = new TestAdapter('team-a', '/tmp', 'comp-1');
    await a.injectBrief(BRIEF, 'Be fast.');
    expect(a.getPrompt()).toContain('5 minutes');
  });
});

describe('BaseAdapter.collectDeliverables', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('collects top-level files', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await writeFile(join(tmpDir, 'solution.py'), 'print("hello")');
    const a = new TestAdapter('team-a', tmpDir, 'comp-1');
    const d = await a.collectDeliverables();
    expect(d.files).toHaveLength(1);
    expect(d.files[0].path).toBe('solution.py');
    expect(d.files[0].content).toContain('hello');
  });

  it('collects files in subdirectories recursively', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await mkdir(join(tmpDir, 'src'));
    await writeFile(join(tmpDir, 'src', 'main.py'), 'print("nested")');
    await writeFile(join(tmpDir, 'README.md'), '# Report');
    const a = new TestAdapter('team-a', tmpDir, 'comp-1');
    const d = await a.collectDeliverables();
    expect(d.files).toHaveLength(2);
    const paths = d.files.map((f) => f.path).sort();
    expect(paths).toEqual(['README.md', join('src', 'main.py')]);
  });

  it('returns empty files array when workdir does not exist', async () => {
    const a = new TestAdapter('team-a', '/nonexistent-arena-workdir', 'comp-1');
    const d = await a.collectDeliverables();
    expect(d.files).toHaveLength(0);
  });

  it('stores relative paths, not absolute paths', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await mkdir(join(tmpDir, 'output'));
    await writeFile(join(tmpDir, 'output', 'report.md'), '# Results');
    const a = new TestAdapter('team-a', tmpDir, 'comp-1');
    const d = await a.collectDeliverables();
    expect(d.files[0].path).not.toContain(tmpDir);
    expect(d.files[0].path).toBe(join('output', 'report.md'));
  });
});

const makeBrief = (overrides: Partial<import('@arena/shared').Brief> = {}): import('@arena/shared').Brief => ({
  id: 'test-brief',
  title: 'Test Brief',
  problem: 'Solve the problem.',
  constraints: ['No external libraries'],
  deliverables: ['solution.py'],
  rubric: { criteria: [{ id: 'correctness', weight: 1.0, maxScore: 10, description: 'Correct output' }] },
  format: 'SPRINT' as any,
  timeLimitMs: 300_000,
  deliverableType: 'code',
  ...overrides,
});

describe('BaseAdapter.injectBrief() deliverable format injection', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter('team-a', '/tmp/test', 'comp-1');
  });

  it('injects [DELIVERABLE FORMAT] section for code type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'code' }), 'architect');
    expect(adapter.getPrompt()).toContain('[DELIVERABLE FORMAT]');
    expect(adapter.getPrompt()).toContain('runnable code files');
  });

  it('injects document guidance for document type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'document' }), 'researcher');
    expect(adapter.getPrompt()).toContain('Do NOT write code files');
  });

  it('injects analysis guidance for analysis type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'analysis' }), 'analyst');
    expect(adapter.getPrompt()).toContain('data analysis output');
  });

  it('injects presentation guidance for presentation type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'presentation' }), 'designer');
    expect(adapter.getPrompt()).toContain('presentation outline');
  });

  it('injects plan guidance for plan type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'plan' }), 'architect');
    expect(adapter.getPrompt()).toContain('strategic plan');
  });

  it('injects mixed guidance for mixed type', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'mixed' }), 'pioneer');
    expect(adapter.getPrompt()).toContain('combination of code and documents');
  });

  it('defaults to code guidance when deliverableType is undefined', async () => {
    const brief = makeBrief();
    delete (brief as any).deliverableType;
    await adapter.injectBrief(brief, 'architect');
    expect(adapter.getPrompt()).toContain('runnable code files');
  });

  it('[DELIVERABLE FORMAT] section appears before [DELIVERABLES]', async () => {
    await adapter.injectBrief(makeBrief({ deliverableType: 'document' }), 'researcher');
    const formatIdx = adapter.getPrompt().indexOf('[DELIVERABLE FORMAT]');
    const deliverablesIdx = adapter.getPrompt().indexOf('[DELIVERABLES]');
    expect(formatIdx).toBeGreaterThan(-1);
    expect(formatIdx).toBeLessThan(deliverablesIdx);
  });
});

describe('BaseAdapter.collectDeliverables named-first collection', () => {
  let dir: string;
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('reads nested named files before a large research dir, and lists budget exclusions', async () => {
    dir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await mkdir(join(dir, 'research'));
    // 60 x 100 KB = 6 MB, over the 5 MB total budget. Names sort before the named files.
    for (let i = 0; i < 60; i++) {
      await writeFile(join(dir, 'research', `a${String(i).padStart(2, '0')}.md`), 'x'.repeat(100 * 1024));
    }
    await writeFile(join(dir, 'decision.md'), '# Decision');
    await writeFile(join(dir, 'research', 'kegs.md'), '# Kegs');
    const a = new TestAdapter('team-a', dir, 'comp-1');
    const d = await a.collectDeliverables(['decision.md with the final call', 'research/kegs.md']);
    const paths = d.files.map((f) => f.path);
    expect(paths.slice(0, 2)).toEqual(['decision.md', 'research/kegs.md']);
    expect(d.excluded?.some((e) => e.reason === 'budget')).toBe(true);
    expect(paths.length + d.excluded!.length).toBe(62);
  });

  it('matches a named file without a slash by basename anywhere in the tree', async () => {
    dir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'a.md'), 'a');
    await writeFile(join(dir, 'docs', 'zz-report.md'), 'r');
    const d = await new TestAdapter('team-a', dir, 'comp-1').collectDeliverables(['zz-report.md']);
    expect(d.files[0].path).toBe('docs/zz-report.md');
  });

  it('skips node_modules and .git, reporting only the vendored directory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(dir, '.git'));
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1');
    await writeFile(join(dir, '.git', 'config'), '[core]');
    await writeFile(join(dir, 'main.js'), 'console.log(1)');
    const d = await new TestAdapter('team-a', dir, 'comp-1').collectDeliverables();
    expect(d.files.map((f) => f.path)).toEqual(['main.js']);
    expect(d.excluded).toEqual([{ path: 'node_modules', reason: 'vendored' }]);
  });

  it('reports an over-size file as excluded', async () => {
    dir = await mkdtemp(join(tmpdir(), 'arena-test-'));
    await writeFile(join(dir, 'big.txt'), 'x'.repeat(501 * 1024));
    const d = await new TestAdapter('team-a', dir, 'comp-1').collectDeliverables();
    expect(d.files).toEqual([]);
    expect(d.excluded).toEqual([{ path: 'big.txt', reason: 'size' }]);
  });
});
