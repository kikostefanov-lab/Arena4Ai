/**
 * Tournament cancellation must stop the active match and must never be turned
 * into a completed tournament. CompetitionRunner is stubbed — no CLIs, DB or Docker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const matches: FakeMatchRunner[] = [];
let completeOnCancel = false;

class FakeMatchRunner extends EventEmitter {
  readonly competitionId = `match-${matches.length + 1}`;
  cancelled = false;
  cancel = vi.fn(async () => {
    this.cancelled = true;
    this._release?.();
  });
  private _release?: () => void;
  constructor() {
    super();
    matches.push(this);
  }
  /** Runs until cancelled — the match is "in flight" when the tournament is cancelled. */
  async run() {
    if (this.cancelled) throw new Error('cancelled');
    await new Promise<void>((resolve) => { this._release = resolve; });
    if (!completeOnCancel) throw new Error('cancelled');
    // Simulates a match that finishes at the same instant it is cancelled.
    return { winner: 'team-a', scorecards: [{ teamId: 'team-a', finalScore: 1 }] };
  }
}

vi.mock('./competition-runner.js', () => ({ CompetitionRunner: vi.fn().mockImplementation(() => new FakeMatchRunner()) }));

import { TournamentRunner } from './tournament-runner.js';

const brief = { id: 'b', title: 't', problem: 'p', constraints: [], deliverables: [], rubric: { criteria: [] }, timeLimitMs: 1000 } as never;

async function until(predicate: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('until(): timed out');
    await new Promise((r) => setTimeout(r, 2));
  }
}

beforeEach(() => {
  matches.length = 0;
  completeOnCancel = false;
});

for (const type of ['ROUND_ROBIN', 'SWISS'] as const) {
  describe(`TournamentRunner.cancel (${type})`, () => {
    it('cancels the active match, starts no further match, and never reports completion', async () => {
      const runner = new TournamentRunner(brief, ['claude:a', 'claude:b', 'claude:c'], { type, skipSandbox: true });
      const completed = vi.fn();
      runner.on('complete', completed);
      const settled = runner.run().then(() => 'resolved' as const, (e: Error) => e);

      await until(() => matches.length === 1);
      await runner.cancel();
      const outcome = await settled;

      expect(matches[0]!.cancel).toHaveBeenCalled();
      expect(matches).toHaveLength(1);
      expect(completed).not.toHaveBeenCalled();
      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).name).toBe('TournamentCancelledError');
    });

    it('does not turn a match that finishes at cancel time into a completed tournament', async () => {
      completeOnCancel = true;
      const runner = new TournamentRunner(brief, ['claude:a', 'claude:b'], { type, skipSandbox: true });
      const completed = vi.fn();
      runner.on('complete', completed);
      const settled = runner.run().then(() => 'resolved' as const, (e: Error) => e);

      await until(() => matches.length === 1);
      await runner.cancel();
      const outcome = await settled;

      expect(completed).not.toHaveBeenCalled();
      expect((outcome as Error).name).toBe('TournamentCancelledError');
    });
  });
}
