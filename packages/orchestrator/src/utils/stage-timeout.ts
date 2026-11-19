/**
 * Timeout for a helper stage (judge, presentation) that reads `inputChars` of
 * deliverables: a base of 2 minutes plus one second per 2000 characters, capped
 * at 10 minutes. A bigger squad deliverable legitimately needs longer to read.
 */
export function stageTimeoutMs(inputChars: number): number {
  return Math.min(600_000, 120_000 + Math.ceil(inputChars / 2000) * 1000);
}
