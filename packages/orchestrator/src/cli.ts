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
  .description('Agent Arena — pit AI models against each other in structured competitions')
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
  .action(async (briefPath: string, opts: {
    teamA: string;
    teamB: string;
    logDir: string;
    claudeBin: string;
    print: boolean;
    skipSandbox: boolean;
    timeLimit?: string;
    commentary?: boolean;
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

      const teams: [Team, Team] = [makeTeam('team-a', opts.teamA), makeTeam('team-b', opts.teamB)];

      const runner = new CompetitionRunner(
        brief,
        teams,
        {
          logDir: opts.logDir,
          claudeBin: opts.claudeBin,
          printResults: opts.print,
          skipSandbox: opts.skipSandbox ?? false,
          commentary: opts.commentary ?? false,
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
          const repo = new CompetitionRepository(db);
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

// ── tournament ────────────────────────────────────────────────────────────────
const tournamentCmd = program.command('tournament').description('Tournament commands');
const tournamentRunCmd = tournamentCmd.command('run').description('Run a round-robin tournament from a YAML brief file');

tournamentRunCmd
  .argument('<brief>', 'path to brief YAML file')
  .option('--teams <teams>', 'comma-separated team list', 'claude:architect,claude:speedrunner,codex:standard')
  .option('--skip-sandbox', 'skip Docker sandbox')
  .option('--skip-synthesis', 'skip synthesis (recommended for tournaments)')
  .option('--commentary', 'enable AI commentary per match')
  .option('--log-dir <dir>', 'directory for event logs')
  .option('--time-limit <ms>', 'time limit per match in ms', (v: string) => parseInt(v, 10))
  .action(async (briefPath: string, opts: {
    teams: string;
    skipSandbox?: boolean;
    skipSynthesis?: boolean;
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
        skipSynthesis: opts.skipSynthesis ?? true,
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
