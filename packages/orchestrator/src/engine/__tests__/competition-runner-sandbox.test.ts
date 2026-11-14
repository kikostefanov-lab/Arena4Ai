import { describe, it, expect, vi } from 'vitest';
import { CompetitionState, EventType } from '@arena/shared';

const verifyMock = vi.fn();

vi.mock('../../sandbox/sandbox-manager.js', async (orig) => {
  const actual = await orig<typeof import('../../sandbox/sandbox-manager.js')>();
  return {
    ...actual,
    SandboxManager: class {
      verify = verifyMock;
    },
  };
});

import { CompetitionRunner } from '../competition-runner.js';
import { SandboxUnavailableError } from '../../sandbox/sandbox-manager.js';

const brief = {
  title: 't', problem: 'p', constraints: [], deliverables: [], rubric: [],
  timeLimit: 1000,
} as never;
const teams = [
  { id: 'team-a', model: 'claude:architect' },
  { id: 'team-b', model: 'claude:speedrunner' },
] as never;

describe('CompetitionRunner sandbox verification', () => {
  it('fails cleanly (FAILED + ERROR event, error emitted) when the sandbox is unavailable', async () => {
    verifyMock.mockRejectedValue(new SandboxUnavailableError('docker-missing', 'Docker is not installed'));
    const runner = new CompetitionRunner(brief, teams, { printResults: false });

    const states: string[] = [];
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    runner.on('stateChange', (s: string) => states.push(s));
    runner.on('arenaEvent', (e: { type: string; payload: Record<string, unknown> }) => { events.push(e); });
    runner.on('error', () => {});

    await expect(runner.run()).rejects.toThrow(/Docker is not installed/);

    expect(states.at(-1)).toBe(CompetitionState.FAILED);
    const err = events.find((e) => e.type === EventType.ERROR);
    expect(err?.payload.stage).toBe('sandbox');
    expect(String(err?.payload.message)).toContain('Docker is not installed');
  });
});
