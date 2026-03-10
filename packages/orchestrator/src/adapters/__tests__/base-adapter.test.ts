import { describe, it, expect, afterEach } from 'vitest';
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
