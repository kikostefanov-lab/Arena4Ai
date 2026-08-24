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
import { toFrameEvents, reconcileWithManifest, corpusFromEvents } from '../../shared/dist/index.js';
import type { ArenaEvent, FrameEvent, TeamManifest } from '../../shared/dist/index.js';
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
  /** The Forge's real artifact tiles for this run — see the note at the fetch. */
  const forge: Array<{ title: string; ext: string; desc: string }> = [];
  /** teamId -> the files the team actually DELIVERED, straight from the manifest. */
  const manifest = new Map<string, string[]>();
  /** One entry per judge that scored this run, with its own per-team overall. */
  const judgeCards: Array<{ judgeId: string; byTeam: Record<string, number> }> = [];
  const rubricCriteria = ((comp.brief as { rubric?: { criteria?: Array<{ id?: string; weight?: number; maxScore?: number }> } } | undefined)
    ?.rubric?.criteria) ?? [];
  try {
    const rs = await fetch(`${API}/competitions/${id}`);
    // The shape is result.scorecards[].finalScore (0–1), not result.teams[].
    const full = await rs.json() as {
      result?: {
        scorecards?: Array<{
          teamId: string;
          finalScore?: number;
          judgeResults?: Array<{ judgeId?: string; scores?: Array<{ criterionId?: string; score?: number }> }>;
        }>;
        winnerId?: string;
        deliverables?: Array<{ teamId: string; files?: Array<{ path: string }> }>;
        forge?: Array<{ artifacts?: Array<{ title?: string; filename?: string; outputFormat?: string }> }>;
      };
    };
    for (const sc of full.result?.scorecards ?? []) {
      if (typeof sc.finalScore === 'number') scores[sc.teamId] = sc.finalScore;
      // Per-judge cards. The stored finalScore is the MEAN across judges, and a
      // mean is exactly what hides a split panel: on this competition the claude
      // judge and the codex judge disagree about who won, and averaging them
      // renders as one clean winner. Recomputed here from each judge's own
      // criterion scores using the rubric's weights — the same arithmetic
      // computeOverallScore does — so the reel can show the disagreement.
      for (const jr of sc.judgeResults ?? []) {
        const jid = jr.judgeId ?? 'unknown';
        let raw = 0;
        for (const cs of jr.scores ?? []) {
          const c = rubricCriteria.find((x) => x.id === cs.criterionId);
          if (!c || typeof cs.score !== 'number') continue;
          raw += (cs.score / (c.maxScore ?? 10)) * (c.weight ?? 1);
        }
        const overall = Math.min(1, Math.max(0, raw));
        let card = judgeCards.find((k) => k.judgeId === jid);
        if (!card) { card = { judgeId: jid, byTeam: {} }; judgeCards.push(card); }
        card.byTeam[sc.teamId] = overall;
      }
    }
    winnerId = full.result?.winnerId ?? '';
    for (const d of full.result?.deliverables ?? []) {
      manifest.set(d.teamId, (d.files ?? []).map((f) => f.path).filter(Boolean));
    }
    // The Forge scene used to hardcode eight business artifacts — Business Case,
    // Go-to-Market Plan, Launch Strategy. It never read the competition, so
    // changing which competition the reel uses could not touch it, and it
    // survived two passes that were supposed to remove that framing. It was also
    // simply FALSE: this run forged API Contracts, a Dockerfile and a CI
    // pipeline. The tiles come from the stored run now, filename included,
    // because a real filename is better evidence than an invented subtitle.
    for (const a of full.result?.forge?.[0]?.artifacts ?? []) {
      const name = (a.filename ?? '').trim();
      const base = name.split('/').pop() ?? '';
      const dot = base.lastIndexOf('.');
      forge.push({
        title: a.title ?? base ?? 'artifact',
        // `Dockerfile` has no extension. The badge is a short format chip beside
        // `md` and `yml`, so print `file` rather than the long stored format
        // ("dockerfile"), which overflows the chip. The title already says it.
        ext: dot > 0 ? base.slice(dot + 1) : 'file',
        desc: name || (a.outputFormat ?? ''),
      });
    }
  } catch { scores = {}; }

  // ── RECONCILE THE STREAM AGAINST THE MANIFEST (AA-079(b)) ───────────────
  //
  // An earlier cut of this reel captioned the floor "claude 17 files vs codex 4
  // files". Both teams delivered SEVENTEEN. The 4 was the number of file events
  // codex's stream produced: it applies edits via apply_patch, and the normalizer
  // turned only the first path of each patch block into an event. Counting events
  // and calling the result "files" made a public claim that a competitor's model
  // did a quarter of the work — exactly the misreading the renderer's
  // honest-absence design exists to prevent, promoted to a caption where no
  // hatching can qualify it.
  //
  // The reconciliation itself now lives in @arena/shared so the reel and the live
  // app cannot drift apart on it. Recovered files are marked, which drops the team
  // to `inferred` (dashed caps) — the manifest proves a file exists, not how many
  // times it was edited.
  // The corpus comes from `raw`, NOT from `frames`/`kept`. `kept` filters
  // REASONING out, and REASONING is exactly where codex's `+++ b/<path>` diff
  // headers live — all 13 of the paths team-b depends on. Build it from the
  // filtered list and recovery silently drops to zero. See `corpusFromEvents`.
  const corpora = corpusFromEvents(raw);
  const manifests: TeamManifest[] = [];
  for (const [teamId, paths] of manifest) {
    manifests.push({ teamId, paths, corpus: corpora.get(teamId) ?? '' });
  }
  const { events: reconciled, recovered, skipped, unattributed } = reconcileWithManifest(kept, manifests);
  for (const [teamId, n] of recovered) {
    console.log(`[arena-data] stream INCOMPLETE for ${teamId}: recovered ${n} file(s) from the manifest`);
  }
  // Never silent: a skipped path is a block we chose not to draw, and the reason
  // matters — vendored output is not the agent's work, and an unnamed path cannot
  // be attributed to the agent at all.
  for (const [teamId, n] of skipped) {
    console.log(`[arena-data] ${teamId}: skipped ${n} vendored/build path(s)`);
  }
  for (const [teamId, n] of unattributed) {
    console.log(`[arena-data] ${teamId}: skipped ${n} path(s) the stream never names (program-generated)`);
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

  // The rubric the judge actually scored against. Criterion ids are kebab-case
  // (`google-sheets-integration`); the scene wants a label, so title-case the
  // first word and leave the rest lowercase — "Google sheets integration" reads
  // as a rubric row rather than a headline.
  const rubric = (comp.brief as { rubric?: { criteria?: Array<{ id?: string }> } } | undefined)?.rubric;
  const criteria = (rubric?.criteria ?? [])
    .map((c) => (c.id ?? '').trim())
    .filter(Boolean)
    .map((id) => {
      // Acronyms must survive: naive title-casing turned `pwa-security` into
      // "Pwa security" and `ux-speed` into "Ux speed", which looks like a typo
      // on a full-screen title card.
      const ACRONYMS = new Set(['pwa', 'ux', 'ui', 'api', 'ci', 'cd', 'ai', 'llm', 'sql', 'http', 'url', 'pdf', 'csv']);
      return id
        .replace(/[-_]+/g, ' ')
        .split(' ')
        .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
    });

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

/**
 * The brief's own rubric criteria, for the brief scene.
 *
 * These used to be hardcoded as "Go-to-market plan / Pricing + BYOM economics /
 * Open-source positioning" — the rubric of a DIFFERENT competition, from a
 * commercial strategy this project has since abandoned. A hardcoded list cannot
 * follow the competition it claims to describe, which is exactly how it outlived
 * two attempts to remove it.
 */
export const ARENA_CRITERIA: string[] = ${JSON.stringify(criteria, null, 2)};

/** The artifacts the Forge actually produced for this run, with real filenames. */
export interface ArenaForgeArtifact { title: string; ext: string; desc: string }
export const ARENA_FORGE: ArenaForgeArtifact[] = ${JSON.stringify(forge, null, 2)};
/**
 * Every judge's own card, NOT the average.
 *
 * ARENA_SUMMARY.score is the mean across judges. On a split panel that mean is
 * the one number that cannot be checked against anything on screen: it shows a
 * clean winner where the judges disagreed. Kept separate so a scene can render
 * the disagreement instead of hiding it.
 */
export interface ArenaJudgeCard { judgeId: string; byTeam: Record<string, number> }
export const ARENA_JUDGE_CARDS: ArenaJudgeCard[] = ${JSON.stringify(judgeCards, null, 2)};
export const ARENA_EVENTS: FrameEvent[] = ${JSON.stringify(reconciled)};
`;
  writeFileSync(OUT, body);
  const span = kept.length ? kept[kept.length - 1].t : 0;
  console.log(`[arena-data] ${id} — ${teams.length} teams, ${files.length} file events, ` +
    `${kept.length} total, span ${(span / 1000).toFixed(0)}s -> ${OUT}`);
}

main().catch((err) => { console.error('[arena-data]', err); process.exit(1); });
