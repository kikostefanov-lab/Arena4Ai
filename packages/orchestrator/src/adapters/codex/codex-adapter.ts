import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { BaseAdapter } from '../base-adapter.js';
import { CodexJsonNormalizer } from './codex-json-normalizer.js';
import { squadLimits } from '../squad-limits.js';
import { claudeEnv } from '../../utils/claude-env.js';
import { safeModelVariant } from '../model-variant.js';
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
  /** Optional model variant to pass as -m flag to the CLI. */
  modelVariant?: string;
}

/**
 * Argv for `codex exec`. SECURITY: an argv array, never `/bin/sh -c`; the model
 * variant and the prompt are user-supplied and stay one argument each.
 *
 *   --json                     JSONL events on stdout (what CodexJsonNormalizer reads)
 *   features.multi_agent_v2    off: the v1 collab tools report receiver ids we can follow
 *   network_access / web_search  agents may fetch and search, as Claude's can
 *   max_concurrent_threads_per_session  the squad cap (ARENA_SQUAD_MAX_CONCURRENT)
 */
export function codexArgs(prompt: string, modelVariant?: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const { maxConcurrent } = squadLimits(env);
  const args = [
    'exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write',
    '-c', 'features.multi_agent_v2=false',
    '-c', 'sandbox_workspace_write.network_access=true',
    '-c', 'web_search=live',
    '-c', `agents.max_concurrent_threads_per_session=${maxConcurrent}`,
  ];
  const variant = safeModelVariant(modelVariant);
  if (variant) args.push('-m', variant);
  args.push(prompt);
  return args;
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
  private modelVariant?: string;

  constructor(teamId: string, options: CodexAdapterOptions) {
    super(teamId, options.workdir, options.competitionId, options.sandbox);
    this.codexBin = options.codexBin ?? 'codex';
    this.modelVariant = options.modelVariant;
  }

  // injectBrief, collectDeliverables, shutdown, done — inherited from BaseAdapter

  async startExecution(): Promise<void> {
    if (!this.promptText) {
      throw new Error('CodexAdapter: injectBrief() must be called before startExecution()');
    }

    const ctx = { competitionId: this.competitionId, teamId: this.teamId };
    const normalizer = new CodexJsonNormalizer(ctx);

    this.executionDone = new Promise<void>((resolve, reject) => {
      const args = codexArgs(this.promptText!, this.modelVariant);

      const child = this.sandbox
        ? this.sandbox.spawnInContainer(
            this.teamId,
            this.workdir,
            this.codexBin,
            args,
            claudeEnv(),
          )
        : spawn(
            this.codexBin,
            args,
            {
              cwd: this.workdir,
              stdio: ['ignore', 'pipe', 'pipe'],
              // Own process group so shutdown() can signal the agent's children too.
              detached: process.platform !== 'win32',
              env: claudeEnv(),
            },
          );

      this.process = child;
      this.startWorkdirWatch();

      // JSONL events arrive on stdout; stderr is progress chatter, kept only for crash summaries.
      const outRl = createInterface({ input: child.stdout! });
      outRl.on('line', (line) => {
        for (const event of normalizer.addLine(line)) this.emitArenaEvent(event);
      });
      const errRl = createInterface({ input: child.stderr! });
      errRl.on('line', (line) => this.noteStderr(line));

      child.on('close', (code) => {
        outRl.close();
        errRl.close();
        this.process = null;
        this.settleExit(code, 'Codex', resolve);
      });

      child.on('error', (err) => {
        outRl.close();
        errRl.close();
        this.process = null;
        this.emitErrorEvent(`Failed to start Codex: ${err.message}`);
        reject(err);
      });
    });
  }
}
