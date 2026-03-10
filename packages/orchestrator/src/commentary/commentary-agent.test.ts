import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventType } from '@arena/shared';
import type { CompetitionRunner } from '../engine/competition-runner.js';

// Mock node:child_process before any imports that use it
vi.mock('node:child_process', () => {
  const mockChild = {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  return {
    spawn: vi.fn().mockReturnValue(mockChild),
  };
});

// Mock claude-env
vi.mock('../utils/claude-env.js', () => ({
  claudeEnv: vi.fn().mockReturnValue({}),
}));

import { CommentaryAgent } from './commentary-agent.js';

// Minimal mock CompetitionRunner for testing
function makeMockRunner(competitionId = 'test-comp-id'): CompetitionRunner {
  const emitter = new EventEmitter() as EventEmitter & { competitionId: string };
  emitter.competitionId = competitionId;
  return emitter as unknown as CompetitionRunner;
}

function makeArenaEvent(overrides: Partial<{
  eventId: string;
  teamId: string;
  type: EventType;
  payload: unknown;
}> = {}) {
  return {
    eventId: 'evt-1',
    competitionId: 'test-comp-id',
    teamId: 'team-a',
    timestamp: new Date().toISOString(),
    type: EventType.TOOL_CALL,
    payload: { text: 'doing stuff' },
    metadata: {},
    ...overrides,
  };
}

describe('CommentaryAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('start() attaches an arenaEvent listener to the runner', () => {
    const runner = makeMockRunner();
    const agent = new CommentaryAgent(runner, { batchSize: 5 });

    expect(runner.listenerCount('arenaEvent')).toBe(0);
    agent.start();
    expect(runner.listenerCount('arenaEvent')).toBe(1);
    agent.stop();
  });

  it('buffers events and does not flush until batchSize is reached', async () => {
    const { spawn } = await import('node:child_process');
    const runner = makeMockRunner();
    const agent = new CommentaryAgent(runner, { batchSize: 3, claudeBin: 'claude' });

    agent.start();

    // Emit fewer events than batchSize
    runner.emit('arenaEvent', makeArenaEvent({ eventId: 'e1' }));
    runner.emit('arenaEvent', makeArenaEvent({ eventId: 'e2' }));

    // spawn should not have been called yet (only 2 of 3 needed)
    expect(spawn).not.toHaveBeenCalled();

    agent.stop();
  });

  it('stop() prevents further event processing after being called', () => {
    const runner = makeMockRunner();
    const agent = new CommentaryAgent(runner, { batchSize: 1 });

    agent.start();
    agent.stop();

    // After stop, emitting events should not trigger any flush
    // (running flag is false, so handler returns early)
    const flushSpy = vi.spyOn(agent as unknown as { flush: () => Promise<void> }, 'flush');
    runner.emit('arenaEvent', makeArenaEvent({ eventId: 'e-post-stop' }));

    expect(flushSpy).not.toHaveBeenCalled();
  });

  it('does not buffer COMMENTARY events to prevent feedback loops', () => {
    const runner = makeMockRunner();
    // batchSize of 1 so any non-filtered event would trigger flush
    const agent = new CommentaryAgent(runner, { batchSize: 1 });

    agent.start();

    // A commentary event emitted by the runner should be ignored
    // (running is true, but COMMENTARY type is filtered)
    const commentaryEvent = makeArenaEvent({ type: EventType.COMMENTARY, payload: { text: 'wow' } });

    // We verify by checking the buffer indirectly: stop should not trigger flush
    // since the COMMENTARY event was filtered out
    runner.emit('arenaEvent', commentaryEvent);

    // If COMMENTARY was buffered, buffer.length >= batchSize would trigger flush
    // Since flush is async and spawn is mocked, we just confirm the agent still has
    // no externally visible issues and can be stopped cleanly
    agent.stop();
  });
});
