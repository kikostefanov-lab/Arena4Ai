/**
 * A finished match opens parked on its verdict, however the page got there.
 *
 * The events below are the shapes and timings of the real match 7adcd4df
 * (team-a, Claude): one background research sub-agent spawned at +24.4 s and
 * completed at +91.1 s, Claude's `thinking_tokens` lines stored as REASONING
 * with no text, and a judging ERROR at +422.2 s. Team-b (Codex) wrote a file.
 *
 * A page that was LIVE when the match finished kept its live renderer. The live
 * clock reads 0 on a page loaded after the agents finished (the page's elapsed
 * timer does not run in COLLECTING / JUDGING) and the transport started out
 * playing, so the finished match played from the start at 3x instead of
 * opening on its verdict, and the header read "1 ACTIVE · 1 SPAWNED" and
 * "thinking ·" for as long as the playhead sat between the spawn and the done.
 */

import { describe, it, expect } from 'vitest';
import type { ArenaEvent } from '../types/event.js';
import { toFrameEvents, toFrameEvent } from './event-model.js';
import { IsoArenaRenderer, finishedReplay } from './renderer.js';
import { squadSummary } from './squad-hud.js';

const START = Date.parse('2026-11-19T14:18:49.218Z');
let n = 0;
const ev = (type: string, teamId: string, atMs: number, payload: Record<string, unknown>, metadata: Record<string, unknown> = {}): ArenaEvent => ({
  eventId: `e${++n}`,
  competitionId: '7adcd4df',
  teamId,
  timestamp: new Date(START + atMs).toISOString(),
  type,
  payload,
  metadata,
} as unknown as ArenaEvent);

const AGENT = 'a6fc37f9988ac33f3';
const thinking = (atMs: number, metadata: Record<string, unknown> = {}) =>
  ev('REASONING', 'team-a', atMs, { raw: { type: 'system', subtype: 'thinking_tokens', session_id: 's' } }, metadata);

const stream = (): ArenaEvent[] => [
  ev('REASONING', 'team-a', 0, { raw: { type: 'system', subtype: 'init', session_id: 's' } }),
  thinking(2_098),
  ev('REASONING', 'team-a', 24_382, { raw: { type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: AGENT, task_type: 'local_agent' }] } }),
  ev('SUB_AGENT_SPAWN', 'team-a', 24_384, { kind: 'general-purpose', depth: 1, label: 'Research…', agentId: AGENT, background: true, description: 'Research alternatives evidence' }),
  ev('TOOL_CALL', 'team-a', 25_728, { tool: 'WebFetch', input: { url: 'https://example.com' } }, { agentId: AGENT }),
  thinking(49_180, { agentId: AGENT }),
  ev('SUB_AGENT_DONE', 'team-a', 91_053, { model: 'claude-opus-5-5', status: 'completed', agentId: AGENT }),
  ev('REASONING', 'team-a', 91_054, { raw: { type: 'system', subtype: 'background_tasks_changed', tasks: [] } }),
  ev('FILE_MODIFY', 'team-b', 150_000, { path: 'decision.md', op: 'create', opSource: 'tool', tool: 'apply_patch' }),
  thinking(218_608),
  ev('ERROR', 'team-a', 422_200, { stage: 'judging', message: 'AI judge unavailable: rate limited or overloaded by the gemini API.' }),
];

const teams = [
  { id: 'team-a', model: 'claude:architect', persona: 'architect' },
  { id: 'team-b', model: 'codex:standard', persona: 'standard' },
];
const TIME_LIMIT = 2_700_000;

describe('a finished match opens parked on its verdict', () => {
  it('reproduces the stale view: a renderer fed live and played on after the finish shows the squad mid-match', () => {
    // What the page did: the live renderer, fed the history, on a clock of 0.
    const live = new IsoArenaRenderer({ teams, events: [], timeLimitMs: TIME_LIMIT });
    live.appendEvents(stream().map((e) => toFrameEvent(e, START)));
    live.setTime(0);
    // The match finishes: final state declared, transport still playing at 3x.
    live.setWinner('team-b');
    live.setFinalState('COMPLETE');
    while (live.world.t < 50_000) live.tick(16.7 * 3);

    const a = live.world.teams.get('team-a')!;
    expect(squadSummary(a)).toMatchObject({ active: 1, spawned: 1 });
    expect(a.latest).toBe('thinking · ');
    expect(live.world.phase).toBe('active');
  });

  it('a finished replay of the same stream is parked on the end: squad completed, verdict shown', () => {
    const r = finishedReplay(
      { teams, events: toFrameEvents(stream(), START), timeLimitMs: TIME_LIMIT },
      'team-b',
      'COMPLETE',
    );
    expect(r.world.t).toBe(r.totalMs);
    expect(r.world.phase).toBe('reveal');
    expect(r.world.winnerId).toBe('team-b');

    const a = r.world.teams.get('team-a')!;
    expect(squadSummary(a)).toEqual({ active: 0, spawned: 1, failed: 0, models: ['claude-opus-5-5'] });
    expect(a.squad.get(AGENT)!.status).toBe('completed');
    expect(a.latest).toMatch(/^✕ AI judge unavailable/);
  });

  it('a finished match that ended without a verdict is parked on the end but never reveals', () => {
    const r = finishedReplay({ teams, events: toFrameEvents(stream(), START), timeLimitMs: TIME_LIMIT }, null, 'FAILED');
    expect(r.world.t).toBe(r.totalMs);
    expect(r.world.replayOf).toBe('FAILED');
    expect(r.world.phase).toBe('active');
    expect(squadSummary(r.world.teams.get('team-a')!).active).toBe(0);
  });
});
