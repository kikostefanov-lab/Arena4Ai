import type { FrameEvent, TeamTelemetry, EditDepthMode } from './event-model.js';
import { resolveTelemetry, providerOf, capabilityFor } from './event-model.js';
import { getModelColor } from '../design/tokens.js';
import type { Cell, GridExtent, BlockBudget } from './layout.js';
import { planGrid, cellOrder, blockKeyFor, MAX_BLOCKS_PER_TEAM } from './layout.js';

/** What the renderer needs to know about one competitor. */
export interface TeamSpec {
  id: string;
  /** `claude`, `codex:speedrunner`, … — provider is parsed off the front. */
  model: string;
  persona?: string;
  modelVariant?: string;
}

export type BlockKind = 'src' | 'test' | 'doc' | 'config';

/** Running tallies over a team's file events. See `TeamState.fileStats`. */
export interface FileStats { total: number; withContract: number; withPath: number; legacy: number }

/**
 * Fold one file event into a team's tallies.
 *
 * Called when an event becomes KNOWN, not when it is applied. What a provider
 * reports is a property of the stream, not of the playhead: an event that has
 * arrived already proves what its provider does and does not tell us, whether
 * or not the clock has reached it. Deriving it from applied events instead made
 * a replay silently DOWNGRADE its own telemetry — the world is built knowing
 * the whole list, and the first tick then recomputed from a partial tally and
 * dropped the honesty note for every team whose files came later.
 *
 * Grid capacity is the opposite and must stay apply-time: a cell is only
 * occupied when the block is actually placed.
 */
export function foldFileStats(stats: FileStats, ev: FrameEvent): void {
  if (ev.kind !== 'file') return;
  stats.total++;
  if (ev.opSource && ev.op) stats.withContract++;
  if (ev.path) stats.withPath++;
  if (ev.legacy) stats.legacy++;
}

export interface Structure {
  teamId: string;
  /** The label drawn above the block — a path, or a directory once rolled up. */
  key: string;
  x: number;
  z: number;
  /** Current animated height. */
  h: number;
  /** Target height. */
  th: number;
  /** Edits counted for this block. */
  mods: number;
  /**
   * How this block's height was arrived at. Carried per structure rather than
   * per team because a single team can have both: measured events for files it
   * touched after the telemetry landed, inferred ones for a legacy prefix.
   */
  depth: EditDepthMode;
  kind: BlockKind;
  born: number;
  /** Error damage, decays. */
  hit: number;
  /** Write flash, decays. */
  flash: number;
  /** Judge scan highlight. */
  gold: number;
}

export interface TeamState extends TeamSpec {
  side: -1 | 1;
  color: string;
  cells: Cell[];
  nextCell: number;
  counts: { files: number; edits: number; tools: number; errors: number; reasoning: number };
  latest: string;
  telemetry: TeamTelemetry;
  budget: BlockBudget;
  /** Paths seen, for first-sighting inference on legacy streams. */
  seen: Set<string>;
  /**
   * Running tallies over this team's file events.
   *
   * LIVE MODE needs these. `resolveTelemetry()` folds a whole event list at
   * once, which is right for a replay whose events all exist up front, but a
   * live competition starts with an empty stream and learns what its provider
   * reports only as events arrive. Re-folding the entire list on every arriving
   * event would be O(n) per event — O(n squared) over a competition — so the
   * facts telemetry depends on are accumulated as events are applied instead.
   */
  fileStats: FileStats;
}

export type Phase = 'active' | 'freeze' | 'judging' | 'reveal';

export interface World {
  grid: GridExtent;
  baseX: number;
  teams: Map<string, TeamState>;
  structures: Map<string, Structure>;
  order: string[];
  phase: Phase;
  compState: string;
  winnerId: string | null;
  /** Rolling window of recent activity, for the momentum channel. */
  recent: Array<{ t: number; teamId: string; kind: string }>;
  log: FrameEvent[];
  commentary: { text: string; until: number } | null;
  t: number;
  judgeScanZ: number;
  /** Every honest-absence note gathered from the teams, for the legend. */
  notes: string[];
}

const RECENT_CAP = 400;
const LOG_CAP = 8;

function kindOf(p: string): BlockKind {
  if (/(^|\/)tests?\/|test|conftest|\.spec\./i.test(p)) return 'test';
  if (/\.(md|rst|txt|adoc)$/i.test(p)) return 'doc';
  if (/\.(toml|ya?ml|json|cfg|ini|lock)$|Makefile|Dockerfile|requirements/i.test(p)) return 'config';
  return 'src';
}

/**
 * Build the world.
 *
 * The grid is sized UP FRONT from the number of distinct file paths in the
 * stream, which is why this takes the whole event list rather than growing
 * lazily: a floor that resized mid-replay would move every block already placed,
 * and the whole point of the block channel is that a file keeps its spot.
 */
export function createWorld(teams: TeamSpec[], events: FrameEvent[]): World {
  const baseX = 6.2;

  // Distinct paths per team → how many blocks the busiest team will need.
  const perTeamPaths = new Map<string, Set<string>>();
  for (const t of teams) perTeamPaths.set(t.id, new Set());
  for (const e of events) {
    if (e.kind !== 'file' || !e.teamId || !e.path) continue;
    perTeamPaths.get(e.teamId)?.add(e.path);
  }

  const budgets = new Map<string, BlockBudget>();
  let widest = 0;
  for (const t of teams) {
    const files = perTeamPaths.get(t.id)?.size ?? 0;
    const rolledUp = files > MAX_BLOCKS_PER_TEAM;
    let blocks = files;
    if (rolledUp) {
      const dirs = new Set<string>();
      for (const p of perTeamPaths.get(t.id) ?? []) dirs.add(blockKeyFor(p, true));
      blocks = dirs.size;
    }
    budgets.set(t.id, {
      rolledUp,
      files,
      blocks,
      note: rolledUp
        ? `${t.model.split(':')[0]}: ${files} files exceed the ${MAX_BLOCKS_PER_TEAM}-block ceiling — blocks are directories, height is the directory's total edits`
        : undefined,
    });
    widest = Math.max(widest, blocks);
  }

  const grid = planGrid(Math.max(widest, 1));

  const world: World = {
    grid,
    baseX,
    teams: new Map(),
    structures: new Map(),
    order: [],
    phase: 'active',
    compState: 'LAUNCHING',
    winnerId: null,
    recent: [],
    log: [],
    commentary: null,
    t: 0,
    judgeScanZ: 0,
    notes: [],
  };

  teams.forEach((spec, i) => {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const fileEvents = events.filter((e) => e.kind === 'file' && e.teamId === spec.id);
    const telemetry = resolveTelemetry(spec.model, fileEvents);
    const budget = budgets.get(spec.id)!;
    world.teams.set(spec.id, {
      ...spec,
      side,
      color: getModelColor(spec.model),
      cells: cellOrder(side, grid, baseX),
      nextCell: 0,
      counts: { files: 0, edits: 0, tools: 0, errors: 0, reasoning: 0 },
      latest: '',
      telemetry,
      budget,
      seen: new Set(),
      fileStats: fileEvents.reduce<FileStats>((acc, e) => { foldFileStats(acc, e); return acc; },
        { total: 0, withContract: 0, withPath: 0, legacy: 0 }),
    });
    if (telemetry.note) world.notes.push(telemetry.note);
    if (budget.note) world.notes.push(budget.note);
  });

  return world;
}

/** Wipe accumulated state, keeping the grid and team identities. Used by seek(). */
export function resetWorld(world: World): void {
  world.structures.clear();
  world.order.length = 0;
  world.recent.length = 0;
  world.log.length = 0;
  world.commentary = null;
  world.phase = 'active';
  world.compState = 'LAUNCHING';
  world.winnerId = null;
  world.t = 0;
  for (const team of world.teams.values()) {
    team.nextCell = 0;
    team.counts = { files: 0, edits: 0, tools: 0, errors: 0, reasoning: 0 };
    team.latest = '';
    team.seen.clear();
    // fileStats deliberately survive: they describe the STREAM, so scrubbing to
    // the start must not make a competition's honesty caveat disappear.
  }
}

export function phaseFor(state: string): Phase {
  if (state === 'RUNNING' || state === 'LAUNCHING' || state === 'CONFIGURED' || state === 'DRAFT') return 'active';
  if (state === 'TIME_UP' || state === 'COLLECTING' || state === 'PRESENTING') return 'freeze';
  if (state === 'JUDGING') return 'judging';
  return 'reveal';
}

/**
 * Resolve create-vs-modify for one file event.
 *
 * A post-c965642 event states its operation and we take it. A legacy event
 * states nothing, so we fall back to first sighting — the weakest tier the type
 * system already has a name for. The tier travels with the block so the renderer
 * can draw the difference; this function never invents a `modify` and calls it
 * measured.
 */
function resolveOp(ev: FrameEvent, team: TeamState, key: string): { modify: boolean; depth: EditDepthMode } {
  // A provider that cannot report operations at all outranks whatever an
  // individual event happens to carry. Its blocks stay flat and hatched.
  if (team.telemetry.editDepth === 'unavailable') {
    return { modify: false, depth: 'unavailable' };
  }
  if (ev.opSource && ev.op) {
    return { modify: ev.op === 'modify', depth: 'measured' };
  }
  if (!ev.path) return { modify: false, depth: 'unavailable' };
  const seen = team.seen.has(key);
  return { modify: seen, depth: 'inferred' };
}

/** Height a block should reach for a given edit count and confidence. */
export function targetHeight(mods: number, depth: EditDepthMode): number {
  // An unmeasurable block sits at unit height with a hatched cap (drawn by the
  // renderer). It is NOT scaled down — a short solid block would read as "this
  // model did less work", which is exactly the false claim this contract exists
  // to prevent.
  if (depth === 'unavailable') return 0.8;
  return Math.min(3.2, 0.8 + mods * 0.22);
}

export interface ApplyEffects {
  /** Called for visual side effects. Omitted during a non-live rebuild. */
  onWrite?: (team: TeamState, st: Structure) => void;
  onTool?: (team: TeamState) => void;
  onError?: (team: TeamState, st: Structure | null) => void;
  onReasoning?: (team: TeamState) => void;
  onState?: (state: string) => void;
}

/**
 * Apply one event to the world. `live` distinguishes playback (spawn effects,
 * animate) from a seek rebuild (snap to final values, no effects) — without it,
 * scrubbing to the end would fire a thousand beams at once.
 */
export function applyEvent(world: World, ev: FrameEvent, live: boolean, fx: ApplyEffects = {}): void {
  const now = world.t;

  if (ev.kind === 'state' && ev.state) {
    world.compState = ev.state;
    world.phase = phaseFor(ev.state);
    fx.onState?.(ev.state);
    return;
  }
  if (ev.kind === 'commentary') {
    world.commentary = { text: ev.text, until: now + 7000 };
    return;
  }

  const team = ev.teamId ? world.teams.get(ev.teamId) : undefined;
  if (!team) return;

  world.recent.push({ t: now, teamId: team.id, kind: ev.kind });
  if (world.recent.length > RECENT_CAP) world.recent.splice(0, world.recent.length - RECENT_CAP);
  world.log.push(ev);
  if (world.log.length > LOG_CAP) world.log.shift();

  switch (ev.kind) {
    case 'reasoning':
      team.counts.reasoning++;
      team.latest = `thinking · ${ev.text}`;
      fx.onReasoning?.(team);
      break;

    case 'tool':
      team.counts.tools++;
      team.latest = ev.tool ? `${ev.tool} ${ev.text}`.trim() : ev.text;
      fx.onTool?.(team);
      break;

    case 'error': {
      team.counts.errors++;
      team.latest = `✕ ${ev.text}`;
      let last: Structure | null = null;
      for (const s of world.structures.values()) {
        if (s.teamId === team.id && (!last || s.born > last.born)) last = s;
      }
      if (last) last.hit = 1;
      fx.onError?.(team, last);
      break;
    }

    case 'file': {
      if (!ev.path) {
        // A file event with no recoverable path cannot become a block. Counting
        // it as a file anyway would inflate the stat panel above what the floor
        // shows, so it is counted and left off the floor, and the team's
        // telemetry note explains the gap.
        team.counts.files++;
        team.latest = ev.text || 'file write';
        break;
      }
      const key = blockKeyFor(ev.path, team.budget.rolledUp);
      const id = `${team.id}|${key}`;
      const { modify, depth } = resolveOp(ev, team, key);
      team.seen.add(key);

      let st = world.structures.get(id);
      if (!st) {
        const cell = team.cells[Math.min(team.nextCell++, team.cells.length - 1)];
        st = {
          teamId: team.id,
          key,
          x: cell.x,
          z: cell.z,
          h: live ? 0 : 0.8,
          th: 0.8,
          mods: 0,
          depth,
          kind: kindOf(ev.path),
          born: now,
          hit: 0,
          flash: live ? 1 : 0,
          gold: 0,
        };
        world.structures.set(id, st);
        world.order.push(id);
        team.counts.files++;
      }
      if (modify) {
        st.mods++;
        team.counts.edits++;
        // A block that has ever been measured stays measured; a later legacy
        // event must not downgrade a fact to a guess.
        if (st.depth !== 'measured') st.depth = depth;
      } else if (depth === 'measured' && st.depth !== 'unavailable') {
        st.depth = 'measured';
      }
      st.th = targetHeight(st.mods, st.depth);
      if (!live) st.h = st.th;
      else st.flash = 1;
      team.latest = `${modify ? 'edit' : 'write'} ${key}`;
      fx.onWrite?.(team, st);
      break;
    }
  }
}

// ─── live mode ───────────────────────────────────────────────────────────────

/**
 * Recompute a team's telemetry from its running tallies.
 *
 * Deliberately mirrors `resolveTelemetry()` branch for branch — the two must not
 * be allowed to disagree, because one drives a replay's legend and the other
 * drives a live competition's, and a viewer comparing the same competition live
 * and afterwards must be told the same thing about it.
 */
export function telemetryFromStats(model: string, stats: TeamState['fileStats']): TeamTelemetry {
  const provider = providerOf(model);
  const capability = capabilityFor(model);
  const legacy = stats.legacy > 0;

  if (!capability.op) {
    return {
      provider, capability, editDepth: 'unavailable', legacy,
      note: `${provider}: this provider does not report file operations — block heights are drawn flat, not low`,
    };
  }
  if (stats.withContract > 0) return { provider, capability, editDepth: 'measured', legacy };
  if (stats.total === 0) return { provider, capability, editDepth: 'measured', legacy: false };
  if (stats.withPath > 0) {
    return {
      provider, capability, editDepth: 'inferred', legacy,
      note: `${provider}: edit depth inferred from repeated paths — this competition predates file-operation telemetry`,
    };
  }
  return {
    provider, capability, editDepth: 'unavailable', legacy,
    note: `${provider}: no file paths in these events — block heights are not measurable and are drawn flat`,
  };
}

/** Rebuild `world.notes` from the current per-team telemetry and budgets. */
export function refreshNotes(world: World): void {
  world.notes.length = 0;
  for (const team of world.teams.values()) {
    if (team.telemetry.note) world.notes.push(team.telemetry.note);
    if (team.budget.note) world.notes.push(team.budget.note);
  }
}

/**
 * Grow the floor so `needed` blocks fit for one team, WITHOUT disturbing which
 * block sits where relative to its neighbours.
 *
 * A live competition cannot size its grid up front — it does not yet know how
 * many files the agents will write. Left alone, the placement cursor would run
 * past the end of `cells` and silently stack every later file onto the last
 * cell, which is exactly the failure removed from the prototype in AA-065.
 *
 * Regrowing moves blocks, and that is a genuine cost: a viewer watching the
 * floor sees it rescale. It is the lesser evil. The alternative — sizing every
 * live arena for hundreds of files up front — would render a nine-file fizzbuzz
 * as nine specks in an empty stadium, every time, to avoid a rescale that most
 * competitions never trigger. Placement order is preserved exactly, so a block
 * keeps its neighbours and its distance from the base; only the scale changes.
 *
 * Returns true when the grid actually changed.
 */
export function ensureGridCapacity(world: World, needed: number): boolean {
  if (needed <= world.grid.capacity) return false;

  const grid = planGrid(needed);
  world.grid = grid;

  for (const team of world.teams.values()) {
    team.cells = cellOrder(team.side, grid, world.baseX);
  }
  // Re-place every existing structure in its original insertion order.
  const cursors = new Map<string, number>();
  for (const id of world.order) {
    const st = world.structures.get(id);
    if (!st) continue;
    const team = world.teams.get(st.teamId);
    if (!team) continue;
    const i = cursors.get(team.id) ?? 0;
    cursors.set(team.id, i + 1);
    const cell = team.cells[Math.min(i, team.cells.length - 1)];
    st.x = cell.x;
    st.z = cell.z;
  }
  for (const team of world.teams.values()) {
    team.nextCell = cursors.get(team.id) ?? 0;
  }
  return true;
}
