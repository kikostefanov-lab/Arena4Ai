import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readdir, readFile, stat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventType, type ArenaEvent, type Brief, type Deliverable, type ModelAdapter } from '@arena/shared';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';

const MAX_FILE_BYTES = 500 * 1024;   // 500 KB per file
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB across all files

const DELIVERABLE_GUIDE: Record<string, string> = {
  code:         'Produce runnable code files. The output should be executable.',
  document:     'Produce written documents (.md, .txt). Do NOT write code files unless explicitly required.',
  analysis:     'Produce data analysis output (.csv, .md tables). Focus on data, not code.',
  presentation: 'Produce a presentation outline or slide content. Written format preferred.',
  plan:         'Produce a strategic plan, roadmap, or architecture document in Markdown.',
  mixed:        'Produce whichever combination of code and documents best addresses the brief.',
};

/** Recursively walk `dir`, returning all text files under size limits. */
async function walkDir(
  dir: string,
  base: string,
  budget: { remaining: number },
): Promise<Array<{ path: string; content: string }>> {
  const results: Array<{ path: string; content: string }> = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkDir(full, base, budget));
    } else if (entry.isFile()) {
      const info = await stat(full).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES || info.size > budget.remaining) continue;
      const content = await readFile(full, 'utf-8').catch(() => null);
      if (content === null || content.includes('\0')) continue; // skip binary
      budget.remaining -= info.size;
      results.push({ path: relative(base, full), content });
    }
  }
  return results;
}

/**
 * Abstract base class for all model adapters.
 *
 * Subclasses must implement only:
 *   - startExecution()  — spawn the model-specific CLI process
 *
 * injectBrief, collectDeliverables, shutdown, and done are implemented
 * concretely here using the shared workdir/competitionId/process state.
 *
 * Events emitted:
 *   'arenaEvent'  (event: ArenaEvent)  — whenever the model produces output
 *   'error'       (err: Error)         — unrecoverable adapter error
 */
export abstract class BaseAdapter extends EventEmitter implements ModelAdapter {
  readonly teamId: string;
  protected readonly workdir: string;
  protected readonly competitionId: string;
  protected readonly sandbox?: SandboxManager;

  protected promptText = '';
  protected process: ChildProcess | null = null;
  protected executionDone: Promise<void> = Promise.resolve();

  constructor(teamId: string, workdir: string, competitionId: string, sandbox?: SandboxManager) {
    super();
    this.teamId = teamId;
    this.workdir = workdir;
    this.competitionId = competitionId;
    this.sandbox = sandbox;
  }

  injectBrief(brief: Brief, persona: string): Promise<void> {
    const constraints =
      brief.constraints.length > 0
        ? `Constraints:\n${brief.constraints.map((c) => `- ${c}`).join('\n')}`
        : '';

    const deliverables = brief.deliverables.map((d) => `- ${d}`).join('\n');

    const rubric = brief.rubric.criteria
      .map((c) => `- ${c.id} (weight ${Math.round(c.weight * 100)}%): ${c.description}`)
      .join('\n');

    const deliverableFormatGuidance = `[DELIVERABLE FORMAT]\n${DELIVERABLE_GUIDE[brief.deliverableType ?? 'code']}`;

    this.promptText = [
      `[PERSONA]\n${persona}`,
      `[COMPETITION RULES]`,
      'You are an autonomous AI agent in a timed competition. There is NO human to interact with.',
      'Do NOT ask clarifying questions — no one will answer. Make reasonable assumptions and start working immediately.',
      'Your ONLY goal is to produce deliverable files in the current working directory before time runs out.',
      `[BRIEF: ${brief.title}]`,
      brief.problem,
      constraints,
      deliverableFormatGuidance,
      [
        '[DELIVERABLES]',
        '⚠️  CRITICAL: A judge will collect files from your current working directory after the timer ends.',
        'You MUST save all deliverables as files in the current working directory.',
        'Do NOT just think or print your answer — write it to a file. If you submit no files, your score is 0.',
        deliverables,
      ].join('\n'),
      `[SCORING RUBRIC]\nYour work will be judged on the following criteria:\n${rubric}`,
      `[TIME LIMIT] ${Math.round(brief.timeLimitMs / 60_000)} minutes — work fast and write your output files before time runs out.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return Promise.resolve();
  }

  async collectDeliverables(): Promise<Deliverable> {
    const budget = { remaining: MAX_TOTAL_BYTES };
    const files = await walkDir(this.workdir, this.workdir, budget);

    return {
      teamId: this.teamId,
      files,
      collectedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.sandbox) {
      await this.sandbox.killContainer(this.teamId);
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /** Resolves when the CLI process exits cleanly (useful in tests and the competition race). */
  get done(): Promise<void> {
    return this.executionDone;
  }

  abstract startExecution(): Promise<void>;

  /** Convenience: emit a typed ArenaEvent to all listeners. */
  protected emitArenaEvent(event: ArenaEvent): void {
    this.emit('arenaEvent', event);
  }

  /**
   * Emit an ERROR arena event so the UI shows the failure inline in the lane.
   * Also emits 'error' on the EventEmitter so the runner can transition to FAILED.
   */
  protected emitErrorEvent(message: string): void {
    this.emitArenaEvent({
      eventId: randomUUID(),
      competitionId: this.competitionId,
      teamId: this.teamId,
      timestamp: new Date().toISOString(),
      type: EventType.ERROR,
      payload: { error: message },
      metadata: {},
    });
    this.emit('error', new Error(message));
  }

  /**
   * Clean up the temp workdir after the competition ends.
   * No-op if sandbox is active (container teardown handles it).
   * Safe to call even if workdir doesn't exist.
   */
  async cleanupWorkdir(): Promise<void> {
    if (this.sandbox) return; // container teardown handles cleanup
    await rm(this.workdir, { recursive: true, force: true }).catch(() => {});
  }
}
