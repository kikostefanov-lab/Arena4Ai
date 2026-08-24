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
 * Cells `cellOrder` withholds because the competitor figure stands on them.
 * `planGrid` must budget for these: sizing the grid to the raw lattice count
 * leaves it two cells short, which is precisely the silent-stacking bug this
 * module exists to remove — just smaller and harder to see.
 */
const RESERVED_BASE_CELLS = 2;

/**
 * Smallest grid whose per-side USABLE capacity covers `needed`, keeping the 8:5
 * look. Never returns smaller than the prototype's 8×5 — a two-file competition
 * should still look like an arena, not like a chessboard for ants.
 *
 * `capacity` is what a caller can actually place, base cells already deducted.
 */
export function planGrid(needed: number): GridExtent {
  let gz = 5;
  for (;;) {
    const gx = Math.max(8, Math.round(gz * ASPECT));
    const capacity = (gx - 1) * (2 * gz - 1) - RESERVED_BASE_CELLS;
    if (capacity >= needed || gz > 64) return { gx, gz, capacity };
    gz += 1;
  }
}

/**
 * Cells for one side, ordered nearest-to-base first so early files cluster at
 * the competitor's feet and the territory visibly grows toward the centre line.
 * `side` is -1 (left) or +1 (right).
 */
export function cellOrder(side: -1 | 1, grid: GridExtent, baseX: number): Cell[] {
  const cells: Cell[] = [];
  for (let gx = 1; gx <= grid.gx - 1; gx++) {
    for (let gz = -grid.gz + 1; gz <= grid.gz - 1; gz++) {
      cells.push({ x: side * gx, z: gz });
    }
  }
  const bx = side * baseX;
  cells.sort((a, b) => {
    const da = Math.hypot(a.x - bx, a.z * 1.15);
    const db = Math.hypot(b.x - bx, b.z * 1.15);
    return da - db;
  });
  // Skip the two cells the competitor figure stands on.
  return cells.filter((c) => !(Math.abs(c.x - bx) < 0.8 && Math.abs(c.z) < 0.6));
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
