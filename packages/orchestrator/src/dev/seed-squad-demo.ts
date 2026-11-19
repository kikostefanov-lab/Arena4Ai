/**
 * SYNTHETIC DEMO, NOT A REAL MATCH.
 *
 * Seeds one COMPLETE three-team competition (claude:architect, codex:standard,
 * gemini:speedrunner) so the squad visuals can be judged without paying for a
 * real run. The events are the committed, scrubbed squad fixtures pushed through
 * the REAL normalizers (ClaudeNormalizer, CodexJsonNormalizer, gemini
 * normalizeLine), then re-timed. To make the 3D view busy enough to judge, the
 * fixture squads are replayed several times per team at different offsets, with
 * agent ids remapped per replay, so each team shows 3-6 robots across ~180 s.
 * Codex and Gemini children also get synthetic `opSource: 'watch'`, `squad: true`
 * file events, as the workdir watcher would produce. Scores, deliverables and the
 * winner are invented. The title says so.
 *
 *   DATABASE_URL=postgresql://localhost/arena \
 *     npx tsx packages/orchestrator/src/dev/seed-squad-demo.ts [--brief path/to/brief.yml]
 *
 * --brief defaults to briefs/fizzbuzz-cli.yml. Prints the competition id.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { EventType, expectedFileName } from '@arena/shared';
import type { ArenaEvent, Team } from '@arena/shared';
import { parseBrief } from '../brief/parser.js';
import { loadFixture } from '../adapters/__fixtures__/load.js';
import { ClaudeNormalizer } from '../adapters/claude/claude-normalizer.js';
import { CodexJsonNormalizer } from '../adapters/codex/codex-json-normalizer.js';
import { normalizeLine as geminiNormalizeLine } from '../adapters/gemini/gemini-normalizer.js';
import { makeEvent, makeFileEvent } from '../adapters/normalizer-utils.js';

const DEMO_MS = 180_000;
const COMPETITION_ID = randomUUID();

interface TeamPlan {
  team: Team;
  /** Fixture name plus [start, length] in ms, per replay. */
  runs: { fixture: string; start: number; length: number }[];
  /** Normalises one fixture's lines into events (fresh state per replay). */
  normalize: (lines: string[], ctx: { competitionId: string; teamId: string }) => ArenaEvent[];
  fileOp: { opSource: 'tool' | 'marker' | 'verb'; tool?: string };
  watchChildren: boolean;
}

const plans: TeamPlan[] = [
  {
    team: { id: 'team-a', model: 'claude', persona: 'architect' },
    runs: [
      { fixture: 'claude-parallel', start: 8_000, length: 60_000 },
      { fixture: 'claude-background-bash', start: 40_000, length: 55_000 },
      { fixture: 'claude-concurrency-refused', start: 80_000, length: 50_000 },
      { fixture: 'claude-parallel', start: 115_000, length: 55_000 },
    ],
    normalize: (lines, ctx) => {
      const n = new ClaudeNormalizer(ctx);
      return lines.flatMap((l) => n.addLine(l));
    },
    fileOp: { opSource: 'tool', tool: 'Write' },
    watchChildren: false,
  },
  {
    team: { id: 'team-b', model: 'codex', persona: 'standard' },
    runs: [
      { fixture: 'codex-v1-spawn-wait', start: 10_000, length: 55_000 },
      { fixture: 'codex-cap-close', start: 35_000, length: 70_000 },
      { fixture: 'codex-v1-spawn-wait', start: 85_000, length: 50_000 },
      { fixture: 'codex-cap-close', start: 105_000, length: 65_000 },
    ],
    normalize: (lines, ctx) => {
      const n = new CodexJsonNormalizer(ctx);
      return lines.flatMap((l) => n.addLine(l));
    },
    fileOp: { opSource: 'marker' },
    watchChildren: true,
  },
  {
    team: { id: 'team-c', model: 'gemini', persona: 'speedrunner' },
    runs: [
      { fixture: 'gemini-invoke-agent', start: 12_000, length: 50_000 },
      { fixture: 'gemini-invoke-agent', start: 40_000, length: 55_000 },
      { fixture: 'gemini-invoke-agent', start: 78_000, length: 50_000 },
      { fixture: 'gemini-invoke-agent', start: 110_000, length: 55_000 },
    ],
    normalize: (lines, ctx) => lines.map((l) => geminiNormalizeLine(l, ctx)),
    fileOp: { opSource: 'verb' },
    watchChildren: true,
  },
];

/** Re-timed events for one team, ids remapped per replay, every sub-agent closed. */
function buildTeamEvents(plan: TeamPlan, t0: number, deliverables: string[]): ArenaEvent[] {
  const ctx = { competitionId: COMPETITION_ID, teamId: plan.team.id };
  const out: ArenaEvent[] = [];
  const stamp = (e: ArenaEvent, ms: number): ArenaEvent => {
    e.timestamp = new Date(t0 + ms).toISOString();
    return e;
  };

  plan.runs.forEach((run, k) => {
    const events = plan.normalize(loadFixture(run.fixture), ctx);
    const suffix = `~${k}`;
    const open = new Set<string>();
    const n = events.length;
    // Spawns land early and dones late so squads stay open long enough to overlap
    // (the real fixtures are seconds long); everything else spreads in between.
    let spawnNo = 0;
    let doneNo = 0;
    events.forEach((e, i) => {
      let frac = 0.1 + (0.65 * i) / Math.max(1, n - 1);
      if (e.type === EventType.SUB_AGENT_SPAWN) frac = 0.02 + 0.03 * spawnNo++;
      if (e.type === EventType.SUB_AGENT_DONE) frac = 0.8 + 0.03 * doneNo++;
      const ms = run.start + Math.round(run.length * frac);
      const p = e.payload as { agentId?: string };
      if (typeof p?.agentId === 'string' && p.agentId) p.agentId += suffix;
      if (typeof e.metadata.agentId === 'string') e.metadata.agentId += suffix;
      if (e.type === EventType.SUB_AGENT_SPAWN) open.add(p.agentId as string);
      if (e.type === EventType.SUB_AGENT_DONE) open.delete(p.agentId as string);
      out.push(stamp(e, ms));
    });
    // Lifecycle closure rule: nothing stays open past the end of its replay.
    for (const agentId of open) {
      const done = makeEvent(EventType.SUB_AGENT_DONE, { agentId, status: 'unknown', reason: 'closed at end of run' }, ctx);
      out.push(stamp(done, run.start + Math.round(run.length * 0.95)));
    }
    // Synthetic watcher files for providers that cannot attribute children.
    if (plan.watchChildren) {
      const spawns = out.filter((e) => e.type === EventType.SUB_AGENT_SPAWN && (e.payload as { agentId: string }).agentId.endsWith(suffix));
      spawns.forEach((s, j) => {
        const base = new Date(s.timestamp).getTime() - t0;
        for (let f = 0; f < 3; f++) {
          const path = `research/run${k}-part${j}-${f}.md`;
          const ev = makeFileEvent({ op: f === 0 ? 'create' : 'modify', opSource: 'watch', path, text: path }, ctx);
          ev.metadata.squad = true;
          out.push(stamp(ev, Math.min(run.start + Math.round(run.length * 0.78), base + 4_000 + f * 5_000 + j * 2_000)));
        }
      });
    }
  });

  // The lead's own deliverable writes, so the strips and towers have something to show.
  const names = deliverables.length ? deliverables : ['README.md'];
  names.forEach((name, i) => {
    const base = 20_000 + i * 45_000;
    for (let w = 0; w < 4; w++) {
      const ev = makeFileEvent({
        op: w === 0 ? 'create' : 'modify',
        opSource: plan.fileOp.opSource,
        ...(plan.fileOp.tool ? { tool: plan.fileOp.tool } : {}),
        path: name,
        text: `${w === 0 ? 'Created' : 'Modified'} ${name}`,
      }, ctx);
      out.push(stamp(ev, base + w * 18_000));
    }
  });

  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const argIdx = process.argv.indexOf('--brief');
  const briefPath = resolve(argIdx >= 0 && process.argv[argIdx + 1] ? process.argv[argIdx + 1] : 'briefs/fizzbuzz-cli.yml');
  const parsed = await parseBrief(briefPath);
  const brief = {
    ...parsed,
    id: parsed.id ?? COMPETITION_ID,
    title: '[DEMO] Squads — synthetic replay',
    timeLimitMs: DEMO_MS,
  };
  const teams = plans.map((p) => p.team);
  const deliverableNames = (brief.deliverables ?? [])
    .map((d: string) => expectedFileName(d))
    .filter((n: string | null | undefined): n is string => !!n);

  const { db } = await import('../db/client.js');
  const { CompetitionRepository } = await import('../db/repository.js');
  const { competitions } = await import('../db/schema.js');
  const { eq } = await import('drizzle-orm');
  const repo = new CompetitionRepository(db);

  const startedAt = Date.now() - 60 * 60_000;
  await repo.create(COMPETITION_ID, brief as never, teams);

  const all = plans.flatMap((p) => buildTeamEvents(p, startedAt, deliverableNames));
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (const e of all) await repo.appendEvent(e);

  const rubric = (brief.rubric?.criteria ?? []) as { id: string; weight: number }[];
  const finals: Record<string, number> = { 'team-a': 0.84, 'team-b': 0.77, 'team-c': 0.7 };
  const scorecards = teams.map((t, i) => ({
    teamId: t.id,
    finalScore: finals[t.id],
    rank: i + 1,
    judgeResults: [{
      judgeId: 'synthetic-demo',
      teamId: t.id,
      overallScore: finals[t.id] * 10,
      scores: rubric.map((c) => ({
        criterionId: c.id,
        score: Math.round(finals[t.id] * 10 * 10) / 10,
        commentary: 'Synthetic demo score, not a judgement.',
      })),
    }],
  }));
  const deliverables = teams.map((t) => ({
    teamId: t.id,
    files: (deliverableNames.length ? deliverableNames : ['README.md']).map((path: string) => ({
      path,
      content: `# Synthetic demo deliverable\n\nThis file was generated by seed-squad-demo.ts for ${t.model}:${t.persona}. It is not agent output.\n`,
    })),
  }));
  await repo.saveResult(COMPETITION_ID, { scorecards, winner: 'team-a', presentations: [], synthesis: null, deliverables } as never);

  // Real state transitions stamp "now"; a demo needs the stamps to match its events.
  await db.update(competitions).set({
    state: 'COMPLETE',
    startedAt: new Date(startedAt),
    completedAt: new Date(startedAt + DEMO_MS + 20_000),
  }).where(eq(competitions.id, COMPETITION_ID));

  console.log(COMPETITION_ID);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
