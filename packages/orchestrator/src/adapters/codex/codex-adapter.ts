import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './codex-normalizer.js';
import { claudeEnv } from '../../utils/claude-env.js';
import type { SandboxManager } from '../../sandbox/sandbox-manager.js';

export interface CodexAdapterOptions {
  /** Working directory for the Codex process (the sandbox root). */
  workdir: string;
  /** Competition ID — embedded in every emitted ArenaEvent. */
  competitionId: string;
  /**
   * Path to the codex CLI binary.
   * Defaults to 'codex' (expected on PATH).
   *
   * Install via: npm install -g @openai/codex
   * Expected invocation: codex --approval-mode full-auto "<prompt>"
   */
  codexBin?: string;
  /** Optional sandbox manager for Docker-based isolation. */
  sandbox?: SandboxManager;
}

/**
 * Adapter that spawns a `codex` CLI process, streams its stdout
 * through the normalizer, and emits ArenaEvents.
 *
 * NOTE: If the Codex CLI is not installed, startExecution() will reject.
 * Install with: npm install -g @openai/codex
 */
export class CodexAdapter extends BaseAdapter {
  private readonly codexBin: string;

  constructor(teamId: string, options: CodexAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.codexBin = options.codexBin ?? 'codex';
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('CodexAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    this.executionDone = new Promise<void>((resolve, reject) => {
      // codex exec <prompt>
      //   --skip-git-repo-check   — allow running in temp workdirs outside a git repo
      //   -s workspace-write      — allow writing files in the workdir
      const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', this.promptText];

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.codexBin,
            codexArgs,
            claudeEnv(),
          )
        : spawn(
            this.codexBin,
            codexArgs,
            {
              cwd: this.workdir,
              stdio: ['ignore', 'pipe', 'pipe'],
              env: claudeEnv(),
            },
          );

      this.process = child;

      const rl = createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        this.emitArenaEvent(normalizeLine(line, ctx));
      });

      const errRl = createInterface({ input: child.stderr! });
      errRl.on('line', (line) => {
        if (!line.trim()) return;
        this.emitArenaEvent(normalizeLine(`Error: ${line}`, ctx));
      });

      child.on('close', (code) => {
        this.process = null;
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Codex process exited with code ${code}`));
      });

      child.on('error', (err) => {
        this.process = null;
        reject(err);
      });
    });
  }
}
