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
  type JudgePanelSeat,
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
import { aiJudge, judgeIdFor, JUDGE_IDS, type AiJudgeResult, type JudgeProvider } from '../judging/ai-judge.js';
import { resolveJudgeModel } from '../adapters/model-registry.js';
import {
  findMissingClis, formatMissingCliError, findUnavailableModels, formatUnavailableModelError,
} from '../utils/cli-preflight.js';
import { stageTimeoutMs } from '../utils/stage-timeout.js';
import { aggregate } from '../judging/score-aggregator.js';
import { resolveOutcome } from '../judging/outcome.js';
import { printResults } from '../judging/results-reporter.js';
import type { SynthesisResult } from '../synthesis/merge-engine.js';
import { generateAllPresentations } from '../presentation/presentation-generator.js';
import { CommentaryAgent } from '../commentary/commentary-agent.js';
import type { AgentRepository } from '../db/agent-repository.js';

/** Thrown by run() once the competition has been cancelled. Terminal: no later stage runs. */
export class CompetitionCancelledError extends Error {
  constructor(message = 'Competition cancelled') {
    super(message);
    this.name = 'CompetitionCancelledError';
  }
}

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
  /** Enable adversarial (dual) judging */
  adversarialJudge?: boolean;
  /**
   * Cross-vendor judge panel: Claude, Codex and Gemini each judge every team,
   * and finalScore is the mean of the judges that succeeded. Takes the place
   * of the single (or adversarial pair of) Claude judges: adding a second
   * Claude judge to the panel would tilt it back toward one vendor.
   */
  judgePanel?: boolean;
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
  /** Sole rank-one team; null when nobody won outright (a draw, or no scorecards). */
  winner: string | null;
  /** Rank-one teams when two or more are tied within the aggregator's tolerance. */
  tiedTeamIds?: string[];
  presentations: TeamPresentation[];      // human-readable per-team findings
  synthesis: SynthesisResult | null;      // synthesized hybrid solution
  deliverables: TeamDeliverable[];
}

/** The unpausable stop fires this many times the time limit after the start. */
const WALL_CLOCK_FACTOR = 1.5;

/** Judge failures worth one more try; auth, a missing CLI or a retired model will not fix themselves. */
const RETRYABLE_JUDGE_FAILURES = new Set<string>(['timeout', 'rate-limit', 'cli-error', 'bad-output']);

/** A rate-limited judge waits this long before its one retry: an instant retry hits the same limit. */
export const JUDGE_RATE_LIMIT_RETRY_DELAY_MS = 15_000;

/** The cross-vendor panel: every provider whose model competes also judges. */
export const JUDGE_PANEL_PROVIDERS: readonly JudgeProvider[] = ['claude', 'codex', 'gemini'];

/** One judge to run on every deliverable. */
interface JudgeSeat {
  judgeId: string;
  provider: JudgeProvider;
  /** Pinned model; undefined lets aiJudge resolve it from the judgeId (legacy seats). */
  model?: string;
  /** Panel seats are relabelled `ai-<provider>/<model it actually ran on>`. */
  panel: boolean;
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
  private _cancelPromise?: Promise<void>;
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

    if (options.adversarialJudge) options.aiJudgeCount = 2;

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
      adversarialJudge: options.adversarialJudge ?? false,
      judgePanel: options.judgePanel ?? false,
    };
    if (this.options.judgePanel && this.options.adversarialJudge) {
      console.warn('[arena] --judge-panel replaces --adversarial-judge; judging with the cross-vendor panel only.');
    }
  }

  /** The competition's unique ID — same value embedded in every ArenaEvent. */
  get competitionId(): string {
    return this.competition.id;
  }

  /** Throws once cancelled — call after every await so no stage outlives a cancel. */
  private assertNotCancelled(): void {
    if (this._cancelled) throw new CompetitionCancelledError();
  }

  private advance(to: CompetitionState): void {
    this.assertNotCancelled();
    this.competition.state = transition(this.competition.state, to);
    this.emit('stateChange', this.competition.state);
  }

  /** Cancel the running competition — shuts down all adapters and stops the clock. */
  cancel(): Promise<void> {
    // Idempotent: concurrent callers wait for the same shutdown.
    this._cancelPromise ??= this._doCancel();
    return this._cancelPromise;
  }

  private async _doCancel(): Promise<void> {
    // Set synchronously: from here on advance() and every checkpoint in run() refuse to continue.
    this._cancelled = true;
    this._cancelResolve?.(); // unblock the run() Promise.race
    this._clock?.stop();
    await Promise.all(this._activeAdapters.map(a => a.shutdown().catch(() => {})));
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

      // Sandbox preflight lives inside the guarded lifecycle so a missing
      // docker binary / daemon / image ends in FAILED with an ERROR event,
      // rather than throwing before the run has a state to fail from.
      if (sandboxManager) {
        try {
          await sandboxManager.verify();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          forwardEvent({
            eventId: randomUUID(),
            competitionId: this.competition.id,
            teamId: teams[0]?.id ?? 'sandbox',
            timestamp: new Date().toISOString(),
            type: EventType.ERROR,
            payload: {
              stage: 'sandbox',
              reason: (err as { reason?: string }).reason,
              message,
            },
            metadata: {},
          });
          throw err;
        }
      }

      // Resolve each team's agent (persona + model) BEFORE preflight, so the
      // model it will run can be checked against what the CLI actually offers.
      const resolvedTeams = new Map(await Promise.all(
        teams.map(async (team) => {
          const [provider, personaId] = team.model.split(':');

          // Two-path persona resolution:
          // 1. New UI path: agentId → DB lookup
          // 2. Legacy/CLI path: provider + persona name → DB lookup → fallback to hardcoded
          let systemPrompt: string;
          let resolvedAgent: { modelVariant?: string } | null = null;

          if (team.agentId && this.agentRepo) {
            // New UI path: agentId → DB lookup
            const agent = await this.agentRepo.get(team.agentId);
            resolvedAgent = agent;
            systemPrompt = agent?.persona?.systemPrompt
              ?? resolvePersona(personaId ?? team.persona, brief.format).systemPrompt;
          } else if (this.agentRepo) {
            // Legacy/CLI path: provider + persona name → DB lookup → fallback
            const pName = personaId ?? team.persona;
            const dbAgent = pName
              ? await this.agentRepo.getByProviderAndPersonaName(provider, pName)
              : null;
            if (dbAgent?.persona) {
              resolvedAgent = dbAgent;
              systemPrompt = dbAgent.persona.systemPrompt;
              if (!team.agentId) (team as any).agentId = dbAgent.id;
            } else {
              systemPrompt = resolvePersona(pName, brief.format).systemPrompt;
            }
          } else {
            // DB unavailable: fall back to hardcoded
            systemPrompt = resolvePersona(personaId ?? team.persona, brief.format).systemPrompt;
          }

          const modelVariant: string | undefined = (team as any).modelVariant ?? resolvedAgent?.modelVariant;
          return [team.id, { systemPrompt, modelVariant }] as const;
        }),
      ));

      // Preflight: a self-hoster will rarely have all three agent CLIs. Find out
      // BEFORE launching, and say which binary is missing and how to get it —
      // rather than failing halfway through with a spawn ENOENT.
      // The panel's judges need their CLIs too; find out now, not after the match.
      const missingClis = await findMissingClis(
        [
          ...teams.map(t => t.model.split(':')[0] || 'claude'),
          ...(this.options.judgePanel ? JUDGE_PANEL_PROVIDERS : []),
        ],
        {
          claude: this.options.claudeBin,
          codex: this.options.codexBin,
          gemini: this.options.geminiBin,
        },
      );
      if (missingClis.length > 0) {
        const message = formatMissingCliError(missingClis);
        for (const m of missingClis) {
          forwardEvent({
            eventId: randomUUID(),
            competitionId: this.competition.id,
            teamId: teams.find(t => t.model.startsWith(`${m.provider}:`))?.id ?? m.provider,
            timestamp: new Date().toISOString(),
            type: EventType.ERROR,
            payload: { stage: 'preflight', provider: m.provider, bin: m.bin, hint: m.hint, message },
            metadata: {},
          });
        }
        throw new Error(message);
      }

      // Model check: a model id the installed CLI does not offer makes the agent
      // exit at once, which used to surface as an unexplained 0% "loss". Refuse
      // to start instead, naming the team, the model and what is available.
      const badModels = await findUnavailableModels(
        teams.map((t) => ({
          teamId: t.id,
          label: t.model.includes(':') ? t.model : `${t.model}:${t.persona ?? ''}`,
          provider: t.model.split(':')[0] || 'claude',
          modelVariant: resolvedTeams.get(t.id)?.modelVariant,
        })),
        {
          claude: this.options.claudeBin,
          codex: this.options.codexBin,
          gemini: this.options.geminiBin,
        },
      );
      if (badModels.length > 0) {
        const message = formatUnavailableModelError(badModels);
        for (const m of badModels) {
          forwardEvent({
            eventId: randomUUID(),
            competitionId: this.competition.id,
            teamId: m.teamId,
            timestamp: new Date().toISOString(),
            type: EventType.ERROR,
            payload: {
              stage: 'preflight',
              kind: 'model-unavailable',
              provider: m.provider,
              model: m.modelVariant,
              available: m.available,
              message,
            },
            metadata: {},
          });
        }
        throw new Error(message);
      }

      // ── LAUNCHING ────────────────────────────────────────────────────────
      this.advance(CompetitionState.LAUNCHING);

      const adapters: BaseAdapter[] = await Promise.all(
        teams.map(async (team) => {
          const workdir = await mkdtemp(join(tmpdir(), `arena-${team.id}-`));

          // Route by model prefix: claude:* → ClaudeAdapter, codex:* → CodexAdapter, gemini:* → GeminiAdapter
          const provider = team.model.split(':')[0];
          const { systemPrompt, modelVariant } = resolvedTeams.get(team.id)!;

          let adapter: BaseAdapter;
          switch (provider) {
            case 'codex':
              adapter = new CodexAdapter(team.id, {
                workdir,
                competitionId: this.competition.id,
                codexBin: this.options.codexBin,
                sandbox: sandboxManager,
                modelVariant,
              });
              break;
            case 'gemini':
              adapter = new GeminiAdapter(team.id, {
                workdir,
                competitionId: this.competition.id,
                geminiBin: this.options.geminiBin,
                sandbox: sandboxManager,
                modelVariant,
              });
              break;
            case 'claude':
            default:
              adapter = new ClaudeAdapter(team.id, {
                workdir,
                competitionId: this.competition.id,
                claudeBin: this.options.claudeBin,
                sandbox: sandboxManager,
                modelVariant,
              });
          }

          adapter.on('arenaEvent', forwardEvent);
          await adapter.injectBrief(brief, systemPrompt);
          return adapter;
        })
      );
      this._activeAdapters.push(...adapters);

      // Auto-resolve agentId for stats tracking — match model:persona to existing agents in DB
      if (this.agentRepo) {
        for (const team of teams) {
          if (team.agentId) continue; // already set via Armory
          const [provider] = team.model.split(':');
          const persona = team.persona ?? 'pragmatist';
          try {
            const match = await this.agentRepo.findByProviderAndModel(provider, persona);
            if (match) team.agentId = match.id;
          } catch { /* non-fatal — stats are advisory */ }
        }
      }

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
      // The clock can be paused, so it alone cannot bound a run. This real-time
      // stop cannot be paused: 1.5x the limit after the start, whatever happens.
      let wallClockTimer: NodeJS.Timeout | undefined;
      const wallClockStop = new Promise<void>((resolve) => {
        wallClockTimer = setTimeout(() => {
          console.error(`[arena] wall-clock limit (${WALL_CLOCK_FACTOR}x the time limit) reached — stopping the agents.`);
          resolve();
        }, brief.timeLimitMs * WALL_CLOCK_FACTOR);
      });
      try {
        await Promise.race([raceFinished, allAdaptersDone, cancelPromise, wallClockStop]);
      } finally {
        clearTimeout(wallClockTimer);
      }

      // ── TIME_UP / COLLECTING ─────────────────────────────────────────────
      this.advance(CompetitionState.TIME_UP);
      this.advance(CompetitionState.COLLECTING);

      clock.stop();

      // The deadline must actually stop the agents: signal them and wait for exit
      // BEFORE reading their files, so nothing is still writing during collection
      // and no agent process outlives the run.
      await Promise.all(adapters.map((a) => a.shutdown()));
      this.assertNotCancelled();

      const allDeliverables: Deliverable[] = await Promise.all(
        adapters.map((a) => a.collectDeliverables(brief.deliverables)),
      );
      this.assertNotCancelled();

      // A team whose agent CLI crashed (bad model, expired login, rate limit)
      // before writing anything did not compete. Judging its empty workdir used
      // to record a 0% "loss" with no error anywhere; leave it unjudged instead.
      // An agent that crashed AFTER writing files is still judged on them (its
      // crash stays visible as an ERROR event).
      const failedTeams = new Map(
        adapters
          .map((a, i) => [a, allDeliverables[i]!] as const)
          .filter(([a, d]) => a.failure && d.files.length === 0)
          .map(([a]) => [a.teamId, a.failure!] as const),
      );
      if (failedTeams.size === adapters.length) {
        throw new Error([
          'Every agent CLI failed before producing anything, so there is nothing to judge:',
          ...[...failedTeams].map(([teamId, f]) => `  • ${teamId}: ${f.message}`),
        ].join('\n'));
      }
      const deliverables = allDeliverables.filter((d) => !failedTeams.has(d.teamId));

      // ── PRESENTING ─────────────────────────────────────────────────────
      this.advance(CompetitionState.PRESENTING);
      console.log('[arena] generating human-readable presentations...');

      // Judge and presenter read the same files, so one input size scales both timeouts.
      const totalChars = deliverables.reduce(
        (sum, d) => sum + d.files.reduce((s, f) => s + f.content.length, 0), 0);
      const helperTimeoutMs = stageTimeoutMs(totalChars);

      const teamModels = new Map(teams.map((t) => [t.id, t.model]));
      let presentations: TeamPresentation[] = [];
      try {
        presentations = await generateAllPresentations(
          brief,
          deliverables,
          teamModels,
          { claudeBin: this.options.claudeBin, timeoutMs: helperTimeoutMs },
        );
      } catch (err) {
        console.error('[arena] presentation generation failed:', (err as Error).message);
      }

      this.assertNotCancelled();

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
      const seats: JudgeSeat[] = this.options.judgePanel
        ? JUDGE_PANEL_PROVIDERS.map((provider) => {
            const model = resolveJudgeModel(`ai-${provider}`, provider);
            return { provider, model, judgeId: judgeIdFor(provider, model), panel: true };
          })
        : [
            { judgeId: JUDGE_IDS.aiClaude, provider: 'claude', panel: false },
            ...(this.options.aiJudgeCount >= 2
              ? [{ judgeId: JUDGE_IDS.aiAdversarial, provider: 'claude' as const, panel: false }]
              : []),
          ];
      console.log(this.options.judgePanel
        ? `[arena] judging with the cross-vendor panel (${seats.map((j) => j.judgeId).join(', ')}; automated scorer as fallback)...`
        : '[arena] judging with AI cross-judge (automated scorer as fallback)...');
      const judgeBin: Record<JudgeProvider, string> = {
        claude: this.options.claudeBin,
        codex: this.options.codexBin,
        gemini: this.options.geminiBin,
      };
      const judgeOnce = async (d: Deliverable, seat: JudgeSeat): Promise<AiJudgeResult> => {
        const run = async () => {
          const r = await aiJudge(brief, d, brief.rubric, {
            judgeId: seat.judgeId,
            provider: seat.provider,
            ...(seat.model ? { model: seat.model } : {}),
            claudeBin: judgeBin[seat.provider],
            timeoutMs: helperTimeoutMs,
          });
          // A panel judge on its CLI default is named after the model the CLI
          // reports, so the scorecard says which model produced the number.
          return seat.panel ? { ...r, judgeId: judgeIdFor(seat.provider, r.model ?? seat.model!) } : r;
        };
        const first = await run();
        if (!first.failure || !RETRYABLE_JUDGE_FAILURES.has(first.failure.kind)) return first;
        this.assertNotCancelled();
        console.error(`[arena] AI judge ${seat.judgeId} failed for ${d.teamId} (${first.failure.kind}) — retrying once.`);
        if (first.failure.kind === 'rate-limit') {
          await new Promise((r) => setTimeout(r, JUDGE_RATE_LIMIT_RETRY_DELAY_MS));
          this.assertNotCancelled();
        }
        const second = await run();
        if (!second.failure) {
          // The retry saved it, but a flaky judge is still worth seeing in the log.
          forwardEvent({
            eventId: randomUUID(),
            competitionId: this.competition.id,
            teamId: d.teamId,
            timestamp: new Date().toISOString(),
            type: EventType.ERROR,
            payload: {
              stage: 'judging',
              recovered: true,
              judgeId: second.judgeId,
              provider: seat.provider,
              model: first.model,
              kind: first.failure.kind,
              message: `${first.failure.message} (recovered on retry)`,
            },
            metadata: {},
          });
        }
        return second;
      };
      const aiJudgePromises: Promise<AiJudgeResult>[] = seats.flatMap((seat) =>
        deliverables.map((d) => judgeOnce(d, seat)));

      // Run both in parallel — automated results are only used if AI judge fails
      const automatedResults = await Promise.all(
        deliverables.map((d) => scoreDeliverable(JUDGE_IDS.automated, d, brief.rubric, brief)),
      );
      const aiResults = await Promise.all(aiJudgePromises);
      this.assertNotCancelled();

      // Use AI judge results; fall back to the automated scorer per-team.
      // Failure is read off the judge's explicit `failure` field — never inferred
      // from score values or commentary text.
      const judgeResults: (AiJudgeResult | typeof automatedResults[number])[] = [];
      const aiByTeam = new Map<string, AiJudgeResult[]>();
      for (const r of aiResults) {
        const existing = aiByTeam.get(r.teamId) ?? [];
        existing.push(r);
        aiByTeam.set(r.teamId, existing);
      }
      const panelByTeam = new Map<string, JudgePanelSeat[]>();

      for (const automated of automatedResults) {
        const aiForTeam = aiByTeam.get(automated.teamId) ?? [];
        const usable = aiForTeam.filter((r) => !r.failure);

        for (const failed of aiForTeam.filter((r) => r.failure)) {
          // Persisted + streamed to the UI so a broken setup is visible, not silent.
          forwardEvent({
            eventId: randomUUID(),
            competitionId: this.competition.id,
            teamId: failed.teamId,
            timestamp: new Date().toISOString(),
            type: EventType.ERROR,
            payload: {
              stage: 'judging',
              judgeId: failed.judgeId,
              provider: failed.provider ?? 'claude',
              model: failed.model,
              kind: failed.failure!.kind,
              message: failed.failure!.message,
              detail: failed.failure!.detail?.slice(0, 2000),
              failure: { kind: failed.failure!.kind, message: failed.failure!.message },
            },
            metadata: {},
          });
        }

        if (this.options.judgePanel) {
          // Which judges this team's score averages, and which dropped out.
          panelByTeam.set(automated.teamId, aiForTeam.map((r) => ({
            provider: r.provider ?? 'claude',
            model: r.model ?? 'unknown',
            judgeId: r.judgeId,
            ...(r.failure ? { failure: r.failure.kind } : {}),
          })));
        }

        if (usable.length > 0) {
          judgeResults.push(...usable);
        } else {
          const reason = aiForTeam[0]?.failure?.message ?? 'AI judge produced no usable scores';
          console.error(`[arena] AI judge failed for ${automated.teamId} — using automated scorer. ${reason}`);
          judgeResults.push(automated);
        }
      }

      // finalScore = mean of the judges that succeeded (same averaging and tie
      // tolerance as the adversarial pair).
      const judgedCards = aggregate(judgeResults).map((card) => {
        const panel = panelByTeam.get(card.teamId);
        return panel ? { ...card, judgePanel: panel } : card;
      });
      const lastRank = judgedCards.reduce((max, c) => Math.max(max, c.rank), 0);
      const scorecards = [
        ...judgedCards,
        ...[...failedTeams].map(([teamId, f]) => ({
          teamId,
          judgeResults: [],
          finalScore: 0,
          rank: lastRank + 1,
          agentFailure: { message: f.message, exitCode: f.exitCode },
        })),
      ];
      // A tie within the aggregator's tolerance is a draw — never pick the first
      // rank-one team as if it had won.
      const { winnerId, tiedTeamIds } = resolveOutcome(scorecards);

      // ── SCORED ───────────────────────────────────────────────────────────
      this.advance(CompetitionState.SCORED);

      // Fire-and-forget stats update — does not block competition flow.
      // Skipped entirely when an agent crashed: a forfeit is neither a fair win
      // for the opponent nor a loss on merit for the broken setup.
      if (this.agentRepo && failedTeams.size === 0) {
        void Promise.all(
          teams
            .filter(t => t.agentId)
            .map(team => {
              const scorecard = scorecards.find(s => s.teamId === team.id);
              const won = winnerId !== null && scorecard?.teamId === winnerId;
              const drew = tiedTeamIds.includes(team.id);
              const score = scorecard?.finalScore ?? 0;
              return this.agentRepo!.incrementStats(team.agentId!, { won, drew, score }).catch(() => {});
            }),
        );
      }

      // Fire-and-forget quality signal computation — feeds the self-improving brief generator
      try {
        const { computeHeuristicSignals } = await import('../telemetry/quality-analyzer.js');
        const { briefQualitySignals } = await import('../db/schema.js');
        const signals = computeHeuristicSignals(scorecards, brief.deliverables ?? [], deliverables);
        // A crashed agent's zero says nothing about the brief; don't learn from it.
        if (process.env.DATABASE_URL && failedTeams.size === 0) {
          const { db } = await import('../db/client.js');
          await db.insert(briefQualitySignals).values({
            competitionId: this.competitionId,
            scoreSpread: String(signals.scoreSpread),
            tied: signals.tied,
            allEights: signals.allEights,
            criterionSignals: signals.criterionSignals,
            expectedFilesProduced: signals.expectedFilesProduced,
            totalFilesProduced: signals.totalFilesProduced,
            totalContentSize: signals.totalContentSize,
          }).onConflictDoUpdate({
            target: briefQualitySignals.competitionId,
            set: {
              computedAt: new Date(),
              scoreSpread: String(signals.scoreSpread),
              tied: signals.tied,
              allEights: signals.allEights,
              criterionSignals: signals.criterionSignals,
            },
          }).catch(() => {});
        }
      } catch { /* non-fatal — quality signals are advisory */ }

      // ── COMPLETE ──────────────────────────────────────────────────────────
      const synthesis: SynthesisResult | null = null; // synthesis is now on-demand via POST /synthesis
      this.advance(CompetitionState.COMPLETE);
      this.competition.completedAt = new Date().toISOString();

      if (this.options.printResults) {
        printResults(brief, scorecards);
      }

      const teamDeliverables: TeamDeliverable[] = allDeliverables.map((d) => ({
        teamId: d.teamId,
        files: d.files,
      }));

      const result: CompetitionResult = {
        competition: { ...this.competition },
        scorecards,
        winner: winnerId,
        ...(tiedTeamIds.length > 0 ? { tiedTeamIds } : {}),
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
