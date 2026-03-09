import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import type { Brief, Deliverable } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './claude-normalizer.js';

export interface ClaudeAdapterOptions {
  /** Working directory for the Claude Code process (the sandbox root). */
  workdir: string;
  /** Competition ID — embedded in every emitted ArenaEvent. */
  competitionId: string;
  /**
   * Path to the claude CLI binary.
   * Defaults to 'claude' (expected on PATH).
   */
  claudeBin?: string;
}

/**
 * Adapter that spawns a `claude` CLI process, streams its JSON-lines
 * stdout through the normalizer, and emits ArenaEvents.
 *
 * Lifecycle:
 *   1. new ClaudeAdapter(teamId, options)
 *   2. adapter.injectBrief(brief, persona)   — prepares the prompt
 *   3. adapter.startExecution()              — spawns the process
 *   4. listen to adapter.on('arenaEvent', …)
 *   5. adapter.collectDeliverables()        — called after TIME_UP
 *   6. adapter.shutdown()                   — kills process if still running
 */
export class ClaudeAdapter extends BaseAdapter {
  private readonly workdir: string;
  private readonly competitionId: string;
  private readonly claudeBin: string;

  private promptText = '';
  private process: ChildProcess | null = null;
  private executionDone: Promise<void> = Promise.resolve();

  constructor(teamId: string, options: ClaudeAdapterOptions) {
    super(teamId);
    this.workdir = options.workdir;
    this.competitionId = options.competitionId;
    this.claudeBin = options.claudeBin ?? 'claude';
  }

  async injectBrief(brief: Brief, persona: string): Promise<void> {
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
  }

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('ClaudeAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    this.executionDone = new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.claudeBin,
        [
          '--output-format', 'stream-json',
          '--no-interactive',
          '--print', this.promptText,
        ],
        {
          cwd: this.workdir,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      this.process = child;

      // Stream stdout line-by-line through the normalizer.
      const rl = createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        const event = normalizeLine(line, ctx);
        this.emitArenaEvent(event);
      });

      // Forward stderr as ERROR events.
      const errRl = createInterface({ input: child.stderr! });
      errRl.on('line', (line) => {
        if (!line.trim()) return;
        const event = normalizeLine(
          JSON.stringify({ type: 'error', error: { message: line } }),
          ctx,
        );
        this.emitArenaEvent(event);
      });

      child.on('close', (code) => {
        this.process = null;
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Claude process exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        this.process = null;
        reject(err);
      });
    });

    // We don't await here — the caller uses the emitted events + shutdown().
  }

  async collectDeliverables(): Promise<Deliverable> {
    // In a full implementation this would walk the sandbox filesystem.
    // For now, return a stub so the interface is satisfied and tests can stub it.
    return {
      teamId: this.teamId,
      files: [],
      collectedAt: new Date().toISOString(),
    };
  }

  async shutdown(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  /** Resolves when the claude process exits cleanly (useful in tests). */
  get done(): Promise<void> {
    return this.executionDone;
  }
}
