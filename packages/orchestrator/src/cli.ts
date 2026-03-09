#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseBrief } from './brief/parser.js';
import { CompetitionRunner } from './engine/competition-runner.js';
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
  .action(async (briefPath: string, opts: {
    teamA: string;
    teamB: string;
    logDir: string;
    claudeBin: string;
    print: boolean;
  }) => {
    try {
      const brief = await parseBrief(resolve(briefPath));

      const makeTeam = (id: string, modelSpec: string): Team => {
        const [model, persona = 'pragmatist'] = modelSpec.split(':');
        return { id, model, persona };
      };

      const runner = new CompetitionRunner(
        brief,
        [makeTeam('team-a', opts.teamA), makeTeam('team-b', opts.teamB)],
        {
          logDir: opts.logDir,
          claudeBin: opts.claudeBin,
          printResults: opts.print,
        },
      );

      runner.on('stateChange', (state) => {
        console.error(`[arena] state → ${state}`);
      });

      runner.on('error', (err: Error) => {
        console.error(`[arena] error: ${err.message}`);
      });

      const result = await runner.run();
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

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
