import { EventEmitter } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CompetitionState,
  EventType,
  type ArenaEvent,
  type Brief,
  type Competition,
  type Deliverable,
  type ScoreCard,
  type Team,
} from '@arena/shared';

import { transition } from './state-machine.js';
import { ClockManager } from './clock-manager.js';
import { BaseAdapter } from '../adapters/base-adapter.js';
import { ClaudeAdapter } from '../adapters/claude/claude-adapter.js';
import { CodexAdapter } from '../adapters/codex/codex-adapter.js';
import { GeminiAdapter } from '../adapters/gemini/gemini-adapter.js';
import { resolvePersona } from '../adapters/claude/claude-personas.js';
import { SandboxManager } from '../sandbox/sandbox-manager.js';
import { EventLogger } from '../events/event-logger.js';
import { scoreDeliverable } from '../judging/rubric-scorer.js';
import { aiJudge, JUDGE_IDS } from '../judging/ai-judge.js';
import { aggregate } from '../judging/score-aggregator.js';
import { printResults } from '../judging/results-reporter.js';

export interface RunOptions {
  /** Directory where JSONL event logs are written. Defaults to OS tmp dir. */
  logDir?: string;
  /** Docker image for sandboxes. Defaults to 'node:20-alpine'. */
  sandboxImage?: string;
  /** Path to the claude CLI binary. */
  claudeBin?: string;
  /** Path to the codex CLI binary. Defaults to 'codex'. */
  codexBin?: string;
  /** Path to the gemini CLI binary. Defaults to 'gemini'. */
  geminiBin?: string;
  /** If true, print a formatted results table to stdout after judging. */
  printResults?: boolean;
  /**
   * Skip Docker sandbox creation (useful when Docker is not running).
   * Adapters still run in a local temp directory.
   */
  skipSandbox?: boolean;
}

export interface CompetitionResult {
  competition: Competition;
  scorecards: ScoreCard[];
  winner: string | null;
}

/**
 * Orchestrates the full competition lifecycle:
 *
 *   DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP
 *         → COLLECTING → JUDGING → SCORED → COMPLETE
 *
 * Events emitted (extends EventEmitter):
 *   'stateChange'  (state: CompetitionState)
 *   'arenaEvent'   (event: ArenaEvent)          — forwarded from all adapters
 *   'result'       (result: CompetitionResult)  — final result
 *   'error'        (err: Error)
 */
export class CompetitionRunner extends EventEmitter {
  private competition: Competition;
  private readonly options: Required<RunOptions>;
  private _cancelled = false;
  private _cancelResolve?: () => void;
  private _activeAdapters: BaseAdapter[] = [];
  private _clock?: ClockManager;

  constructor(brief: Brief, teams: [Team, Team], options: RunOptions = {}) {
    super();

    this.competition = {
      id: randomUUID(),
      brief,
      teams,
      state: CompetitionState.DRAFT,
    };

    this.options = {
      logDir: options.logDir ?? tmpdir(),
      sandboxImage: options.sandboxImage ?? 'node:20-alpine',
      claudeBin: options.claudeBin ?? 'claude',
      codexBin: options.codexBin ?? 'codex',
      geminiBin: options.geminiBin ?? 'gemini',
      printResults: options.printResults ?? true,
      skipSandbox: options.skipSandbox ?? false,
    };
  }

  /** The competition's unique ID — same value embedded in every ArenaEvent. */
  get competitionId(): string {
    return this.competition.id;
  }

  private advance(to: CompetitionState): void {
    this.competition.state = transition(this.competition.state, to);
    this.emit('stateChange', this.competition.state);
  }

  /** Cancel the running competition — shuts down all adapters and stops the clock. */
  async cancel(): Promise<void> {
    this._cancelled = true;
    this._cancelResolve?.(); // unblock the run() Promise.race
    this._clock?.stop();
    for (const adapter of this._activeAdapters) {
      await adapter.shutdown();
    }
  }

  /** Pause the running competition — freezes the clock (adapters keep running). */
  pause(): void {
    this._clock?.pause();
  }

  /** Resume a paused competition — restores the clock. */
  resume(): void {
    this._clock?.resume();
  }

  /** Run the competition end-to-end and return the result. */
  async run(): Promise<CompetitionResult> {
    const { brief, teams } = this.competition;
    let sandboxManager: SandboxManager | undefined;
    if (!this.options.skipSandbox) {
      sandboxManager = new SandboxManager();
      await sandboxManager.verify();
    }
    const logger = new EventLogger(this.options.logDir, this.competition.id);

    await logger.open();

    const forwardEvent = (event: ArenaEvent) => {
      logger.log(event).catch(() => {/* ignore log errors */});
      this.emit('arenaEvent', event);
    };

    try {
      // ── CONFIGURED ──────────────────────────────────────────────────────
      this.advance(CompetitionState.CONFIGURED);

      // ── LAUNCHING ────────────────────────────────────────────────────────
      this.advance(CompetitionState.LAUNCHING);

      const workdirs: Record<string, string> = {};
      const adapters: BaseAdapter[] = [];

      for (const team of teams) {
        const workdir = await mkdtemp(join(tmpdir(), `arena-${team.id}-`));
        workdirs[team.id] = workdir;

        // Route by model prefix: claude:* → ClaudeAdapter, codex:* → CodexAdapter, gemini:* → GeminiAdapter
        const [provider, personaId] = team.model.split(':');
        const persona = resolvePersona(
          personaId ?? team.persona,
          brief.format,
        );

        let adapter: BaseAdapter;
        switch (provider) {
          case 'codex':
            adapter = new CodexAdapter(team.id, {
              workdir,
              competitionId: this.competition.id,
              codexBin: this.options.codexBin,
              sandbox: sandboxManager,
            });
            break;
          case 'gemini':
            adapter = new GeminiAdapter(team.id, {
              workdir,
              competitionId: this.competition.id,
              geminiBin: this.options.geminiBin,
              sandbox: sandboxManager,
            });
            break;
          case 'claude':
          default:
            adapter = new ClaudeAdapter(team.id, {
              workdir,
              competitionId: this.competition.id,
              claudeBin: this.options.claudeBin,
              sandbox: sandboxManager,
            });
        }

        adapter.on('arenaEvent', forwardEvent);
        await adapter.injectBrief(brief, persona.systemPrompt);
        adapters.push(adapter);
        this._activeAdapters.push(adapter);
      }

      // ── RUNNING ──────────────────────────────────────────────────────────
      this.advance(CompetitionState.RUNNING);
      this.competition.startedAt = new Date().toISOString();

      const clock = new ClockManager(brief.timeLimitMs);
      this._clock = clock;

      const raceFinished = new Promise<void>((resolve) => {
        clock.on(EventType.TIME_UP, () => resolve());
      });

      // Start all adapters concurrently; errors are logged but don't crash the run.
      await Promise.all(adapters.map((a) => a.startExecution()));
      clock.start();

      // Also resolve when all adapters finish early (success or failure).
      const allAdaptersDone = Promise.allSettled(
        adapters.map((a) => a.done),
      ).then(() => undefined);

      const cancelPromise = new Promise<void>((resolve) => {
        this._cancelResolve = resolve;
      });
      await Promise.race([raceFinished, allAdaptersDone, cancelPromise]);

      // ── TIME_UP / COLLECTING ─────────────────────────────────────────────
      this.advance(CompetitionState.TIME_UP);
      this.advance(CompetitionState.COLLECTING);

      clock.stop();
      const deliverables: Deliverable[] = await Promise.all(
        adapters.map((a) => a.collectDeliverables()),
      );

      // ── JUDGING ──────────────────────────────────────────────────────────
      this.advance(CompetitionState.JUDGING);

      // Run automated scorer (sync) + AI cross-judge (async) in parallel across all deliverables
      console.log('[arena] judging with automated scorer + AI cross-judge...');
      const judgeResults = await Promise.all([
        ...deliverables.map((d) => scoreDeliverable(JUDGE_IDS.automated, d, brief.rubric, brief)),
        ...deliverables.map((d) => aiJudge(d, brief.rubric, {
          judgeId: JUDGE_IDS.aiClaude,
          claudeBin: this.options.claudeBin,
        })),
      ]);

      const scorecards = aggregate(judgeResults);

      // ── SCORED / COMPLETE ─────────────────────────────────────────────────
      this.advance(CompetitionState.SCORED);
      this.advance(CompetitionState.COMPLETE);
      this.competition.completedAt = new Date().toISOString();

      if (this.options.printResults) {
        printResults(brief, scorecards);
      }

      const result: CompetitionResult = {
        competition: { ...this.competition },
        scorecards,
        winner: scorecards.find((c) => c.rank === 1)?.teamId ?? null,
      };

      this.emit('result', result);
      return result;
    } finally {
      await logger.close();
    }
  }
}
