#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseBrief } from './brief/parser.js';
import { CompetitionRunner } from './engine/competition-runner.js';
import { TournamentRunner } from './engine/tournament-runner.js';
import { CompetitionFormat } from '@arena/shared';
import type { Team } from '@arena/shared';

const program = new Command();

program
  .name('arena')
  .description('Arena4Ai — pit AI models against each other in structured competitions')
  .version('0.1.0');

// ── run ──────────────────────────────────────────────────────────────────────
program
  .command('run')
  .description('Run a competition from a YAML brief file')
  .argument('<brief>', 'Path to the brief YAML file')
  .option('-a, --team-a <model>', 'Model:persona for team A (e.g. claude:speedrunner)', 'claude:speedrunner')
  .option('-b, --team-b <model>', 'Model:persona for team B (e.g. claude:architect)', 'claude:architect')
  .option('--log-dir <dir>', 'Directory to write JSONL event logs', '/tmp/arena-logs')
  .option('--claude-bin <path>', 'Path to the claude CLI binary', 'claude')
  .option('--no-print', 'Suppress results table output')
  .option('--skip-sandbox', 'Skip Docker sandbox creation (use local temp dirs instead)')
  .option('--time-limit <ms>', 'Override brief time limit in milliseconds')
  .option('--commentary', 'Enable live AI commentary during the competition')
  .option('--adversarial-judge', 'Enable dual judging with adversarial cross-check')
  .option('--teams <teams>', 'Comma-separated list of model:persona strings (overrides --team-a/--team-b)')
  .action(async (briefPath: string, opts: {
    teamA: string;
    teamB: string;
    logDir: string;
    claudeBin: string;
    print: boolean;
    skipSandbox: boolean;
    timeLimit?: string;
    commentary?: boolean;
    adversarialJudge?: boolean;
    teams?: string;
  }) => {
    try {
      const brief = await parseBrief(resolve(briefPath));

      if (opts.timeLimit) {
        const ms = Number(opts.timeLimit);
        if (!Number.isFinite(ms) || ms <= 0) {
          console.error(`[arena] fatal: --time-limit must be a positive number, got: ${opts.timeLimit}`);
          process.exit(1);
        }
        brief.timeLimitMs = ms;
      }

      const makeTeam = (id: string, modelSpec: string): Team => {
        const [model, persona = 'pragmatist'] = modelSpec.split(':');
        return { id, model, persona };
      };

      const teamIds = ['team-a', 'team-b', 'team-c', 'team-d'];
      const teams: Team[] = opts.teams
        ? opts.teams.split(',').map((t: string, i: number) => makeTeam(teamIds[i] ?? `team-${i}`, t.trim()))
        : [makeTeam('team-a', opts.teamA), makeTeam('team-b', opts.teamB)];

      const runner = new CompetitionRunner(
        brief,
        teams,
        {
          logDir: opts.logDir,
          claudeBin: opts.claudeBin,
          printResults: opts.print,
          skipSandbox: opts.skipSandbox ?? false,
          commentary: opts.commentary ?? false,
          adversarialJudge: opts.adversarialJudge ?? false,
        },
      );

      // Persist to DB when DATABASE_URL is available
      // arenaEvents are fire-and-forget (collected into pendingEvents for final drain).
      // stateChange and result writes are serialized via stateQueue to prevent ordering issues.
      const pendingEvents: Promise<void>[] = [];
      let stateQueue: Promise<void> = Promise.resolve();
      if (process.env.DATABASE_URL) {
        try {
          const { db } = await import('./db/client.js');
          const { CompetitionRepository } = await import('./db/repository.js');
          const { AgentRepository } = await import('./db/agent-repository.js');
          const repo = new CompetitionRepository(db);
          (runner as any).agentRepo = new AgentRepository(db);
          await repo.create(runner.competitionId, brief, teams);

          runner.on('stateChange', (state) => {
            stateQueue = stateQueue.then(() =>
              repo.updateState(runner.competitionId, state).catch(console.error),
            );
          });
          runner.on('arenaEvent', (event) => {
            pendingEvents.push(repo.appendEvent(event).catch(console.error));
          });
          runner.on('result', (res: import('./engine/competition-runner.js').CompetitionResult) => {
            stateQueue = stateQueue.then(() =>
              repo.saveResult(runner.competitionId, {
                scorecards: res.scorecards,
                winner: res.winner,
                presentations: res.presentations,
                synthesis: res.synthesis,
                deliverables: res.deliverables,
              }).catch(console.error),
            );
          });
          console.error(`[arena] DB persistence enabled (${process.env.DATABASE_URL})`);
        } catch (err) {
          console.error(`[arena] warn: DB persistence unavailable — ${(err as Error).message}`);
        }
      }

      runner.on('stateChange', (state) => {
        console.error(`[arena] state → ${state}`);
      });

      runner.on('error', (err: Error) => {
        console.error(`[arena] error: ${err.message}`);
      });

      const result = await runner.run();
      // Drain all pending event writes and state queue before exiting
      await Promise.all([...pendingEvents, stateQueue]);
      console.log(JSON.stringify({ winner: result.winner, competitionId: result.competition.id }, null, 2));
      process.exit(0);
    } catch (err) {
      console.error(`[arena] fatal: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── replay ───────────────────────────────────────────────────────────────────
program
  .command('replay')
  .description('Replay and display events from a JSONL log file')
  .argument('<logfile>', 'Path to a .jsonl event log')
  .option('--team <id>', 'Filter to a specific team ID')
  .option('--type <type>', 'Filter to a specific event type')
  .action(async (logfile: string, opts: { team?: string; type?: string }) => {
    try {
      const raw = await readFile(resolve(logfile), 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean);
      let events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);

      if (opts.team) events = events.filter((e) => e.teamId === opts.team);
      if (opts.type) events = events.filter((e) => e.type === opts.type);

      for (const event of events) {
        const ts = String(event.timestamp ?? '').slice(11, 23);
        console.log(`[${ts}] [${event.teamId}] ${event.type}  ${JSON.stringify(event.payload ?? {})}`);
      }
      console.log(`\n${events.length} event(s) shown.`);
    } catch (err) {
      console.error(`[arena] replay error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── list-formats ─────────────────────────────────────────────────────────────
program
  .command('list-formats')
  .description('List available competition formats')
  .action(() => {
    for (const format of Object.values(CompetitionFormat)) {
      console.log(`  ${format}`);
    }
  });

// ── serve ─────────────────────────────────────────────────────────────────────
program
  .command('serve')
  .description('Start the Arena HTTP API server')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .option('--skip-sandbox', 'Skip Docker sandbox')
  .action(async (opts: { port: string; skipSandbox?: boolean }) => {
    const { createServer } = await import('./server/app.js');
    const server = createServer();
    const port = Number(opts.port);
    server.listen(port, () => {
      console.log(`[arena] server listening on http://localhost:${port}`);
    });
  });

// ── re-evaluate ──────────────────────────────────────────────────────────────
program
  .command('re-evaluate')
  .description('Re-run downstream stages (judge/presentation/synthesis) on completed competitions')
  .argument('[competition-id]', 'Competition ID to re-evaluate (omit with --all)')
  .option('--stage <stage>', 'Stage to re-run: judge, presentation, synthesis, all', 'all')
  .option('--all', 'Re-evaluate all completed competitions')
  .action(async (competitionId: string | undefined, opts: {
    stage: string;
    all?: boolean;
  }) => {
    if (!process.env.DATABASE_URL) {
      console.error('[arena] re-evaluate requires DATABASE_URL');
      process.exit(1);
    }

    const { db } = await import('./db/client.js');
    const { CompetitionRepository } = await import('./db/repository.js');
    const repo = new CompetitionRepository(db);

    let ids: string[];
    if (opts.all) {
      const comps = await repo.list();
      ids = comps
        .filter((c: any) => c.state === 'COMPLETE' || c.state === 'FORGE_COMPLETE')
        .map((c: any) => c.id);
    } else if (competitionId) {
      ids = [competitionId];
    } else {
      console.error('[arena] provide a competition ID or --all');
      process.exit(1);
    }

    const stages = opts.stage === 'all'
      ? ['presentation', 'judge', 'synthesis'] as const
      : [opts.stage] as const;

    console.log(`[arena] re-evaluating ${ids.length} competition(s), stages: ${stages.join(' → ')}`);

    for (const id of ids) {
      const comp = await repo.getCompetition(id);
      const result = await repo.getResult(id);
      if (!comp || !result) {
        console.error(`[arena] skip ${id}: missing competition or result`);
        continue;
      }

      const brief = comp.brief as import('@arena/shared').Brief;
      const rawDeliverables = (result.deliverables ?? []) as Array<{ teamId: string; files: Array<{ path: string; content: string }> }>;

      if (rawDeliverables.length === 0) {
        console.error(`[arena] skip ${id}: no deliverables`);
        continue;
      }

      // DB deliverables may lack collectedAt — backfill for type compat
      const deliverables: import('@arena/shared').Deliverable[] = rawDeliverables.map((d) => ({
        ...d,
        collectedAt: (d as any).collectedAt ?? new Date().toISOString(),
      }));

      // Archive current results before overwriting
      await repo.archiveResult(id, opts.stage);
      console.log(`[arena] ${id}: archived current results`);

      for (const stage of stages) {
        if (stage === 'presentation') {
          const { generateAllPresentations } = await import('./presentation/presentation-generator.js');
          const teamModels = new Map((comp.teams as any[]).map((t: any) => [t.id, t.model]));
          const presentations = await generateAllPresentations(brief, deliverables, teamModels);
          await repo.updatePresentations(id, presentations);
          console.log(`[arena] ${id}: presentations regenerated (${presentations.length} teams)`);
        }

        if (stage === 'judge') {
          const { aiJudge, JUDGE_IDS } = await import('./judging/ai-judge.js');
          const { computeOverallScore } = await import('./judging/score-aggregator.js');
          const scorecards = [];
          for (const d of deliverables) {
            const jr = await aiJudge(brief, d, brief.rubric, { judgeId: JUDGE_IDS.aiClaude });
            const finalScore = computeOverallScore(jr.scores, brief.rubric);
            scorecards.push({ teamId: d.teamId, finalScore, judgeResults: [jr] });
          }
          scorecards.sort((a, b) => b.finalScore - a.finalScore);
          const winnerId = scorecards[0]?.teamId ?? null;
          await repo.updateScorecards(id, scorecards, winnerId);
          console.log(`[arena] ${id}: re-judged → winner: ${winnerId} (${scorecards.map(s => `${s.teamId}:${s.finalScore.toFixed(3)}`).join(', ')})`);
        }

        if (stage === 'synthesis') {
          const { synthesizeDeliverables } = await import('./synthesis/merge-engine.js');
          const currentResult = await repo.getResult(id);
          const presentations = (currentResult?.presentations ?? []) as import('@arena/shared').TeamPresentation[];
          const synthesis = await synthesizeDeliverables(brief, deliverables, {}, presentations);
          if (synthesis) {
            await repo.saveSynthesis(id, synthesis);
            console.log(`[arena] ${id}: synthesis regenerated`);
          }
        }
      }
    }

    console.log(`[arena] re-evaluation complete`);
    process.exit(0);
  });

// ── seed-quality-signals ──────────────────────────────────────────────────────
program
  .command('seed-quality-signals')
  .description('Compute and upsert quality signals for all completed competitions')
  .action(async () => {
    if (!process.env.DATABASE_URL) {
      console.error('[arena] seed-quality-signals requires DATABASE_URL');
      process.exit(1);
    }

    const { db } = await import('./db/client.js');
    const { CompetitionRepository } = await import('./db/repository.js');
    const { computeHeuristicSignals } = await import('./telemetry/quality-analyzer.js');
    const { briefQualitySignals } = await import('./db/schema.js');

    const repo = new CompetitionRepository(db);
    const comps = await repo.list(500);
    const completed = comps.filter(
      (c: any) => c.state === 'COMPLETE' || c.state === 'FORGE_COMPLETE' || c.state === 'SCORED',
    );

    console.log(`[arena] found ${completed.length} completed competitions`);

    let seeded = 0;
    for (const comp of completed) {
      const result = await repo.getResult(comp.id);
      if (!result?.scorecards || !Array.isArray(result.scorecards)) {
        console.warn(`[arena] skip ${comp.id}: no scorecards`);
        continue;
      }

      const brief = comp.brief as Record<string, any>;
      const expectedDeliverables: string[] = Array.isArray(brief?.deliverables) ? brief.deliverables : [];
      const deliverables = (result.deliverables ?? []) as Array<{ teamId: string; files: Array<{ path: string; content: string }> }>;

      const signals = computeHeuristicSignals(
        result.scorecards as any[],
        expectedDeliverables,
        deliverables,
      );

      await db.insert(briefQualitySignals).values({
        competitionId: comp.id,
        scoreSpread: String(signals.scoreSpread),
        tied: signals.tied,
        allEights: signals.allEights,
        criterionSignals: signals.criterionSignals as any,
        expectedFilesProduced: signals.expectedFilesProduced as any,
        totalFilesProduced: signals.totalFilesProduced,
        totalContentSize: signals.totalContentSize,
        synthesisTriggered: result.synthesis != null,
      }).onConflictDoUpdate({
        target: briefQualitySignals.competitionId,
        set: {
          scoreSpread: String(signals.scoreSpread),
          tied: signals.tied,
          allEights: signals.allEights,
          criterionSignals: signals.criterionSignals as any,
          expectedFilesProduced: signals.expectedFilesProduced as any,
          totalFilesProduced: signals.totalFilesProduced,
          totalContentSize: signals.totalContentSize,
          synthesisTriggered: result.synthesis != null,
          computedAt: new Date(),
        },
      });

      seeded++;
      console.log(`[arena] ${comp.id}: signals upserted (spread=${signals.scoreSpread.toFixed(3)}, tied=${signals.tied}, allEights=${signals.allEights})`);
    }

    console.log(`[arena] seeded quality signals for ${seeded} competitions`);
    process.exit(0);
  });

// ── tournament ────────────────────────────────────────────────────────────────
const tournamentCmd = program.command('tournament').description('Tournament commands');
const tournamentRunCmd = tournamentCmd.command('run').description('Run a round-robin tournament from a YAML brief file');

tournamentRunCmd
  .argument('<brief>', 'path to brief YAML file')
  .option('--teams <teams>', 'comma-separated team list', 'claude:architect,claude:speedrunner,codex:standard')
  .option('--skip-sandbox', 'skip Docker sandbox')
  .option('--commentary', 'enable AI commentary per match')
  .option('--log-dir <dir>', 'directory for event logs')
  .option('--time-limit <ms>', 'time limit per match in ms', (v: string) => parseInt(v, 10))
  .action(async (briefPath: string, opts: {
    teams: string;
    skipSandbox?: boolean;
    commentary?: boolean;
    logDir?: string;
    timeLimit?: number;
  }) => {
    try {
      const brief = await parseBrief(resolve(briefPath));
      const teams = opts.teams.split(',').map((t: string) => t.trim()).filter(Boolean);

      if (teams.length < 2) {
        console.error('Tournament requires at least 2 teams');
        process.exit(1);
      }

      console.log(`[arena] Starting tournament: ${teams.length} teams, ${teams.length * (teams.length - 1) / 2} matches`);
      console.log(`[arena] Teams: ${teams.join(', ')}`);

      if (opts.timeLimit !== undefined) {
        brief.timeLimitMs = opts.timeLimit;
      }

      const runner = new TournamentRunner(brief, teams, {
        skipSandbox: opts.skipSandbox ?? false,
        commentary: opts.commentary ?? false,
        logDir: opts.logDir,
        printResults: false,
      });

      let matchNum = 0;
      runner.on('matchStart', ({ teamA, teamB }: { teamA: string; teamB: string }) => {
        matchNum++;
        const total = teams.length * (teams.length - 1) / 2;
        console.log(`\n[arena] Match ${matchNum}/${total}: ${teamA} vs ${teamB}`);
      });

      runner.on('matchEnd', ({ teamA, teamB, winner }: { teamA: string; teamB: string; winner: string | null }) => {
        const result = winner ? `Winner: ${winner}` : 'Draw';
        console.log(`[arena] Match complete — ${result}`);
      });

      const result = await runner.run();

      console.log('\n[arena] ══════════════════════════════════════');
      console.log('[arena] TOURNAMENT COMPLETE');
      console.log('[arena] ══════════════════════════════════════');
      console.log('[arena] Final standings:');
      result.rankings.forEach((r, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `  ${i + 1}.`;
        console.log(`[arena]   ${medal} ${r.model} — ${r.wins}W ${r.losses}L ${r.draws}D (score: ${r.totalScore.toFixed(1)})`);
      });
    } catch (err) {
      console.error('[arena] Tournament failed:', (err as Error).message);
      process.exit(1);
    }
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
