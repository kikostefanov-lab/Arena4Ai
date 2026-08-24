/**
 * Bakes one real competition's normalized event stream into a TypeScript module
 * for the sizzle reel's arena scene.
 *
 * WHY BAKE IT: Remotion renders frames offline and out of order, so a scene
 * cannot fetch. It also must be deterministic — the same frame number has to
 * produce the same pixels every time — which rules out reading anything that
 * could change between frames. A generated module is data at compile time.
 *
 * The events are run through `toFrameEvents` here rather than in the scene, so
 * the reel and the live app agree by construction: the same normalizer, the same
 * historical-payload recovery, the same origin derivation.
 *
 * Usage: npx tsx packages/video/scripts/generate-arena-data.ts [competitionId]
 * Requires the orchestrator on :3000. Reads only; writes one file.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// Imported from the built output rather than the package name: this script runs
// under tsx, which resolves it as CJS, and @arena/shared's exports map declares
// only an `import` condition. The scene code below uses the package name
// normally — this is a build-script-only detail.
import { toFrameEvents } from '../../shared/dist/index.js';
import type { ArenaEvent, FrameEvent } from '../../shared/dist/index.js';
import { SIZZLE_COMPETITION_ID } from './sizzle-source.js';

const API = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
const OUT = fileURLToPath(new URL('../src/sizzle/arena-data.ts', import.meta.url));

/** Keep the module small: these are the kinds the arena actually draws from. */
const KEEP = new Set(['file', 'tool', 'error']);
const MAX_EVENTS = 1200;

async function main(): Promise<void> {
  const id = process.argv[2] ?? SIZZLE_COMPETITION_ID;

  const compRes = await fetch(`${API}/competitions/${id}`);
  if (!compRes.ok) throw new Error(`competition ${id}: HTTP ${compRes.status}`);
  const comp = await compRes.json() as {
    brief?: { title?: string };
    teams?: Array<{ id: string; model: string; persona?: string }>;
  };

  const evRes = await fetch(`${API}/competitions/${id}/events`);
  if (!evRes.ok) throw new Error(`events ${id}: HTTP ${evRes.status}`);
  const rawBody = await evRes.json() as ArenaEvent[] | { events: ArenaEvent[] };
  const raw = Array.isArray(rawBody) ? rawBody : rawBody.events;

  const frames = toFrameEvents(raw).filter((e) => KEEP.has(e.kind));
  // Every file event is kept — they are the city. Tool and error events are
  // trimmed if the stream is enormous, since they only feed counters once a
  // frame has been seeked to (transient effects do not survive a seek).
  const files = frames.filter((e) => e.kind === 'file');
  const rest = frames.filter((e) => e.kind !== 'file').slice(0, Math.max(0, MAX_EVENTS - files.length));
  const kept = [...files, ...rest].sort((a, b) => a.t - b.t);

  const teams = (comp.teams ?? []).map((t) => ({ id: t.id, model: t.model, persona: t.persona }));

  // Per-team file count and final score. The arena scene puts these on screen
  // because the interesting fact in this competition is that they DISAGREE:
  // one agent wrote far more files and the judge scored them level. Without the
  // numbers a lopsided floor just looks like one agent did nothing; with them it
  // says what the product is actually for — the judge scores the work, not the
  // volume.
  const fileCounts = new Map<string, Set<string>>();
  for (const e of files) {
    if (!e.teamId || !e.path) continue;
    if (!fileCounts.has(e.teamId)) fileCounts.set(e.teamId, new Set());
    fileCounts.get(e.teamId)!.add(e.path);
  }
  let scores: Record<string, number> = {};
  let winnerId = '';
  /** teamId -> the files the team actually DELIVERED, straight from the manifest. */
  const manifest = new Map<string, string[]>();
  try {
    const rs = await fetch(`${API}/competitions/${id}`);
    // The shape is result.scorecards[].finalScore (0–1), not result.teams[].
    const full = await rs.json() as {
      result?: {
        scorecards?: Array<{ teamId: string; finalScore?: number }>;
        winnerId?: string;
        deliverables?: Array<{ teamId: string; files?: Array<{ path: string }> }>;
      };
    };
    for (const sc of full.result?.scorecards ?? []) {
      if (typeof sc.finalScore === 'number') scores[sc.teamId] = sc.finalScore;
    }
    winnerId = full.result?.winnerId ?? '';
    for (const d of full.result?.deliverables ?? []) {
      manifest.set(d.teamId, (d.files ?? []).map((f) => f.path).filter(Boolean));
    }
  } catch { scores = {}; }

  // ── RECONCILE THE STREAM AGAINST THE MANIFEST ────────────────────────────
  //
  // WHY THIS EXISTS. An earlier cut of this reel captioned the floor
  // "claude 17 files vs codex 4 files". Both teams delivered SEVENTEEN. The 4 was
  // the number of FILE_CREATE events codex's stream produced, not the number of
  // files it wrote: codex applies edits via apply_patch and emits unified diffs,
  // and codex-normalizer.ts turns only the first path of a patch block into an
  // event. The other 13 paths are still in the stream, as `+++ b/<path>` headers
  // inside REASONING events, and are dropped. Counting events and calling the
  // result "files" made a public claim that a competitor's model did a quarter of
  // the work.
  //
  // That is precisely the misreading the renderer's three-state design exists to
  // prevent — a logging gap must never render as less work — so the floor may not
  // be built from the event stream alone when a completer source is right there.
  // `results.deliverables` is the manifest of what was actually collected off
  // disk. Where the stream is short of it, the missing files are added.
  //
  // THE HONESTY COST IS PAID, NOT HIDDEN. A recovered path tells us a file
  // exists; it does not tell us how many times that file was edited. So a team
  // whose stream was incomplete has `opSource` stripped from ALL of its file
  // events, which drops it from `measured` to `inferred` in
  // `telemetryFromStats()` and draws its caps DASHED. That is deliberately more
  // conservative than dashing only the recovered blocks: once we know a stream
  // dropped 13 of 17 events, the surviving 4 no longer license presenting that
  // team's heights at the same confidence as a complete stream's.
  //
  // Edit depth is per-TEAM by design (see `TeamTelemetry`), not per-block, so
  // "dash only the recovered ones" is not expressible without a renderer change.
  // The durable fix is the normalizer (arena card AA-079); this is the reel's
  // honest reading of the data as it stands today.
  const reconciled: FrameEvent[] = [];
  const incomplete: string[] = [];
  for (const team of teams) {
    const own = kept.filter((e) => e.teamId === team.id);
    const ownFiles = own.filter((e) => e.kind === 'file');
    const seen = new Set(ownFiles.map((e) => e.path).filter(Boolean) as string[]);
    const missing = (manifest.get(team.id) ?? []).filter((p) => !seen.has(p));

    if (missing.length === 0) { reconciled.push(...own); continue; }
    incomplete.push(`${team.id} (+${missing.length})`);

    // Strip the operation contract: this team's heights are now partly guessed.
    for (const e of own) {
      if (e.kind === 'file') { delete e.opSource; delete e.op; }
      reconciled.push(e);
    }

    // Spread the recovered files across the window the team was actually active
    // in, so the city still builds over time instead of appearing at once.
    const times = ownFiles.map((e) => e.t);
    const lo = times.length ? Math.min(...times) : 0;
    const hi = times.length ? Math.max(...times) : (kept.length ? kept[kept.length - 1].t : 0);
    const span = Math.max(1, hi - lo);
    missing.forEach((path, i) => {
      reconciled.push({
        t: lo + Math.round((span * (i + 1)) / (missing.length + 1)),
        teamId: team.id,
        kind: 'file',
        path,
        text: path,
        legacy: false,
      });
    });
  }
  // Anything with no team (or a team not in the roster) passes through untouched.
  const rosterIds = new Set(teams.map((t) => t.id));
  reconciled.push(...kept.filter((e) => !e.teamId || !rosterIds.has(e.teamId)));
  reconciled.sort((a, b) => a.t - b.t);
  if (incomplete.length) {
    console.log(`[arena-data] stream INCOMPLETE, recovered from manifest: ${incomplete.join(', ')}`);
  }

  // The floor is built from the reconciled set, so per-team counts must be too.
  const reconciledCounts = new Map<string, Set<string>>();
  for (const e of reconciled) {
    if (e.kind !== 'file' || !e.teamId || !e.path) continue;
    if (!reconciledCounts.has(e.teamId)) reconciledCounts.set(e.teamId, new Set());
    reconciledCounts.get(e.teamId)!.add(e.path);
  }

  const summary = teams.map((t) => ({
    id: t.id,
    model: t.model,
    files: reconciledCounts.get(t.id)?.size ?? 0,
    score: scores[t.id] ?? null,
  }));

  const body = `// GENERATED by packages/video/scripts/generate-arena-data.ts — do not edit by hand.
// Source competition: ${id}
// Brief: ${JSON.stringify(comp.brief?.title ?? '(untitled)')}
//
// Real events from a real competition, normalized by the same @arena/shared
// pipeline the live arena uses. Regenerate with:
//   npx tsx packages/video/scripts/generate-arena-data.ts [competitionId]
import type { FrameEvent, TeamSpec } from '@arena/shared';

export const ARENA_SOURCE_ID = ${JSON.stringify(id)};
// Taken from the stored result, not derived from the scores: this competition
// is a TIE on final score, so picking a winner by max() would mark both.
export const ARENA_WINNER_ID = ${JSON.stringify(winnerId)};
export const ARENA_SOURCE_TITLE = ${JSON.stringify(comp.brief?.title ?? '')};
export const ARENA_TEAMS: TeamSpec[] = ${JSON.stringify(teams, null, 2)};

/** Per-team file count and final score, for the scene's caption. */
export interface ArenaTeamSummary { id: string; model: string; files: number; score: number | null }
export const ARENA_SUMMARY: ArenaTeamSummary[] = ${JSON.stringify(summary, null, 2)};
export const ARENA_EVENTS: FrameEvent[] = ${JSON.stringify(reconciled)};
`;
  writeFileSync(OUT, body);
  const span = kept.length ? kept[kept.length - 1].t : 0;
  console.log(`[arena-data] ${id} — ${teams.length} teams, ${files.length} file events, ` +
    `${kept.length} total, span ${(span / 1000).toFixed(0)}s -> ${OUT}`);
}

main().catch((err) => { console.error('[arena-data]', err); process.exit(1); });
