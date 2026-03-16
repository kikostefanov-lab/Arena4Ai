import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventType } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './gemini-normalizer.js';
import { claudeEnv } from '../../utils/claude-env.js';
import { ERROR_LINE_RE, makeEvent } from '../normalizer-utils.js';
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
  /** Optional model variant to pass as --model flag to the CLI. */
  modelVariant?: string;
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
  private modelVariant?: string;

  constructor(teamId: string, options: GeminiAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.geminiBin = options.geminiBin ?? 'gemini';
    this.modelVariant = options.modelVariant;
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('GeminiAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    // Write prompt to a temp .md file and pass the path to gemini -p
    // This avoids CLI arg length limits with the richer Sprint 5 briefs
    const promptFile = join(tmpdir(), `arena-gemini-${this.teamId}-${Date.now()}.md`);
    writeFileSync(promptFile, this.promptText, 'utf-8');

    this.executionDone = new Promise<void>((resolve, reject) => {
      // gemini -p <prompt> --yolo  — non-interactive, auto-approve all tools
      // Read prompt from temp file via shell command substitution to avoid arg length issues
      const sandboxGeminiArgs = ['-p', this.promptText, '--yolo'];
      if (this.modelVariant) {
        sandboxGeminiArgs.push('--model', this.modelVariant);
      }

      const modelFlag = this.modelVariant ? ` --model ${this.modelVariant}` : '';

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.geminiBin,
            sandboxGeminiArgs,
            claudeEnv(),
          )
        : spawn(
            '/bin/sh',
            ['-c', `"${this.geminiBin}" -p "$(cat "${promptFile}")" --yolo${modelFlag}`],
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
        const clean = line.trim();
        if (!clean) return;
        // Only surface stderr lines that are genuine errors; drop startup noise silently.
        if (ERROR_LINE_RE.test(clean)) {
          this.emitArenaEvent(makeEvent(EventType.ERROR, { error: clean }, ctx));
        }
      });

      child.on('close', (code) => {
        rl.close();
        errRl.close();
        this.process = null;
        try { unlinkSync(promptFile); } catch { /* ignore */ }
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Gemini process exited with code ${code}`));
      });

      child.on('error', (err) => {
        rl.close();
        errRl.close();
        this.process = null;
        try { unlinkSync(promptFile); } catch { /* ignore */ }
        this.emitErrorEvent(`Failed to start Gemini: ${err.message}`);
        reject(err);
      });
    });
  }
}
