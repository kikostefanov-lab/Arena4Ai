import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArenaEvent, Brief, Deliverable, ModelAdapter } from '@arena/shared';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';

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
        ? `\nConstraints:\n${brief.constraints.map((c) => `- ${c}`).join('\n')}`
        : '';

    const deliverables = brief.deliverables.map((d) => `- ${d}`).join('\n');

    this.promptText = [
      `[PERSONA]\n${persona}`,
      `[BRIEF: ${brief.title}]`,
      brief.problem,
      constraints,
      `[DELIVERABLES]\n${deliverables}`,
      `[TIME LIMIT] ${Math.round(brief.timeLimitMs / 60_000)} minutes`,
    ]
      .filter(Boolean)
      .join('\n\n');

    return Promise.resolve();
  }

  async collectDeliverables(): Promise<Deliverable> {
    let files: Array<{ path: string; content: string }> = [];
    try {
      const entries = await readdir(this.workdir, { withFileTypes: true });
      files = await Promise.all(
        entries
          .filter((e) => e.isFile())
          .map(async (e) => ({
            path: e.name,
            content: await readFile(join(this.workdir, e.name), 'utf-8'),
          })),
      );
    } catch {
      // workdir may not exist if sandbox was skipped
    }

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
}
