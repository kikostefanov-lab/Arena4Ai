/**
 * The event stream must subscribe to the runner BEFORE reading history, or a
 * viewer who connects mid-match can permanently miss an event emitted in
 * between (a missed SUB_AGENT_DONE leaves a ghost robot on screen).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

vi.mock('../../db/client.js', () => ({ db: {} }));
vi.mock('../repo.js', () => ({
  repo: { getEvents: vi.fn(), getResult: vi.fn() },
}));
vi.mock('../runner-registry.js', () => ({ runnerRegistry: new Map() }));

import { attachWebSocket } from '../websocket.js';
import { repo } from '../repo.js';
import { runnerRegistry } from '../runner-registry.js';

const getEvents = vi.mocked(repo.getEvents);
const getResult = vi.mocked(repo.getResult);

const row = (id: string, type = 'REASONING') => ({
  id, competitionId: 'c1', teamId: 'a', timestamp: '2026-01-01T00:00:00Z',
  type, payload: {}, metadata: {},
});
const live = (id: string, type = 'REASONING') => ({
  eventId: id, competitionId: 'c1', teamId: 'a', timestamp: '2026-01-01T00:00:00Z',
  type, payload: {}, metadata: {},
});

let server: Server;
let runner: EventEmitter;
let clients: WebSocket[] = [];

beforeEach(async () => {
  vi.resetAllMocks();
  getResult.mockResolvedValue(null as never);
  runner = new EventEmitter();
  (runnerRegistry as Map<string, unknown>).clear();
  (runnerRegistry as Map<string, unknown>).set('c1', runner);
  server = createServer();
  attachWebSocket(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
});

afterEach(async () => {
  for (const c of clients) c.terminate();
  clients = [];
  await new Promise<void>((r) => server.close(() => r()));
});

/** Connect and collect messages; resolves helpers once the socket is open. */
function connect() {
  const { port } = server.address() as AddressInfo;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/competitions/c1/stream`);
  clients.push(ws);
  const msgs: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  return { ws, msgs };
}

const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('websocket stream', () => {
  it('does not lose an event emitted while history is being read', async () => {
    let release!: (rows: unknown[]) => void;
    getEvents.mockReturnValue(new Promise((r) => { release = r; }) as never);
    const { msgs } = connect();

    await until(() => getEvents.mock.calls.length === 1);
    runner.emit('arenaEvent', live('x', 'SUB_AGENT_DONE'));
    release([row('h1')]);

    await until(() => msgs.some((m) => m.eventId === 'x'));
    await new Promise((r) => setTimeout(r, 50));
    expect(msgs.filter((m) => m.eventId === 'x')).toHaveLength(1);
    expect(msgs.map((m) => m.eventId)).toEqual(['h1', 'x']);
  });

  it('does not duplicate an event that is both persisted and buffered', async () => {
    let release!: (rows: unknown[]) => void;
    getEvents.mockReturnValue(new Promise((r) => { release = r; }) as never);
    const { msgs } = connect();

    await until(() => getEvents.mock.calls.length === 1);
    runner.emit('arenaEvent', live('dup'));
    release([row('h1'), row('dup')]);
    await until(() => msgs.length >= 2);
    runner.emit('arenaEvent', live('after'));
    await until(() => msgs.some((m) => m.eventId === 'after'));

    expect(msgs.filter((m) => m.eventId === 'dup')).toHaveLength(1);
  });

  it('_seq is contiguous across history, buffered and direct events', async () => {
    let release!: (rows: unknown[]) => void;
    getEvents.mockReturnValue(new Promise((r) => { release = r; }) as never);
    const { msgs } = connect();

    await until(() => getEvents.mock.calls.length === 1);
    runner.emit('arenaEvent', live('b1'));
    runner.emit('arenaEvent', live('h2')); // persisted too: must not burn a seq
    release([row('h1'), row('h2')]);
    await until(() => msgs.length >= 3);
    runner.emit('arenaEvent', live('d1'));
    await until(() => msgs.some((m) => m.eventId === 'd1'));

    const events = msgs.filter((m) => m.eventId);
    expect(events.map((m) => m.eventId)).toEqual(['h1', 'h2', 'b1', 'd1']);
    expect(events.map((m) => m._seq)).toEqual([1, 2, 3, 4]);
  });

  it('still sends COMPLETE and closes when a result exists', async () => {
    getEvents.mockResolvedValue([row('h1')] as never);
    getResult.mockResolvedValue({ scorecards: [], winnerId: null } as never);
    const { ws, msgs } = connect();
    await new Promise((r) => ws.on('close', r));
    expect(msgs.map((m) => m.type)).toEqual(['REASONING', 'COMPLETE']);
  });

  it('carries each team\'s per-judge panel scores in the COMPLETE result', async () => {
    getEvents.mockResolvedValue([] as never);
    getResult.mockResolvedValue({
      winnerId: 'a',
      scorecards: [{
        teamId: 'a', finalScore: 0.7, rank: 1,
        judgePanel: [
          { provider: 'claude', model: 'claude-opus-5', judgeId: 'ai-claude/claude-opus-5' },
          { provider: 'gemini', model: 'cli-default', judgeId: 'ai-gemini/cli-default', failure: 'timeout' },
        ],
        judgeResults: [{ judgeId: 'ai-claude/claude-opus-5', overallScore: 0.7, scores: [] }],
      }],
    } as never);
    const { ws, msgs } = connect();
    await new Promise((r) => ws.on('close', r));
    const complete = msgs.find((m) => m.type === 'COMPLETE') as { result: { teams: Array<{ judges?: { label: string; rows: unknown[]; average: number } }> } };
    expect(complete.result.teams[0]!.judges).toMatchObject({ label: 'Cross-vendor panel', average: 0.7 });
    expect(complete.result.teams[0]!.judges!.rows).toHaveLength(2);
  });

  it('sends each criterion as the mean across the team\'s judges, not the first judge\'s score', async () => {
    getEvents.mockResolvedValue([] as never);
    getResult.mockResolvedValue({
      winnerId: 'a',
      scorecards: [{
        teamId: 'a', finalScore: 0.7, rank: 1,
        judgeResults: [
          { judgeId: 'ai-claude/m1', overallScore: 0.9, scores: [{ criterionId: 'q', score: 9, commentary: 'c' }] },
          { judgeId: 'ai-codex/m2', overallScore: 0.5, scores: [{ criterionId: 'q', score: 5, commentary: 'x' }] },
        ],
      }],
    } as never);
    const { ws, msgs } = connect();
    await new Promise((r) => ws.on('close', r));
    const complete = msgs.find((m) => m.type === 'COMPLETE') as { result: { teams: Array<{ criteriaScores: Array<{ criterionId: string; score: number }> }> } };
    expect(complete.result.teams[0]!.criteriaScores).toEqual([
      expect.objectContaining({ criterionId: 'q', score: 7, maxScore: 10 }),
    ]);
  });

  const EVENTS = ['arenaEvent', 'stateChange', 'result', 'error'];
  const listenerCounts = () => EVENTS.map((e) => runner.listenerCount(e));

  it('leaves no runner listeners when the client closes during the handshake window', async () => {
    getEvents.mockResolvedValue([] as never);
    const { ws } = connect();
    await new Promise((r) => ws.on('open', r));
    ws.close();
    await new Promise((r) => ws.on('close', r));
    await new Promise((r) => setTimeout(r, 150));
    expect(listenerCounts()).toEqual([0, 0, 0, 0]);
  });

  it('removes runner listeners after a normal close', async () => {
    getEvents.mockResolvedValue([row('h1')] as never);
    const { ws, msgs } = connect();
    await until(() => msgs.length === 1);
    expect(listenerCounts()).toEqual([1, 1, 1, 1]);
    ws.close();
    await until(() => listenerCounts().every((n) => n === 0));
  });
});
