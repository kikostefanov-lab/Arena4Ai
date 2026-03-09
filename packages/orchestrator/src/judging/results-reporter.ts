import type { ScoreCard, Brief } from '@arena/shared';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

function bar(score: number, width = 20): string {
  const filled = Math.round(score * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Print a formatted competition results summary to stdout.
 *
 * Displays:
 *   - Competition title and brief ID
 *   - Ranked scorecards with per-criterion breakdown
 *   - Winner announcement
 */
export function printResults(brief: Brief, scorecards: ScoreCard[]): void {
  const sorted = [...scorecards].sort((a, b) => a.rank - b.rank);

  console.log();
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log(`${BOLD}${CYAN}  ARENA RESULTS — ${brief.title}${RESET}`);
  console.log(`${DIM}  Brief ID: ${brief.id}${RESET}`);
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log();

  for (const card of sorted) {
    const medal = card.rank === 1 ? '🥇' : card.rank === 2 ? '🥈' : '🥉';
    const pct = (card.finalScore * 100).toFixed(1);
    console.log(`${BOLD}${medal}  Rank #${card.rank} — ${card.teamId}${RESET}`);
    console.log(`   Final Score: ${GREEN}${pct}%${RESET}  ${bar(card.finalScore)}`);

    // Per-criterion breakdown from the first judge result (for brevity)
    const firstResult = card.judgeResults[0];
    if (firstResult) {
      console.log(`   ${DIM}Criteria (${firstResult.judgeId}):${RESET}`);
      for (const cs of firstResult.scores) {
        const criterion = brief.rubric.criteria.find((c) => c.id === cs.criterionId);
        const max = criterion?.maxScore ?? 10;
        const norm = cs.score / max;
        console.log(
          `     ${cs.criterionId.padEnd(20)} ${String(cs.score).padStart(4)}/${max}  ${bar(norm, 10)}  ${DIM}${cs.commentary}${RESET}`,
        );
      }
    }

    if (card.judgeResults.length > 1) {
      console.log(
        `   ${DIM}Judges: ${card.judgeResults.map((j) => j.judgeId).join(', ')}${RESET}`,
      );
    }
    console.log();
  }

  const winner = sorted[0];
  if (winner) {
    console.log(`${BOLD}${YELLOW}  Winner: ${winner.teamId} with ${(winner.finalScore * 100).toFixed(1)}%${RESET}`);
  }
  console.log(`${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
  console.log();
}

/**
 * Serialise scorecards to a JSON-compatible plain object for persistence
 * or API responses.
 */
export function formatResultsJson(brief: Brief, scorecards: ScoreCard[]): object {
  return {
    briefId: brief.id,
    title: brief.title,
    scorecards: [...scorecards].sort((a, b) => a.rank - b.rank),
    winner: scorecards.find((c) => c.rank === 1)?.teamId ?? null,
  };
}
