import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { readdir, readFile, stat, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventType, type ArenaEvent, type Brief, type Deliverable, type ModelAdapter } from '@arena/shared';
import type { SandboxManager } from '../sandbox/sandbox-manager.js';
import { stripAnsi, makeEvent, makeFileEvent } from './normalizer-utils.js';
import { squadLimits } from './squad-limits.js';
import { WorkdirWatcher, type WatchedFile } from './workdir-watcher.js';

export const MAX_FILE_BYTES = 500 * 1024;   // 500 KB per file
const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5 MB across all files

/** stderr lines kept per agent for a crash report. */
const STDERR_TAIL_LINES = 40;

/**
 * An agent CLI that exited non-zero on its own, before Arena stopped it — a bad
 * model id, an expired login, a rate limit. Recorded so the run can report it
 * and leave the team unscored, instead of judging an empty workdir as a 0% loss.
 */
export interface AgentFailure {
  exitCode: number;
  /** The CLI's own error message where it could be found, else a generic one. */
  message: string;
  /** Last stderr lines, for the event log. */
  detail: string;
}

/**
 * Pick the most useful line out of an agent CLI's stderr. Codex prints
 * `ERROR: {"type":"error",...,"error":{"message":"..."}}`, the others print
 * plain `Error: ...` lines; MCP/transport noise also says ERROR, so a line that
 * starts with `ERROR:` wins over a looser match, and the last line is the
 * fallback.
 */
export function summarizeAgentError(lines: string[]): string | undefined {
  const fromJson = (text: string): string => {
    const start = text.indexOf('{');
    if (start < 0) return text;
    try {
      const obj = JSON.parse(text.slice(start)) as { message?: unknown; error?: { message?: unknown } | string };
      const err = obj.error;
      if (typeof err === 'string') return err;
      if (err && typeof err.message === 'string') return err.message;
      if (typeof obj.message === 'string') return obj.message;
    } catch { /* not JSON */ }
    return text;
  };
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^ERROR:\s*(.+)$/.exec(lines[i]!);
    if (m) return fromJson(m[1]!).trim();
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(?:error|fatal)\b[:\s]\s*(.+)$/i.exec(lines[i]!);
    if (m) return fromJson(m[1]!).trim();
  }
  // Nothing labelled as an error (gemini's "not running in a trusted directory"
  // isn't): a CLI that exits non-zero usually says why on its last line.
  return lines.at(-1);
}

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
  private child: ChildProcess | null = null;
  /**
   * The agent's CLI process. Assigning it also arranges for the agent's whole
   * process group to be killed the moment the CLI itself exits: an agent can
   * start a background server with redirected stdio and then exit normally, and
   * the subclasses clear this field in their `close` handlers, so by the time
   * `shutdown()` runs there would be nothing left to signal. Sweeping at exit
   * (rather than remembering the group id for later) also avoids signalling a
   * recycled pid.
   */
  protected get process(): ChildProcess | null { return this.child; }
  protected set process(next: ChildProcess | null) {
    this.child = next;
    const pid = next?.pid;
    if (!next || pid === undefined || process.platform === 'win32') return;
    next.once('exit', () => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* no surviving group members */ }
    });
  }
  protected executionDone: Promise<void> = Promise.resolve();
  private stderrTail: string[] = [];
  /** Set once shutdown() starts: an exit after that is ours, not a crash. */
  private stopping = false;
  private agentFailure: AgentFailure | null = null;

  /** Non-null when the agent CLI exited with an error on its own. */
  get failure(): AgentFailure | null {
    return this.agentFailure;
  }
  /** Grace period between SIGTERM and SIGKILL in shutdown(). */
  shutdownGraceMs = Number(process.env.ARENA_SHUTDOWN_GRACE_MS) || DEFAULT_SHUTDOWN_GRACE_MS;

  private readonly openSubAgents = new Set<string>();
  private readonly closedSubAgents = new Set<string>();
  /** Set once shutdown() has run its final close: no new sub-agent may open. */
  private sealed = false;
  private watcher: WorkdirWatcher | null = null;

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
      [
        '[SQUAD]',
        `You are the lead of a squad. Delegate independent parts of this brief to sub-agents running`,
        `in parallel (up to ${squadLimits().maxConcurrent} at a time), and integrate their results yourself.`,
        '1. First, write a skeleton of every named deliverable, so something exists if time runs out.',
        '2. Give each sub-agent one clear task, the file it must write, and a time box well inside',
        '   the time limit. Sub-agents work in this same directory.',
        '3. Finish integrating and writing final deliverables before 80% of the time limit.',
        'Only files in this directory are judged.',
      ].join('\n'),
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
    this.stopping = true;
    this.watcher?.stop();
    if (this.sandbox) {
      // Kills the container; the `docker run` client process is handled below.
      await this.sandbox.killContainer(this.teamId).catch(() => {});
    }
    const child = this.process;
    if (!child) {
      liveAdapters.delete(this);
      this.closeOpenSubAgents('killed', 'deadline');
      this.sealed = true;
      return;
    }

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
    this.closeOpenSubAgents('killed', 'deadline');
    this.sealed = true;
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

  /** Subclasses feed every stderr line here so a crash can be explained. */
  protected noteStderr(line: string): void {
    // CLIs colour their errors (gemini wraps its message in \x1b[31m…).
    const clean = stripAnsi(line).trim();
    if (!clean) return;
    this.stderrTail.push(clean);
    if (this.stderrTail.length > STDERR_TAIL_LINES) this.stderrTail.shift();
  }

  /**
   * Handle the agent CLI's exit. A non-zero exit before shutdown() is recorded
   * as `failure` and reported as an ERROR event (stage 'agent') naming the CLI's
   * own message. `done` still resolves: the failure is data the runner reads,
   * not a rejection nobody awaits.
   */
  protected settleExit(code: number | null, cliName: string, resolve: () => void): void {
    if (!this.stopping) this.closeOpenSubAgents('unknown', 'lead exited without reporting');
    if (code === 0 || code === null || this.stopping) {
      resolve();
      return;
    }
    const cause = summarizeAgentError(this.stderrTail);
    const message = cause
      ? `${cliName} exited with code ${code}: ${cause}`
      : `${cliName} exited with code ${code} before producing a result`;
    this.agentFailure = { exitCode: code, message, detail: this.stderrTail.join('\n').slice(-4000) };
    this.emitArenaEvent({
      eventId: randomUUID(),
      competitionId: this.competitionId,
      teamId: this.teamId,
      timestamp: new Date().toISOString(),
      type: EventType.ERROR,
      payload: { stage: 'agent', error: message, exitCode: code, detail: this.agentFailure.detail },
      metadata: {},
    });
    console.error(`[arena] ${this.teamId}: ${message}`);
    resolve();
  }

  /** Resolves when the CLI process exits (useful in tests and the competition race). */
  get done(): Promise<void> {
    return this.executionDone;
  }

  abstract startExecution(): Promise<void>;

  /** Convenience: emit a typed ArenaEvent to all listeners. */
  protected emitArenaEvent(event: ArenaEvent): void {
    // Each sub-agent gets exactly one SPAWN and one DONE, whatever the CLI reports.
    if (event.type === EventType.SUB_AGENT_SPAWN) {
      const id = (event.payload as { agentId: string }).agentId;
      // Trailing stdout after shutdown must not open a member nothing will close.
      if (this.sealed || this.openSubAgents.has(id) || this.closedSubAgents.has(id)) return;
      this.openSubAgents.add(id);
    } else if (event.type === EventType.SUB_AGENT_DONE) {
      const id = (event.payload as { agentId: string }).agentId;
      if (this.closedSubAgents.has(id)) return;
      this.openSubAgents.delete(id);
      this.closedSubAgents.add(id);
    }
    if (
      (event.type === EventType.FILE_CREATE || event.type === EventType.FILE_MODIFY) &&
      (event.payload as { opSource?: string }).opSource !== 'watch'
    ) {
      const path = (event.payload as { path?: string }).path;
      if (path) this.watcher?.noteStreamPath(path);
    }
    this.emit('arenaEvent', event);
  }

  /**
   * Poll the workdir for files the CLI's stream never reports (sub-agents write
   * straight to disk). Call right after spawning; shutdown() stops it.
   */
  protected startWorkdirWatch(): void {
    this.watcher?.stop();
    this.watcher = new WorkdirWatcher({ root: this.workdir, onFile: (f) => this.onWatchedFile(f) });
    this.watcher.start();
  }

  protected onWatchedFile(f: WatchedFile): void {
    const event = makeFileEvent(
      { op: f.op, opSource: 'watch', path: f.path, text: f.path },
      { competitionId: this.competitionId, teamId: this.teamId },
    );
    if (this.openSubAgentCount > 0) event.metadata.squad = true;
    this.emitArenaEvent(event);
  }

  /** Sub-agents spawned and not yet reported done. */
  get openSubAgentCount(): number {
    return this.openSubAgents.size;
  }

  /** Emit a DONE for every sub-agent still open, so no lifecycle is left dangling. */
  protected closeOpenSubAgents(status: 'killed' | 'unknown', reason: string): void {
    const ctx = { competitionId: this.competitionId, teamId: this.teamId };
    for (const agentId of [...this.openSubAgents]) {
      this.emitArenaEvent(makeEvent(EventType.SUB_AGENT_DONE, { agentId, status, reason }, ctx));
    }
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
