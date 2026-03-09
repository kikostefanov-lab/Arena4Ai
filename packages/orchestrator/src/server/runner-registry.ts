import type { CompetitionRunner } from '../engine/competition-runner.js';

/**
 * In-memory map of competitionId → active CompetitionRunner.
 * Used to subscribe WebSocket clients to live events and to
 * route control commands (cancel/pause/resume).
 *
 * Entries are removed 60s after competition completes.
 */
export const runnerRegistry = new Map<string, CompetitionRunner>();
