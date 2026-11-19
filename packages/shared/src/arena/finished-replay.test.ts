/**
 * A finished match opens parked on its verdict, however the page got there.
 *
 * The events below are the shapes and timings of the real match 7adcd4df
 * (team-a, Claude): one background research sub-agent spawned at +24.4 s and
 * completed at +91.1 s, Claude's `thinking_tokens` lines stored as REASONING
 * with no text, and a judging ERROR at +422.2 s. Team-b (Codex) wrote a file.
 *
 * Two ways the page showed Claude's squad "1 ACTIVE · 1 SPAWNED" after the end:
 *  - opened on the finished match, the replay was built from the first events
 *    the stream delivered (ending between the spawn and the done) and never
 *    followed the rest, with the verdict up (the observed case; `advanceClock`);
 *  - open while the match finished, the page kept its live renderer, whose clock
 *    reads 0 on a page loaded during judging, and played the finished match on
 *    from there (`rendererAction`).
 */

import { describe, it, expect } from 'vitest';
import type { ArenaEvent } from '../types/event.js';
import { toFrameEvents, toFrameEvent } from './event-model.js';
import { IsoArenaRenderer, finishedReplay, rendererAction, advanceClock } from './renderer.js';
import type { RendererFeedState } from './renderer.js';
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

    expect(squadSummary(live.world.teams.get('team-a')!)).toMatchObject({ active: 1, spawned: 1 });
    expect(live.world.phase).toBe('active');
    expect(live.world.t).toBeLessThan(live.matchEndMs);
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
  });

  it('a finished match that ended without a verdict is parked on the end but never reveals', () => {
    const r = finishedReplay({ teams, events: toFrameEvents(stream(), START), timeLimitMs: TIME_LIMIT }, null, 'FAILED');
    expect(r.world.t).toBe(r.totalMs);
    expect(r.world.replayOf).toBe('FAILED');
    expect(r.world.phase).toBe('active');
    expect(squadSummary(r.world.teams.get('team-a')!).active).toBe(0);
  });
});

describe('rendererAction: which renderer the host shows', () => {
  const at = (over: Partial<RendererFeedState>): RendererFeedState => ({
    isLive: true, fedLive: false, consumed: 0, eventsLength: 0, prefixIntact: true, ...over,
  });

  it('rebuilds a parked replay when a match it fed live has finished', () => {
    // The 7adcd4df page: everything consumed live, then the match is over.
    expect(rendererAction(at({ isLive: false, fedLive: true, consumed: 452, eventsLength: 452 }))).toBe('rebuild-replay');
    // ...also when more arrived with the finish.
    expect(rendererAction(at({ isLive: false, fedLive: true, consumed: 450, eventsLength: 452 }))).toBe('rebuild-replay');
  });

  it('opens a finished match it has not consumed yet as a parked replay', () => {
    expect(rendererAction(at({ isLive: false, consumed: 0, eventsLength: 226 }))).toBe('rebuild-replay');
  });

  it('keeps a replay it already built, and appends to or rebuilds it as the list changes', () => {
    expect(rendererAction(at({ isLive: false, consumed: 226, eventsLength: 226 }))).toBe('keep');
    expect(rendererAction(at({ isLive: false, consumed: 226, eventsLength: 230 }))).toBe('append');
    expect(rendererAction(at({ isLive: false, consumed: 226, eventsLength: 230, prefixIntact: false }))).toBe('rebuild');
  });

  it('feeds a live match incrementally and rebuilds it only on a reorder', () => {
    expect(rendererAction(at({ consumed: 0, eventsLength: 3 }))).toBe('append');
    expect(rendererAction(at({ fedLive: true, consumed: 3, eventsLength: 5 }))).toBe('append');
    expect(rendererAction(at({ fedLive: true, consumed: 5, eventsLength: 5 }))).toBe('keep');
    expect(rendererAction(at({ fedLive: true, consumed: 5, eventsLength: 6, prefixIntact: false }))).toBe('rebuild');
  });

  it('does nothing without events', () => {
    expect(rendererAction(at({ isLive: false, fedLive: true }))).toBe('keep');
  });
});

describe('an error the agent did not raise is not the team\'s activity', () => {
  const judgeError = (stage: string) =>
    ev('ERROR', 'team-a', 422_200, { stage, message: 'AI judge unavailable: rate limited', recovered: true });

  it('a judging error on 7adcd4df leaves the header on the agent\'s own last line, with no hit', () => {
    const r = finishedReplay({ teams, events: toFrameEvents(stream(), START), timeLimitMs: TIME_LIMIT }, 'team-b', 'COMPLETE');
    const a = r.world.teams.get('team-a')!;
    expect(a.latest).toBe('thinking · ');
    expect(a.counts.errors).toBe(0);
    expect(r.world.recent.some((e) => e.kind === 'error')).toBe(false);
    // Nothing from the judging stage reaches the views at all.
    expect(r.world.recent.some((e) => e.t === 422_200)).toBe(false);
  });

  for (const stage of ['judging', 'preflight', 'presentation', 'synthesis', 'collect', 'sandbox']) {
    it(`a '${stage}' error is classified as harness activity, not an agent error`, () => {
      expect(toFrameEvent(judgeError(stage), START).kind).toBe('other');
    });
  }

  it('the agent\'s own error (stage agent, or none) is still applied, with its hit', () => {
    for (const payload of [{ stage: 'agent', message: 'claude exited 1: model not found' }, { message: 'boom' }]) {
      const live = new IsoArenaRenderer({ teams, events: [], timeLimitMs: TIME_LIMIT });
      live.appendEvents([toFrameEvent(ev('ERROR', 'team-a', 5_000, payload), START)]);
      live.setTime(6_000);
      const a = live.world.teams.get('team-a')!;
      expect(a.latest).toBe(`✕ ${payload.message}`);
      expect(a.counts.errors).toBe(1);
      expect(live.world.recent.some((e) => e.kind === 'error')).toBe(true);
    }
  });
});

describe('a replay built from the first events follows the end as the rest arrive', () => {
  // The page streams the history in; at ~1 fps the first frame saw 52 of the
  // 226 events, ending at +30.5 s: after Claude's spawn, before its done.
  const PAUSED = { isLive: false, playing: false, elapsedMs: 0, dtMs: 0 };
  const split = () => {
    const all = toFrameEvents(stream(), START);
    const cut = all.findIndex((e) => e.t > 30_548);
    return { first: all.slice(0, cut), rest: all.slice(cut) };
  };

  it('ends parked on the real end, squad completed, even after a frame touched the renderer it replaced', () => {
    const { first, rest } = split();
    // The renderer the frame began with (built before any events, on the time limit)...
    const before = new IsoArenaRenderer({ teams, events: [], timeLimitMs: TIME_LIMIT });
    // ...which the frame's ingest replaced with a replay of the first events.
    const replay = finishedReplay({ teams, events: first, timeLimitMs: TIME_LIMIT }, 'team-b', 'COMPLETE');
    expect(squadSummary(replay.world.teams.get('team-a')!).active).toBe(1);
    // The rest of that frame ran on the renderer it began with, transport still playing.
    advanceClock(before, { isLive: false, playing: true, elapsedMs: 0, dtMs: 50 });
    // The rest of the history arrives; the view is paused (parked on the end).
    replay.appendEvents(rest);
    for (let i = 0; i < 3; i++) advanceClock(replay, PAUSED);

    expect(replay.world.t).toBe(replay.totalMs);
    expect(replay.world.phase).toBe('reveal');
    expect(squadSummary(replay.world.teams.get('team-a')!)).toMatchObject({ active: 0, spawned: 1 });
  });

  it('a view paused mid-match holds its frame as events arrive', () => {
    const { first, rest } = split();
    const replay = finishedReplay({ teams, events: first, timeLimitMs: TIME_LIMIT }, 'team-b', 'COMPLETE');
    replay.seek(10_000);
    replay.appendEvents(rest);
    advanceClock(replay, PAUSED);
    expect(replay.world.t).toBe(10_000);
  });
});
