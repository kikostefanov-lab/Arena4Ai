import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './gemini-normalizer.js';
import { claudeEnv } from '../../utils/claude-env.js';
import type { SandboxManager } from '../../sandbox/sandbox-manager.js';

export interface GeminiAdapterOptions {
  /** Working directory for the Gemini process (the sandbox root). */
  workdir: string;
  /** Competition ID — embedded in every emitted ArenaEvent. */
  competitionId: string;
  /**
   * Path to the gemini CLI binary.
   * Defaults to 'gemini' (expected on PATH).
   *
   * Install via: npm install -g @google/gemini-cli
   * Expected invocation: gemini -p "<prompt>"
   */
  geminiBin?: string;
  /** Optional sandbox manager for Docker-based isolation. */
  sandbox?: SandboxManager;
}

/**
 * Adapter that spawns a `gemini` CLI process, streams its stdout
 * through the normalizer, and emits ArenaEvents.
 *
 * NOTE: If the Gemini CLI is not installed, startExecution() will reject.
 * Install with: npm install -g @google/gemini-cli
 */
export class GeminiAdapter extends BaseAdapter {
  private readonly geminiBin: string;

  constructor(teamId: string, options: GeminiAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.geminiBin = options.geminiBin ?? 'gemini';
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('GeminiAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    this.executionDone = new Promise<void>((resolve, reject) => {
      // gemini -p <prompt> --yolo  — non-interactive, auto-approve all tools
      const geminiArgs = ['-p', this.promptText, '--yolo'];

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.geminiBin,
            geminiArgs,
            claudeEnv(),
          )
        : spawn(
            this.geminiBin,
            geminiArgs,
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
        else reject(new Error(`Gemini process exited with code ${code}`));
      });

      child.on('error', (err) => {
        this.process = null;
        reject(err);
      });
    });
  }
}
