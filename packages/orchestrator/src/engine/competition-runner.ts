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
  type TeamPresentation,
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
import type { SynthesisResult } from '../synthesis/merge-engine.js';
import { generateAllPresentations } from '../presentation/presentation-generator.js';
import { CommentaryAgent } from '../commentary/commentary-agent.js';
import type { AgentRepository } from '../db/agent-repository.js';

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
  /** Number of AI judges per deliverable. Default 1. Max 2. */
  aiJudgeCount?: 1 | 2;
  /** Enable live AI commentary during the competition. Default false. */
  commentary?: boolean;
  /** Optional agent repository for DB-based persona resolution and stats updates after SCORED. */
  agentRepo?: AgentRepository;
}

export interface TeamDeliverable {
  teamId: string;
  files: { path: string; content: string }[];
}

export interface CompetitionResult {
  competition: Competition;
  scorecards: ScoreCard[];
  winner: string | null;
  presentations: TeamPresentation[];      // human-readable per-team findings
  synthesis: SynthesisResult | null;      // synthesized hybrid solution
  deliverables: TeamDeliverable[];
}

/**
 * Orchestrates the full competition lifecycle:
 *
 *   DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP
 *         → COLLECTING → PRESENTING → JUDGING → SCORED → COMPLETE
 *
 * Events emitted (extends EventEmitter):
 *   'stateChange'  (state: CompetitionState)
 *   'arenaEvent'   (event: ArenaEvent)          — forwarded from all adapters
 *   'result'       (result: CompetitionResult)  — final result
 *   'error'        (err: Error)
 */
export class CompetitionRunner extends EventEmitter {
  private competition: Competition;
  private readonly options: Required<Omit<RunOptions, 'agentRepo'>>;
  private readonly agentRepo?: AgentRepository;
  private _cancelled = false;
  private _cancelResolve?: () => void;
  private _activeAdapters: BaseAdapter[] = [];
  private _clock?: ClockManager;

  constructor(brief: Brief, teams: Team[], options: RunOptions = {}) {
    super();

    this.competition = {
      id: randomUUID(),
      brief,
      teams,
      state: CompetitionState.DRAFT,
    };

    this.agentRepo = options.agentRepo;

    this.options = {
      logDir: options.logDir ?? tmpdir(),
      sandboxImage: options.sandboxImage ?? 'node:20-alpine',
      claudeBin: options.claudeBin ?? 'claude',
      codexBin: options.codexBin ?? 'codex',
      geminiBin: options.geminiBin ?? 'gemini',
      printResults: options.printResults ?? true,
      skipSandbox: options.skipSandbox ?? false,
      aiJudgeCount: options.aiJudgeCount ?? 1,
      commentary: options.commentary ?? false,
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
    if (this._cancelled) return;
    this._cancelled = true;
    this._cancelResolve?.(); // unblock the run() Promise.race
    this._clock?.stop();
    await Promise.all(this._activeAdapters.map(a => a.shutdown()));
    if (
      this.competition.state !== CompetitionState.COMPLETE &&
      this.competition.state !== CompetitionState.FAILED
    ) {
      this.competition.state = CompetitionState.CANCELLED;
      this.competition.completedAt = new Date().toISOString();
      this.emit('stateChange', CompetitionState.CANCELLED);
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

    let commentaryAgent: CommentaryAgent | undefined;

    try {
      // ── CONFIGURED ──────────────────────────────────────────────────────
      this.advance(CompetitionState.CONFIGURED);


      // ── LAUNCHING ────────────────────────────────────────────────────────
      this.advance(CompetitionState.LAUNCHING);

      const adapters: BaseAdapter[] = await Promise.all(
        teams.map(async (team) => {
          const workdir = await mkdtemp(join(tmpdir(), `arena-${team.id}-`));

          // Route by model prefix: claude:* → ClaudeAdapter, codex:* → CodexAdapter, gemini:* → GeminiAdapter
          const [provider, personaId] = team.model.split(':');

          // Two-path persona resolution:
          // 1. New UI path: agentId → DB lookup
          // 2. Legacy/CLI path: provider + persona name → DB lookup → fallback to hardcoded
          let systemPrompt: string;

          if (team.agentId && this.agentRepo) {
            // New UI path: agentId → DB lookup
            const agent = await this.agentRepo.get(team.agentId);
            systemPrompt = agent?.persona?.systemPrompt
              ?? resolvePersona(personaId ?? team.persona, brief.format).systemPrompt;
          } else if (this.agentRepo) {
            // Legacy/CLI path: provider + persona name → DB lookup → fallback
            const pName = personaId ?? team.persona;
            const dbAgent = pName
              ? await this.agentRepo.getByProviderAndPersonaName(provider, pName)
              : null;
            if (dbAgent?.persona) {
              systemPrompt = dbAgent.persona.systemPrompt;
              if (!team.agentId) (team as any).agentId = dbAgent.id;
            } else {
              systemPrompt = resolvePersona(pName, brief.format).systemPrompt;
            }
          } else {
            // DB unavailable: fall back to hardcoded
            systemPrompt = resolvePersona(personaId ?? team.persona, brief.format).systemPrompt;
          }

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
          await adapter.injectBrief(brief, systemPrompt);
          return adapter;
        })
      );
      this._activeAdapters.push(...adapters);

      // ── RUNNING ──────────────────────────────────────────────────────────
      this.advance(CompetitionState.RUNNING);
      this.competition.startedAt = new Date().toISOString();

      if (this.options.commentary) {
        commentaryAgent = new CommentaryAgent(this, { claudeBin: this.options.claudeBin });
        commentaryAgent.start();
      }

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

      // ── PRESENTING ─────────────────────────────────────────────────────
      this.advance(CompetitionState.PRESENTING);
      console.log('[arena] generating human-readable presentations...');

      const teamModels = new Map(teams.map((t) => [t.id, t.model]));
      let presentations: TeamPresentation[] = [];
      try {
        presentations = await generateAllPresentations(
          brief,
          deliverables,
          teamModels,
          { claudeBin: this.options.claudeBin },
        );
      } catch (err) {
        console.error('[arena] presentation generation failed:', (err as Error).message);
      }

      // Emit presentation events for live UI
      for (const pres of presentations) {
        forwardEvent({
          eventId: randomUUID(),
          competitionId: this.competition.id,
          teamId: pres.teamId,
          timestamp: new Date().toISOString(),
          type: EventType.PRESENTATION_READY,
          payload: pres as unknown as Record<string, unknown>,
          metadata: {},
        });
      }

      // ── JUDGING ──────────────────────────────────────────────────────────
      this.advance(CompetitionState.JUDGING);

      // Run AI cross-judge (primary) + automated scorer (fallback) in parallel
      console.log('[arena] judging with AI cross-judge (automated scorer as fallback)...');
      const aiJudgePromises = deliverables.map((d) => aiJudge(d, brief.rubric, {
        judgeId: JUDGE_IDS.aiClaude,
        claudeBin: this.options.claudeBin,
      }));

      if (this.options.aiJudgeCount >= 2) {
        aiJudgePromises.push(
          ...deliverables.map((d) => aiJudge(d, brief.rubric, {
            judgeId: JUDGE_IDS.aiAdversarial,
            claudeBin: this.options.claudeBin,
          })),
        );
      }

      // Run both in parallel — automated results are only used if AI judge fails
      const [automatedResults, ...aiResults] = await Promise.all([
        Promise.all(deliverables.map((d) => scoreDeliverable(JUDGE_IDS.automated, d, brief.rubric, brief))),
        ...aiJudgePromises,
      ]);

      // Use AI judge results; fall back to automated per-team if AI returned zero scores
      const judgeResults: typeof aiResults = [];
      const aiByTeam = new Map<string, typeof aiResults>();
      for (const r of aiResults) {
        const existing = aiByTeam.get(r.teamId) ?? [];
        existing.push(r);
        aiByTeam.set(r.teamId, existing);
      }

      for (const automated of automatedResults) {
        const aiForTeam = aiByTeam.get(automated.teamId) ?? [];
        // AI judge failed if all its scores are 0 (the fallback default)
        const aiWorked = aiForTeam.some((r) =>
          r.scores.some((s) => s.score > 0 || !s.commentary.includes('fallback')),
        );
        if (aiWorked) {
          judgeResults.push(...aiForTeam);
        } else {
          console.log(`[arena] AI judge failed for ${automated.teamId} — using automated scorer`);
          judgeResults.push(automated);
        }
      }

      const scorecards = aggregate(judgeResults);

      // ── SCORED ───────────────────────────────────────────────────────────
      this.advance(CompetitionState.SCORED);

      // Fire-and-forget stats update — does not block competition flow
      if (this.agentRepo) {
        const winnerId = scorecards.find(sc => sc.rank === 1)?.teamId ?? null;
        void Promise.all(
          teams
            .filter(t => t.agentId)
            .map(team => {
              const scorecard = scorecards.find(s => s.teamId === team.id);
              const won = scorecard?.teamId === winnerId;
              const score = scorecard?.finalScore ?? 0;
              return this.agentRepo!.incrementStats(team.agentId!, { won, score }).catch(() => {});
            }),
        );
      }

      // ── COMPLETE ──────────────────────────────────────────────────────────
      const synthesis: SynthesisResult | null = null; // synthesis is now on-demand via POST /synthesis
      this.advance(CompetitionState.COMPLETE);
      this.competition.completedAt = new Date().toISOString();

      if (this.options.printResults) {
        printResults(brief, scorecards);
      }

      const teamDeliverables: TeamDeliverable[] = deliverables.map((d) => ({
        teamId: d.teamId,
        files: d.files,
      }));

      const result: CompetitionResult = {
        competition: { ...this.competition },
        scorecards,
        winner: scorecards.find((c) => c.rank === 1)?.teamId ?? null,
        presentations,
        synthesis,
        deliverables: teamDeliverables,
      };

      this.emit('result', result);
      return result;
    } catch (err) {
      // Transition to FAILED unless cancelled
      if (!this._cancelled) {
        this.competition.state = CompetitionState.FAILED;
        this.competition.completedAt = new Date().toISOString();
        this.emit('stateChange', CompetitionState.FAILED);
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
      // Clean up adapters
      await Promise.all(this._activeAdapters.map(a => a.shutdown().catch(() => {})));
      throw err;
    } finally {
      commentaryAgent?.stop();
      await logger.close();
      // Clean up temp workdirs (skip-sandbox mode only; sandbox containers handle their own cleanup)
      await Promise.all(this._activeAdapters.map(a => a.cleanupWorkdir().catch(() => {})));
    }
  }

}
