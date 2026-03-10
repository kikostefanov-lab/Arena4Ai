import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Brief } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './claude-normalizer.js';
import { claudeEnv } from '../../utils/claude-env.js';
import type { SandboxManager } from '../../sandbox/sandbox-manager.js';

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
  /** Optional sandbox manager for Docker-based isolation. */
  sandbox?: SandboxManager;
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
  private readonly claudeBin: string;

  constructor(teamId: string, options: ClaudeAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.claudeBin = options.claudeBin ?? 'claude';
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('ClaudeAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    this.executionDone = new Promise<void>((resolve, reject) => {
      const claudeArgs = [
        '--print', this.promptText,
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
      ];

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.claudeBin,
            claudeArgs,
            claudeEnv(),
          )
        : spawn(
            this.claudeBin,
            claudeArgs,
            {
              cwd: this.workdir,
              stdio: ['ignore', 'pipe', 'pipe'],
              env: claudeEnv(),
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
        this.emitErrorEvent(`Failed to start Claude: ${err.message}`);
        reject(err);
      });
    });

    // We don't await here — the caller uses the emitted events + shutdown().
  }
}

// Re-export for convenience — callers that only need the Brief type
export type { Brief };
