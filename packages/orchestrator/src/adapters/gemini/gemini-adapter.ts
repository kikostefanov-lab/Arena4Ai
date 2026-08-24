import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventType } from '@arena/shared';
import { BaseAdapter } from '../base-adapter.js';
import { normalizeLine } from './gemini-normalizer.js';
import { claudeEnv } from '../../utils/claude-env.js';
import { safeModelVariant } from '../model-variant.js';
import { ERROR_LINE_RE, makeEvent } from '../normalizer-utils.js';
import { getDefaultModel } from '../model-registry.js';
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
    this.modelVariant = options.modelVariant ?? getDefaultModel('gemini');
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('GeminiAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };

    this.executionDone = new Promise<void>((resolve, reject) => {
      // gemini -p <prompt> --yolo -o stream-json
      //   --yolo          non-interactive, auto-approve all tools (a competitor
      //                   agent genuinely needs to write files)
      //   -o stream-json  structured JSONL on stdout, one event per line.
      //
      // AA-037: without stream-json the CLI narrates in prose, so the normalizer
      // could only infer a file operation from a verb in an English sentence —
      // which made gemini the one provider whose edit counts could not be trusted.
      // Verified in gemini-cli 0.38.2: StreamJsonFormatter.emitEvent() calls
      // process.stdout.write() once per event, so this streams incrementally and
      // the live arena keeps updating. Requires gemini-cli >= 0.38; the normalizer
      // falls back to prose parsing for any line that is not a stream-json event.
      //
      // SECURITY: spawn with an argv array, never through `/bin/sh -c`. The model
      // variant and the prompt are user-supplied; as argv entries they can only
      // ever be one argument each, whatever characters they contain.
      const args = ['-p', this.promptText!, '--yolo', '-o', 'stream-json'];
      const modelVariant = safeModelVariant(this.modelVariant);
      if (modelVariant) {
        args.push('--model', modelVariant);
      }

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.geminiBin,
            args,
            claudeEnv(),
          )
        : spawn(
            this.geminiBin,
            args,
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
        if (code === 0 || code === null) resolve();
        else reject(new Error(`Gemini process exited with code ${code}`));
      });

      child.on('error', (err) => {
        rl.close();
        errRl.close();
        this.process = null;
        this.emitErrorEvent(`Failed to start Gemini: ${err.message}`);
        reject(err);
      });
    });
  }
}
