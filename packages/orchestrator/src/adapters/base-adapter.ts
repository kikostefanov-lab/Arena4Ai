import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readdir, readFile, stat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventType, type ArenaEvent, type Brief, type Deliverable, type ModelAdapter } from '@arena/shared';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';

const MAX_FILE_BYTES = 500 * 1024;   // 500 KB per file
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB across all files

/** Default time an agent gets to exit after SIGTERM before it is SIGKILLed. */
const DEFAULT_SHUTDOWN_GRACE_MS = 5_000;
/** How long to wait for the exit after SIGKILL before giving up. */
const KILL_WAIT_MS = 2_000;

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
/**
 * Every adapter that may still own a process. Agents are spawned `detached`
 * (their own process group, so a shutdown reaches their children), which also
 * means a terminal Ctrl-C no longer reaches them. Whoever owns the process
 * lifetime (the CLI) must call `shutdownAllAdapters()` before exiting.
 */
const liveAdapters = new Set<BaseAdapter>();

/** Stop every agent this process has started and wait for them to exit. */
export async function shutdownAllAdapters(): Promise<void> {
  await Promise.all([...liveAdapters].map((a) => a.shutdown().catch(() => {})));
}

export abstract class BaseAdapter extends EventEmitter implements ModelAdapter {
  readonly teamId: string;
  protected readonly workdir: string;
  protected readonly competitionId: string;
  protected readonly sandbox?: SandboxManager;

  protected promptText = '';
  protected process: ChildProcess | null = null;
  protected executionDone: Promise<void> = Promise.resolve();
  /** Grace period between SIGTERM and SIGKILL in shutdown(). */
  shutdownGraceMs = Number(process.env.ARENA_SHUTDOWN_GRACE_MS) || DEFAULT_SHUTDOWN_GRACE_MS;

  constructor(teamId: string, workdir: string, competitionId: string, sandbox?: SandboxManager) {
    super();
    this.teamId = teamId;
    this.workdir = workdir;
    this.competitionId = competitionId;
    this.sandbox = sandbox;
    liveAdapters.add(this);
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

  /**
   * Stop the agent and wait until it is really gone.
   *
   * SIGTERM first (to the whole process group when the child was spawned
   * `detached`, so tools the agent started die with it), then SIGKILL after
   * `shutdownGraceMs`. Resolves only once the process has exited (or, as a last
   * resort, after a bounded wait following SIGKILL), so callers can collect
   * files or delete the workdir without racing a live writer. Idempotent.
   */
  async shutdown(): Promise<void> {
    if (this.sandbox) {
      // Kills the container; the `docker run` client process is handled below.
      await this.sandbox.killContainer(this.teamId).catch(() => {});
    }
    const child = this.process;
    if (!child) { liveAdapters.delete(this); return; }

    const hasExited = () => child.exitCode !== null || child.signalCode !== null;
    const exited = new Promise<void>((resolve) => {
      if (hasExited()) return resolve();
      child.once('exit', () => resolve());
      child.once('error', () => resolve());
    });
    const waitFor = (ms: number) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), ms);
        void exited.then(() => { clearTimeout(timer); resolve(true); });
      });

    if (!hasExited()) {
      this.signalProcess(child, 'SIGTERM');
      if (!(await waitFor(this.shutdownGraceMs))) {
        this.signalProcess(child, 'SIGKILL');
        await waitFor(KILL_WAIT_MS);
      }
    }
    // The leader is gone; sweep any member of its group that outlived it.
    this.signalProcess(child, 'SIGKILL', true);
    this.process = null;
    liveAdapters.delete(this);
  }

  /** Signal the process group when we own one (`detached` spawn), else just the child. */
  private signalProcess(child: ChildProcess, signal: NodeJS.Signals, groupOnly = false): void {
    const pid = child.pid;
    if (pid !== undefined && process.platform !== 'win32') {
      try {
        process.kill(-pid, signal);
        return;
      } catch { /* not a group leader (or already gone) — fall through */ }
    }
    if (!groupOnly) {
      try { child.kill(signal); } catch { /* already gone */ }
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
   * Remove the host workdir after the competition ends. In sandbox mode this is
   * still the directory that was bind-mounted into the container (the container
   * itself is `--rm`), so it must be removed here too. Call after shutdown().
   * Safe to call even if the workdir doesn't exist; best-effort (files written
   * by a root-owned container may not be removable by the host user).
   */
  async cleanupWorkdir(): Promise<void> {
    await rm(this.workdir, { recursive: true, force: true }).catch(() => {});
  }
}
