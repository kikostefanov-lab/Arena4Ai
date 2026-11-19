/**
 * Floor layout: where each file's block stands.
 *
 * WHAT WAS WRONG IN THE PROTOTYPE
 * The spike fixed the floor at GRID_X=8, GRID_Z=5, which yields 63 cells per
 * side, and then placed files with
 *
 *     team.cells[Math.min(team.nextCell++, team.cells.length - 1)]
 *
 * so file 64 and every file after it lands on the SAME cell as file 63, silently
 * stacking on top of each other. A fizzbuzz brief never noticed. A real
 * competition on a real repository would put a few hundred files on that floor
 * and the arena would show sixty-three of them. The clamp hid the failure
 * instead of surfacing it, which is the worst version of this bug.
 *
 * The grid now GROWS with the file count, keeping roughly the prototype's 8:5
 * proportions so the composition holds, and the camera zooms to fit. Past a
 * readable ceiling the layout rolls files up to their directory rather than
 * pretending to draw one block per file — see `BlockBudget`.
 */

export interface Cell {
  x: number;
  z: number;
}

export interface GridExtent {
  /** Half-extent along x. Cells occupy 1..gx-1 on each side of the centre line. */
  gx: number;
  /** Half-extent along z. Cells occupy -(gz-1)..(gz-1). */
  gz: number;
  /** Cells available per team at this extent. */
  capacity: number;
}

/** The proportions the visual direction was designed at. */
const ASPECT = 8 / 5;

/**
 * How many squad members a team can have drawn at once. Each gets one reserved
 * slot cell (see `squadSlotCells`); members past this are counted, not drawn.
 */
export const SQUAD_SLOTS = 6;

/**
 * Where an outermost band seats its competitor figure, as a distance from the
 * centre line. The world passes this to `bandsFor`; `planGrid` needs the same
 * value because the figure and squad cells it reserves depend on it.
 */
export const DEFAULT_BASE_X = 6.2;

/**
 * Smallest grid whose per-side USABLE capacity covers `needed`, keeping the 8:5
 * look. Never returns smaller than the prototype's 8×5 — a two-file competition
 * should still look like an arena, not like a chessboard for ants.
 *
 * `capacity` is what a caller can actually place in EVERY band: the smallest
 * `bandCells(...)` count over the teams' bands, so the cells the competitor
 * figure and its squad slots stand on are already deducted. Budgeting from the
 * raw lattice count instead leaves the grid short, which is precisely the
 * silent-stacking bug this module exists to remove. It is measured, not estimated: the old
 * `floor((2gx-1)/n)` column count over-claimed for an interior band at N=3,
 * which also loses the x=0 centre column (needed=10 claimed 37 cells while the
 * middle band had 30), so the middle team stacked blocks before the grid grew.
 */
export function planGrid(needed: number, teamCount = 2, baseX = DEFAULT_BASE_X): GridExtent {
  const n = Math.max(1, teamCount);
  let gz = 5;
  for (;;) {
    const gx = Math.max(8, Math.round(gz * ASPECT));
    // Each team owns one band of the long axis, so per-team capacity is the
    // smallest band's usable cells — not half of the lattice. Sizing as though
    // there were always two teams would leave a four-way competition half the
    // floor it needs and reintroduce stacking at N > 2.
    const probe: GridExtent = { gx, gz, capacity: 0 };
    let capacity = Infinity;
    for (const band of bandsFor(n, probe, baseX)) {
      capacity = Math.min(capacity, bandCells(band, probe).length);
    }
    if (capacity >= needed || gz > 64) return { gx, gz, capacity };
    gz += 1;
  }
}

// ─── parallel bands ──────────────────────────────────────────────────────────

/**
 * The floor is divided into N equal PARALLEL BANDS across its long axis, one per
 * team, in team order.
 *
 * WHY BANDS (the design call is god's, recorded here so it is not re-litigated):
 * the arena reads left-to-right as a comparison, the HUD is already per-team
 * along the top, and a ring would turn "who built more" into a question of
 * perspective rather than height. Bands keep the one thing the picture exists
 * for — comparing cities side by side — true at any N.
 *
 * WHAT THIS REPLACED: `side = i % 2 === 0 ? -1 : 1`, which gave teams 0 and 2 the
 * SAME half of the floor. On a three-way they shared every cell and stood inside
 * one another. Every test and every harness scenario used two teams, so nothing
 * caught it until a real 3-team competition was opened.
 *
 * THE TWO-TEAM CASE IS UNCHANGED BY CONSTRUCTION: with N=2 the boundary falls at
 * x=0 and the candidate columns are exactly the old ±(1..gx-1). `cellOrder`
 * delegates here so there is one implementation rather than two that must agree.
 */
export interface Band {
  lo: number;
  hi: number;
  /** Where the competitor figure stands. */
  baseX: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Where the figure stands in band `index`.
 *
 * The OUTERMOST bands seat it at ±`baseX` — the constant the composition was
 * designed around, and a fixed distance from the centre line rather than a
 * fraction of the band, because that is what the two-team arena has always done
 * at every grid size. Deriving it from band width instead moved the figure as
 * soon as the grid grew for a large competition, which is a change to the
 * accepted two-team picture however reasonable it looked.
 *
 * INTERIOR bands (only possible at N ≥ 3) have no outer edge to measure from, so
 * they take their band's centre. At N=2 there are no interior bands, which is
 * why this branch cannot affect the case that had to stay identical.
 */
export function bandFor(index: number, teamCount: number, grid: GridExtent, baseX: number): Band {
  const n = Math.max(1, teamCount);
  if (n === 1) return { lo: -grid.gx, hi: grid.gx, baseX: 0 };
  const width = (2 * grid.gx) / n;
  const lo = -grid.gx + index * width;
  const hi = lo + width;
  const outermost = index === 0 || index === n - 1;
  const seat = outermost
    ? clamp(index === 0 ? -baseX : baseX, lo, hi)
    : (lo + hi) / 2;
  return { lo, hi, baseX: seat };
}

/** Every team's band, in team order. */
export function bandsFor(teamCount: number, grid: GridExtent, baseX: number): Band[] {
  return Array.from({ length: Math.max(1, teamCount) }, (_, i) => bandFor(i, teamCount, grid, baseX));
}

/**
 * Cells belonging to one band, nearest-to-base first so early files cluster at
 * the competitor's feet and the territory grows outward.
 *
 * The x=0 column is never a candidate: it is the centre line the floor is drawn
 * around, and excluding it is what makes the N=2 split identical to the original.
 */
export function bandCells(band: Band, grid: GridExtent): Cell[] {
  const cells: Cell[] = [];
  for (let gx = -grid.gx + 1; gx <= grid.gx - 1; gx++) {
    if (gx === 0) continue;
    if (gx < band.lo || gx >= band.hi) continue;
    for (let gz = -grid.gz + 1; gz <= grid.gz - 1; gz++) cells.push({ x: gx, z: gz });
  }
  cells.sort((a, b) => {
    const da = Math.hypot(a.x - band.baseX, a.z * 1.15);
    const db = Math.hypot(b.x - band.baseX, b.z * 1.15);
    return da - db;
  });
  // Skip the cells the competitor figure and its squad stand on.
  const slots = new Set(squadSlotCells(band).map((c) => `${c.x},${c.z}`));
  return cells.filter((c) => !isFigureCell(band, c) && !slots.has(`${c.x},${c.z}`));
}

/** True for the cell(s) the team's lead figure stands on. */
function isFigureCell(band: Band, c: Cell): boolean {
  return Math.abs(c.x - band.baseX) < 0.8 && Math.abs(c.z) < 0.6;
}

/**
 * Where the squad stands, as (forward, lateral) offsets from the lead: a shallow
 * arc in front of it, the middle pair furthest forward. The z=0 line straight
 * ahead is left open so the lead keeps a clear line to its own blocks. Slot 0 is
 * the first entry.
 */
const SQUAD_ARC: ReadonlyArray<readonly [forward: number, z: number]> = [
  [2, 1], [2, -1], [1.6, 2], [1.6, -2], [1, 3], [1, -3],
];

/**
 * The `SQUAD_SLOTS` cells a team's squad members stand on, in slot order.
 * `bandCells` never hands these out, so a block can never stand where a squad
 * robot does.
 *
 * Takes only the band so every view can compute it from `TeamState.band`. It
 * stays on the lattice and inside the band without knowing the grid: columns
 * strictly inside `(lo, hi)` are always grid columns (bands tile `[-gx, gx]`),
 * and every grid has `gz >= 5`, so rows -3..3 always exist. A narrow band
 * squeezes the arc toward the lead rather than spilling into a neighbour's band.
 *
 * "Forward" is the way the lead faces: toward +x for a band left of (or on) the
 * centre line, toward -x otherwise, matching the 3D scene's facing rule.
 */
export function squadSlotCells(band: Band): Cell[] {
  const dir = band.baseX <= 0 ? 1 : -1;
  const xs: number[] = [];
  for (let x = Math.floor(band.lo) + 1; x < band.hi; x++) if (x !== 0) xs.push(x);
  const candidates: Cell[] = [];
  for (const x of xs) for (let z = -3; z <= 3; z++) {
    const c = { x, z };
    if (!isFigureCell(band, c)) candidates.push(c);
  }
  const taken = new Set<string>();
  const out: Cell[] = [];
  for (const [forward, z] of SQUAD_ARC) {
    const ix = band.baseX + dir * forward;
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of candidates) {
      if (taken.has(`${c.x},${c.z}`)) continue;
      const d = Math.hypot(c.x - ix, c.z - z);
      // Strict `<` keeps the first candidate on a tie, and candidates are
      // generated in a fixed order, so the choice is deterministic.
      if (d < bestD) { best = c; bestD = d; }
    }
    if (!best) break;
    taken.add(`${best.x},${best.z}`);
    out.push(best);
  }
  return out;
}

/**
 * The original two-team helper, kept as the name callers know and implemented in
 * terms of bands so there is exactly one layout implementation. `side` is -1
 * (left, team 0) or +1 (right, team 1).
 */
export function cellOrder(side: -1 | 1, grid: GridExtent, baseX: number): Cell[] {
  return bandCells(bandFor(side === -1 ? 0 : 1, 2, grid, baseX), grid);
}

// ─── block budget ────────────────────────────────────────────────────────────

/**
 * Above this many files for one team, one-block-per-file stops being legible:
 * the blocks are smaller than their own outlines and the floor reads as noise.
 * Rather than clamp and lie, the layout rolls files up to their directory and
 * says so in the legend.
 */
export const MAX_BLOCKS_PER_TEAM = 240;

export interface BlockBudget {
  /** True once rollup is in effect for this team. */
  rolledUp: boolean;
  /** Files seen. */
  files: number;
  /** Blocks actually drawn. */
  blocks: number;
  note?: string;
}

/**
 * The key a path is drawn under. Below the budget this is the path itself; above
 * it, the containing directory, so a 2,000-file monorepo becomes a readable
 * skyline of packages instead of an unreadable fog of identical dots.
 */
export function blockKeyFor(path: string, rolledUp: boolean): string {
  if (!rolledUp) return path;
  const i = path.lastIndexOf('/');
  return i <= 0 ? '(root)' : `${path.slice(0, i)}/`;
}
