import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Brief } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { ClaudeNormalizer, normalizeLine } from './claude-normalizer.js';
import { claudeIsolationArgs, competitorEnv } from '../isolation.js';
import { squadLimits } from '../squad-limits.js';
import { safeModelVariant } from '../model-variant.js';
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
  /** Optional model variant to pass as --model flag to the CLI. */
  modelVariant?: string;
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
  private modelVariant?: string;

  constructor(teamId: string, options: ClaudeAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.claudeBin = options.claudeBin ?? 'claude';
    this.modelVariant = options.modelVariant;
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('ClaudeAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };
    const normalizer = new ClaudeNormalizer(ctx);
    const { maxConcurrent, maxDepth } = squadLimits();
    const agentEnv = {
      ...competitorEnv(),
      CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(maxConcurrent),
      CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: String(maxDepth),
    };

    this.executionDone = new Promise<void>((resolve, reject) => {
      const claudeArgs = [
        '--print', '-',
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        ...claudeIsolationArgs(),
      ];

      const modelVariant = safeModelVariant(this.modelVariant);
      if (modelVariant) {
        claudeArgs.push('--model', modelVariant);
      }

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.claudeBin,
            claudeArgs,
            agentEnv,
            { stdin: true }, // prompt is piped on stdin below
          )
        : spawn(
            this.claudeBin,
            claudeArgs,
            {
              cwd: this.workdir,
              stdio: ['pipe', 'pipe', 'pipe'],
              // Own process group so shutdown() can signal the agent's children too.
              detached: process.platform !== 'win32',
              env: agentEnv,
            },
          );

      this.process = child;
      this.startWorkdirWatch();

      // Pipe prompt via stdin to avoid CLI arg length limits
      if (child.stdin) {
        // A container (or process) that exits early would otherwise raise an
        // unhandled EPIPE here; the close/error handlers below report the failure.
        child.stdin.on('error', () => {});
        child.stdin.write(this.promptText);
        child.stdin.end();
      }

      // Stream stdout line-by-line through the normalizer.
      const rl = createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        for (const event of this.normalizeSafely(line, (l) => normalizer.addLine(l))) this.emitArenaEvent(event);
        // Claude reports API failures (unknown model, auth, rate limit) as
        // stream-json on stdout; keep them so a crash can be explained.
        const failure = claudeStreamError(line);
        if (failure) this.noteStderr(`Error: ${failure}`);
      });

      // Forward stderr as ERROR events.
      const errRl = createInterface({ input: child.stderr! });
      errRl.on('line', (line) => {
        if (!line.trim()) return;
        this.noteStderr(line);
        const events = this.normalizeSafely(
          JSON.stringify({ type: 'error', error: { message: line } }),
          (l) => normalizeLine(l, ctx),
        );
        for (const event of events) this.emitArenaEvent(event);
      });

      child.on('close', (code) => {
        this.process = null;
        this.settleExit(code, 'Claude', resolve);
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

/** The error text of a stream-json `error` line or an `is_error` result, if any. */
export function claudeStreamError(line: string): string | undefined {
  let msg: Record<string, unknown>;
  try { msg = JSON.parse(line) as Record<string, unknown>; } catch { return undefined; }
  if (msg.type === 'result' && msg.is_error === true) {
    return typeof msg.result === 'string' && msg.result ? msg.result : 'Claude reported an error result';
  }
  if (msg.type === 'error') {
    const err = msg.error as { message?: unknown } | string | undefined;
    if (typeof err === 'string') return err;
    if (err && typeof err.message === 'string') return err.message;
  }
  return undefined;
}
