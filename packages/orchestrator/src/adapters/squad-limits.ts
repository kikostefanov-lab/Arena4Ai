/** Squad limits per team: concurrent sub-agents and nesting depth. */
const DEFAULT_MAX_CONCURRENT = 6;
const DEFAULT_MAX_DEPTH = 1;

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function squadLimits(env: NodeJS.ProcessEnv = process.env): { maxConcurrent: number; maxDepth: number } {
  return {
    maxConcurrent: positiveInt(env.ARENA_SQUAD_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT),
    maxDepth: positiveInt(env.ARENA_SQUAD_MAX_DEPTH, DEFAULT_MAX_DEPTH),
  };
}
