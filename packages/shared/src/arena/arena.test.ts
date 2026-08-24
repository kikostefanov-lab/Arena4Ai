import { describe, it, expect } from 'vitest';
import type { ArenaEvent } from '../types/event.js';
import { PROVIDER_FILE_CAPABILITIES } from '../types/event.js';
import {
  toFrameEvent,
  toFrameEvents,
  resolveTelemetry,
  capabilityFor,
  providerOf,
  recoverLegacyPath,
  UNKNOWN_PROVIDER_CAPABILITY,
} from './event-model.js';
import { planGrid, cellOrder, blockKeyFor, MAX_BLOCKS_PER_TEAM } from './layout.js';
import { createWorld, applyEvent, targetHeight } from './world.js';
import { safeBox, worldScale, createCamera, NO_INSETS } from './camera.js';
import { IsoArenaRenderer } from './renderer.js';
import { MODEL_COLORS } from '../design/tokens.js';

const T0 = Date.parse('2026-08-24T00:00:00.000Z');

function ev(type: string, teamId: string, payload: Record<string, unknown>, tMs = 0): ArenaEvent {
  return {
    eventId: `e${tMs}`,
    competitionId: 'c',
    teamId,
    timestamp: new Date(T0 + tMs).toISOString(),
    type: type as ArenaEvent['type'],
    payload,
    metadata: {},
  };
}

describe('provider capability resolution', () => {
  it('parses the provider off a `provider:persona` model string', () => {
    expect(providerOf('claude:architect')).toBe('claude');
    expect(providerOf('GEMINI')).toBe('gemini');
  });

  it('gives an unknown provider a capability that claims NOTHING', () => {
    // The dangerous failure would be falling back to claude's (the richest)
    // capability, which would let an undeclared adapter silently borrow
    // credibility it has not earned.
    const cap = capabilityFor('mistral:fast');
    expect(cap).toEqual(UNKNOWN_PROVIDER_CAPABILITY);
    expect(cap.op).toBe(false);
    expect(cap).not.toEqual(PROVIDER_FILE_CAPABILITIES.claude);
  });

  it('all three shipping providers can support edit counting (AA-037)', () => {
    for (const p of ['claude', 'codex', 'gemini'] as const) {
      expect(PROVIDER_FILE_CAPABILITIES[p].op).toBe(true);
      expect(PROVIDER_FILE_CAPABILITIES[p].opSource).not.toBe('verb');
    }
  });
});

describe('event normalization', () => {
  it('reads op and opSource from a post-c965642 payload', () => {
    const f = toFrameEvent(ev('FILE_MODIFY', 'a', { path: 'src/x.py', op: 'modify', opSource: 'tool', tool: 'Edit', text: 'Edit src/x.py' }), T0);
    expect(f.kind).toBe('file');
    expect(f.op).toBe('modify');
    expect(f.opSource).toBe('tool');
    expect(f.legacy).toBe(false);
  });

  it('flags a pre-c965642 payload as legacy and refuses to invent an op', () => {
    // Old codex wrote { text: <path> } and nothing else. Guessing 'create' here
    // would be indistinguishable from a measured create downstream.
    const f = toFrameEvent(ev('FILE_CREATE', 'a', { text: 'src/x.py' }), T0);
    expect(f.legacy).toBe(true);
    expect(f.op).toBeUndefined();
    expect(f.opSource).toBeUndefined();
    expect(f.path).toBe('src/x.py');
  });

  it('recovers a path from the three historical payload shapes', () => {
    expect(recoverLegacyPath({ text: 'fizzbuzz.py' })).toBe('fizzbuzz.py');
    expect(recoverLegacyPath({ tool: 'Write', text: 'x', input: { file_path: 'src/cli.py' } })).toBe('src/cli.py');
    expect(recoverLegacyPath({ text: 'Wrote the file tests/test_cli.py to disk' })).toBe('tests/test_cli.py');
  });

  it('strips the sandbox workdir prefix from a recovered path', () => {
    expect(recoverLegacyPath({ text: '/tmp/arena-abc123/src/main.py' })).toBe('src/main.py');
  });

  it('returns no path when there is genuinely none to recover', () => {
    expect(recoverLegacyPath({ text: 'writing some files now' })).toBeUndefined();
  });

  it('sorts by elapsed time from the competition origin', () => {
    const out = toFrameEvents([
      ev('REASONING', 'a', { text: 'b' }, 5000),
      ev('REASONING', 'a', { text: 'a' }, 1000),
    ], T0);
    expect(out.map((e) => e.t)).toEqual([1000, 5000]);
  });
});

describe('edit-depth honesty', () => {
  it('reports MEASURED when the events carry the operation contract', () => {
    const events = toFrameEvents([ev('FILE_CREATE', 'a', { path: 'x.py', op: 'create', opSource: 'tool', text: '' })], T0);
    expect(resolveTelemetry('claude', events).editDepth).toBe('measured');
  });

  it('reports INFERRED for a legacy stream that still has paths', () => {
    const events = toFrameEvents([ev('FILE_CREATE', 'a', { text: 'x.py' })], T0);
    const tel = resolveTelemetry('codex', events);
    expect(tel.editDepth).toBe('inferred');
    expect(tel.note).toMatch(/inferred/i);
  });

  it('reports UNAVAILABLE when no path can be recovered at all', () => {
    const events = toFrameEvents([ev('FILE_CREATE', 'a', { text: 'wrote some code' })], T0);
    const tel = resolveTelemetry('gemini', events);
    expect(tel.editDepth).toBe('unavailable');
    expect(tel.note).toBeTruthy();
  });

  it('treats "no files at all" as a fact about the run, not a telemetry gap', () => {
    expect(resolveTelemetry('claude', []).editDepth).toBe('measured');
  });

  it('does NOT shorten an unmeasurable block — that would read as "did less work"', () => {
    // This is the whole contract in one assertion. A flat-but-full-height block
    // says "not measurable"; a short block says "this model was lazy".
    expect(targetHeight(0, 'unavailable')).toBe(targetHeight(0, 'measured'));
    expect(targetHeight(9, 'unavailable')).toBe(0.8);
    expect(targetHeight(9, 'measured')).toBeGreaterThan(0.8);
  });
});

describe('world', () => {
  const teams = [{ id: 'a', model: 'claude' }, { id: 'b', model: 'codex' }];

  it('grows a block for each distinct path and raises it on each edit', () => {
    const raw = [
      ev('FILE_CREATE', 'a', { path: 'src/x.py', op: 'create', opSource: 'tool', text: '' }, 0),
      ev('FILE_MODIFY', 'a', { path: 'src/x.py', op: 'modify', opSource: 'tool', text: '' }, 100),
      ev('FILE_MODIFY', 'a', { path: 'src/x.py', op: 'modify', opSource: 'tool', text: '' }, 200),
    ];
    const events = toFrameEvents(raw, T0);
    const w = createWorld(teams, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    const st = w.structures.get('a|src/x.py')!;
    expect(w.structures.size).toBe(1);
    expect(st.mods).toBe(2);
    expect(st.depth).toBe('measured');
    expect(w.teams.get('a')!.counts.edits).toBe(2);
  });

  it('infers an edit from a repeated path on a legacy stream, and marks it inferred', () => {
    // Historically an edit was recorded as a second FILE_CREATE, because no
    // normalizer ever emitted FILE_MODIFY. First sighting is the only signal left.
    const raw = [
      ev('FILE_CREATE', 'a', { text: 'src/x.py' }, 0),
      ev('FILE_CREATE', 'a', { text: 'src/x.py' }, 100),
    ];
    const events = toFrameEvents(raw, T0);
    const w = createWorld(teams, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    const st = w.structures.get('a|src/x.py')!;
    expect(st.mods).toBe(1);
    expect(st.depth).toBe('inferred');
  });

  it('never downgrades a measured block to inferred', () => {
    const raw = [
      ev('FILE_CREATE', 'a', { path: 'x.py', op: 'create', opSource: 'tool', text: '' }, 0),
      ev('FILE_CREATE', 'a', { text: 'x.py' }, 100),
    ];
    const events = toFrameEvents(raw, T0);
    const w = createWorld(teams, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    expect(w.structures.get('a|x.py')!.depth).toBe('measured');
  });

  it('counts a pathless file event but keeps it off the floor', () => {
    const events = toFrameEvents([ev('FILE_CREATE', 'a', { text: 'wrote some code' }, 0)], T0);
    const w = createWorld(teams, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    expect(w.teams.get('a')!.counts.files).toBe(1);
    expect(w.structures.size).toBe(0);
    expect(w.notes.join(' ')).toMatch(/not measurable/);
  });

  it('uses the shared MODEL_COLORS, not a fork', () => {
    const w = createWorld(teams, []);
    expect(w.teams.get('a')!.color).toBe(MODEL_COLORS.claude);
    expect(w.teams.get('b')!.color).toBe(MODEL_COLORS.codex);
  });
});

describe('layout scales past the prototype ceiling', () => {
  it('the spike could only place 63 blocks a side', () => {
    // GRID_X=8, GRID_Z=5 → (8-1)*(2*5-1) = 63. File 64 landed on file 63's cell.
    expect((8 - 1) * (2 * 5 - 1)).toBe(63);
  });

  it('grows the grid so every file gets its own cell', () => {
    for (const n of [10, 63, 64, 200, MAX_BLOCKS_PER_TEAM]) {
      const g = planGrid(n);
      expect(g.capacity).toBeGreaterThanOrEqual(n);
      expect(cellOrder(-1, g, 6.2).length).toBeGreaterThanOrEqual(n);
    }
  });

  it('never shrinks below the proportions the direction was designed at', () => {
    const g = planGrid(1);
    expect(g.gx).toBeGreaterThanOrEqual(8);
    expect(g.gz).toBeGreaterThanOrEqual(5);
  });

  it('places every file up to the ceiling as its own block — no silent stacking', () => {
    // 240 is MAX_BLOCKS_PER_TEAM: the largest floor drawn one-block-per-file.
    // The prototype clamped at 63 and stacked everything after it invisibly.
    const paths = Array.from({ length: MAX_BLOCKS_PER_TEAM }, (_, i) => `src/f${i}.py`);
    const events = toFrameEvents(
      paths.map((p, i) => ev('FILE_CREATE', 'a', { path: p, op: 'create', opSource: 'tool', text: '' }, i)),
      T0,
    );
    const w = createWorld([{ id: 'a', model: 'claude' }], events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    expect(w.structures.size).toBe(MAX_BLOCKS_PER_TEAM);
    const cells = new Set([...w.structures.values()].map((s) => `${s.x},${s.z}`));
    expect(cells.size).toBe(MAX_BLOCKS_PER_TEAM); // every block has its own cell
  });

  it('rolls up to directories past the readable ceiling, and says so', () => {
    const paths = Array.from({ length: MAX_BLOCKS_PER_TEAM + 50 }, (_, i) => `pkg${i % 6}/f${i}.py`);
    const events = toFrameEvents(
      paths.map((p, i) => ev('FILE_CREATE', 'a', { path: p, op: 'create', opSource: 'tool', text: '' }, i)),
      T0,
    );
    const w = createWorld([{ id: 'a', model: 'claude' }], events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    expect(w.teams.get('a')!.budget.rolledUp).toBe(true);
    expect(w.structures.size).toBe(6);
    expect(w.notes.join(' ')).toMatch(/directories/);
  });

  it('blockKeyFor rolls a path up to its directory only when asked', () => {
    expect(blockKeyFor('a/b/c.py', false)).toBe('a/b/c.py');
    expect(blockKeyFor('a/b/c.py', true)).toBe('a/b/');
    expect(blockKeyFor('c.py', true)).toBe('(root)');
  });
});

describe('viewport insets keep the world clear of the HUD', () => {
  it('shrinks the safe box by the declared insets', () => {
    const box = safeBox({ width: 1000, height: 600, dpr: 1, insets: { top: 90, right: 300, bottom: 130, left: 300 } });
    expect(box).toEqual({ x: 300, y: 90, w: 400, h: 380 });
  });

  it('zooms out rather than spilling when the grid grows', () => {
    const vp = { width: 1200, height: 700, dpr: 1, insets: NO_INSETS };
    const cam = createCamera();
    const small = worldScale(vp, cam, planGrid(10));
    const large = worldScale(vp, cam, planGrid(400));
    expect(large).toBeLessThan(small);
  });

  it('a fully occluding HUD still leaves a drawable box rather than a negative one', () => {
    const box = safeBox({ width: 300, height: 200, dpr: 1, insets: { top: 400, right: 400, bottom: 400, left: 400 } });
    expect(box.w).toBeGreaterThan(0);
    expect(box.h).toBeGreaterThan(0);
  });
});

describe('a provider that cannot report operations gets a flat, hatched city', () => {
  // This is the case the whole honest-absence contract exists for, and it is
  // reachable ONLY through the capability table — an event-by-event check can
  // never see it, because such a provider still reports perfectly good paths.
  const unknown = [{ id: 'a', model: 'mistral:fast' }];

  it('resolves to UNAVAILABLE even when every event carries a path', () => {
    const events = toFrameEvents(
      [ev('FILE_CREATE', 'a', { path: 'src/x.py', text: 'src/x.py' }, 0)],
      T0,
    );
    const tel = resolveTelemetry('mistral:fast', events);
    expect(tel.capability.op).toBe(false);
    expect(tel.editDepth).toBe('unavailable');
    expect(tel.note).toMatch(/does not report file operations/);
  });

  it('places the blocks but never grows them, and counts no edits', () => {
    const raw = [
      ev('FILE_CREATE', 'a', { path: 'src/x.py', text: '' }, 0),
      ev('FILE_CREATE', 'a', { path: 'src/x.py', text: '' }, 10),
      ev('FILE_CREATE', 'a', { path: 'src/y.py', text: '' }, 20),
    ];
    const events = toFrameEvents(raw, T0);
    const w = createWorld(unknown, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }

    expect(w.structures.size).toBe(2);          // the files are still shown
    expect(w.teams.get('a')!.counts.edits).toBe(0);
    for (const st of w.structures.values()) {
      expect(st.depth).toBe('unavailable');
      expect(st.mods).toBe(0);
      // Full height, not a stub. A short block would read as "did less work".
      expect(st.th).toBe(targetHeight(0, 'measured'));
    }
    expect(w.notes.join(' ')).toMatch(/drawn flat, not low/);
  });

  it('a well-reported event cannot upgrade an incapable provider to measured', () => {
    const events = toFrameEvents(
      [ev('FILE_CREATE', 'a', { path: 'x.py', op: 'create', opSource: 'tool', text: '' }, 0)],
      T0,
    );
    const w = createWorld(unknown, events);
    for (const e of events) { w.t = e.t; applyEvent(w, e, false); }
    expect(w.structures.get('a|x.py')!.depth).toBe('unavailable');
  });

  it('the three shipping providers are NOT caught by this branch', () => {
    for (const p of ['claude', 'codex', 'gemini']) {
      const events = toFrameEvents([ev('FILE_CREATE', 'a', { path: 'x.py', op: 'create', opSource: 'tool', text: '' }, 0)], T0);
      expect(resolveTelemetry(p, events).editDepth).toBe('measured');
    }
  });
});

describe('live mode — a stream that does not exist yet when the renderer is built', () => {
  const teams = [{ id: 'a', model: 'claude' }, { id: 'b', model: 'codex' }];
  const file = (team: string, path: string, t: number, legacy = false) =>
    toFrameEvent(
      ev('FILE_CREATE', team, legacy ? { text: path } : { path, op: 'create', opSource: 'tool', text: '' }, t),
      T0,
    );

  it('starts empty and still places blocks as events arrive', () => {
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 120_000 });
    expect(r.world.structures.size).toBe(0);
    r.appendEvents([file('a', 'src/x.py', 100), file('b', 'main.go', 200)]);
    r.setTime(500);
    expect(r.world.structures.size).toBe(2);
  });

  it('grows the floor rather than stacking, once the initial grid is outgrown', () => {
    // The replay path sizes the grid up front. Live cannot, so the failure mode
    // being guarded here is the prototype's: a placement cursor running past the
    // end of `cells` and silently piling every later file onto the last one.
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 600_000 });
    const startCapacity = r.world.grid.capacity;
    const n = startCapacity + 40;
    for (let i = 0; i < n; i++) {
      r.appendEvents([file('a', `src/f${i}.py`, i * 10)]);
      r.setTime(i * 10 + 1);
    }
    expect(r.world.grid.capacity).toBeGreaterThan(startCapacity);
    expect(r.world.structures.size).toBe(n);
    const cells = new Set([...r.world.structures.values()].map((s) => `${s.x},${s.z}`));
    expect(cells.size).toBe(n);
  });

  it('preserves placement ORDER across a regrow, so blocks keep their neighbours', () => {
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 600_000 });
    const n = r.world.grid.capacity + 5;
    for (let i = 0; i < n; i++) {
      r.appendEvents([file('a', `src/f${i}.py`, i * 10)]);
      r.setTime(i * 10 + 1);
    }
    // The order structures were created in must still match the cell order the
    // (larger) grid hands out, or a regrow would shuffle the city.
    const team = r.world.teams.get('a')!;
    const placed = r.world.order
      .map((id) => r.world.structures.get(id)!)
      .filter((st) => st.teamId === 'a');
    placed.forEach((st, i) => {
      expect({ x: st.x, z: st.z }).toEqual({ x: team.cells[i].x, z: team.cells[i].z });
    });
  });

  it('learns the provider reports no operations only once events arrive', () => {
    // An empty live stream cannot yet know; it must not guess 'inferred' early
    // and it must not stay 'measured' once legacy events prove otherwise.
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 120_000 });
    expect(r.world.teams.get('a')!.telemetry.editDepth).toBe('measured');
    expect(r.honestyNotes).toEqual([]);

    r.appendEvents([file('a', 'src/x.py', 100, true)]);
    r.setTime(150);
    r.appendEvents([]);
    expect(r.world.teams.get('a')!.telemetry.editDepth).toBe('inferred');
    expect(r.honestyNotes.join(' ')).toMatch(/predates file-operation telemetry/);
  });

  it('setTime is monotonic-safe and rebuilds coherently when time goes backwards', () => {
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 120_000 });
    r.appendEvents([file('a', 'a.py', 100), file('a', 'b.py', 200), file('a', 'c.py', 300)]);
    r.setTime(1000);
    expect(r.world.structures.size).toBe(3);
    r.setTime(150);
    expect(r.world.structures.size).toBe(1);
  });

  it('does not clamp live time to a stream end it cannot know', () => {
    // tick() is clamped to totalMs, which is right for a finished recording and
    // wrong for a running competition — the clock would freeze during any quiet
    // stretch. setTime is the live path precisely because the host owns the clock.
    const r = new IsoArenaRenderer({ teams, events: [], timeLimitMs: 120_000 });
    r.setTime(500_000);
    expect(r.world.t).toBe(500_000);
  });

  it('leaves the replay contract untouched', () => {
    const events = [file('a', 'x.py', 100), file('a', 'y.py', 200)];
    const r = new IsoArenaRenderer({ teams, events, timeLimitMs: 120_000 });
    expect(r.totalMs).toBe(2200);
    r.tick(10_000);
    expect(r.world.t).toBe(2200);   // still clamped, as before
    expect(r.world.structures.size).toBe(2);
  });
});
