import type { Ctx2D } from './canvas2d.js';
import { clamp, lerp, easeOut, poly, rrect } from './canvas2d.js';
import { OBSERVER, FONT_MONO, rgba, mixHex } from '../design/tokens.js';
import type { CameraState, Viewport, Projected } from './camera.js';
import { createCamera, project, worldScale, focus, stepCamera, safeBox, NO_INSETS, DEFAULT_YAW } from './camera.js';
import type { FrameEvent } from './event-model.js';
import type { World, TeamState, Structure, TeamSpec } from './world.js';
import { createWorld, resetWorld, applyEvent, phaseFor, telemetryFromStats, refreshNotes, ensureGridCapacity } from './world.js';

/**
 * The isometric arena renderer.
 *
 * Canvas in, events in, pixels out. No React, no Remotion, no DOM beyond the
 * structural `Ctx2D` — AA-066 wraps this for Next.js and AA-067 drives it from
 * Remotion, and neither needs it to know which it is.
 *
 * THE DESIGN CONTRACT, from the prototype's own legend:
 *   every block is a file · height = edits · beam = tool call · crack = error
 *
 * All four channels are bound to real event fields, and where a provider cannot
 * supply one the renderer draws an HONEST ABSENCE — a hatched cap and a legend
 * line — rather than a short solid block that would read as "did less work".
 */

export interface RendererOptions {
  teams: TeamSpec[];
  events: FrameEvent[];
  /** Competition time limit in ms; drives the phase tint and the clock. */
  timeLimitMs?: number;
  reducedMotion?: boolean;
  /** Show the honest-absence legend. Default true — hiding it defeats the point. */
  showLegend?: boolean;
}

type Effect =
  | { kind: 'streak'; t0: number; dur: number; color: string; fx: number; fz: number; tx: number; tz: number; th: number }
  | { kind: 'beam'; t0: number; dur: number; color: string; x: number; z: number }
  | { kind: 'ring'; t0: number; dur: number; color: string; x: number; z: number }
  | { kind: 'label'; t0: number; dur: number; color: string; st: Structure }
  | { kind: 'confetti'; t0: number; dur: number; color: string; x: number; z: number; pts?: ConfettiPt[] };

interface ConfettiPt { a: number; v: number; s: number; c: string }

interface Unit {
  teamId: string;
  side: -1 | 1;
  x: number;
  z: number;
  color: string;
  provider: string;
  pose: Pose;
  flash: string | null;
  flashUntil: number;
  thinkUntil: number;
  terminal: 'triumph' | 'kneel' | null;
  energy: number;
  bob: number;
}

interface Pose { lean: number; armR: number; armL: number; crouch: number; tint: number; think: number }

const EFFECT_CAP = 220;

/**
 * How many extra cells a live regrow buys. Growing by one every time would
 * rescale the floor on every single file; growing in chunks keeps the rescale
 * rare enough to read as a camera move rather than a twitch.
 */
const GRID_GROWTH_STEP = 32;

export class IsoArenaRenderer {
  readonly world: World;
  readonly camera: CameraState = createCamera();

  private ctx: Ctx2D | null = null;
  private viewport: Viewport = { width: 1200, height: 640, dpr: 1, insets: NO_INSETS };
  private events: FrameEvent[];
  private readonly units = new Map<string, Unit>();
  private effects: Effect[] = [];
  private applied = 0;
  private reduced: boolean;
  private showLegend: boolean;

  readonly timeLimitMs: number;
  /** End of the stream. Grows in live mode as events arrive. */
  totalMs: number;

  /** Reused across frames so a 400-block floor allocates nothing per frame. */
  private sortIdx: Int32Array = new Int32Array(0);
  private sortDepth: Float64Array = new Float64Array(0);
  private drawList: Array<Structure | Unit> = [];

  constructor(opts: RendererOptions) {
    this.events = opts.events;
    this.world = createWorld(opts.teams, opts.events);
    this.reduced = opts.reducedMotion ?? false;
    this.showLegend = opts.showLegend ?? true;
    this.timeLimitMs = opts.timeLimitMs ?? 120_000;
    this.totalMs = opts.events.length ? opts.events[opts.events.length - 1].t + 2000 : this.timeLimitMs;

    let i = 0;
    for (const team of this.world.teams.values()) {
      this.units.set(team.id, {
        teamId: team.id,
        side: team.side,
        x: team.side * this.world.baseX,
        z: 0,
        color: team.color,
        provider: team.telemetry.provider,
        pose: { lean: 0, armR: 0.15, armL: 0.15, crouch: 0, tint: 0, think: 0 },
        flash: null,
        flashUntil: 0,
        thinkUntil: 0,
        terminal: null,
        energy: 0,
        bob: (i++ * 2.3) % 6,
      });
    }
  }

  // ─── host wiring ───────────────────────────────────────────────────────────

  attach(ctx: Ctx2D): void {
    this.ctx = ctx;
  }

  setViewport(vp: Partial<Viewport>): void {
    this.viewport = { ...this.viewport, ...vp, insets: { ...this.viewport.insets, ...(vp.insets ?? {}) } };
  }

  setReducedMotion(v: boolean): void {
    this.reduced = v;
  }

  /** Notes the host should surface if it draws its own legend. */
  get honestyNotes(): string[] {
    return this.world.notes;
  }

  // ─── live mode ─────────────────────────────────────────────────────────────
  //
  // Everything above this line is the replay contract: hand the renderer a
  // finished event list and scrub through it. That is what a recorded
  // competition and a Remotion render both need, and its behaviour is unchanged.
  //
  // A LIVE competition is a different shape and the replay contract cannot
  // express it: the events do not exist yet when the renderer is constructed, so
  // the floor cannot be sized, the end of the stream is unknown, and what the
  // provider actually reports is not yet observable. The two methods below are
  // ADDITIVE — no existing method changes behaviour — and they are the whole of
  // what live needs.

  /**
   * Feed newly-arrived events. Safe to call every frame with an empty array.
   *
   * Appends rather than rebuilding, so the cost is proportional to what ARRIVED,
   * not to the length of the competition so far. A live arena that re-derived
   * its world from the full history on every websocket message would degrade
   * quadratically over exactly the runs worth watching.
   */
  appendEvents(incoming: FrameEvent[]): void {
    if (incoming.length === 0) return;
    for (const ev of incoming) this.events.push(ev);
    const last = this.events[this.events.length - 1];
    this.totalMs = Math.max(this.totalMs, last.t + 2000);
  }

  /**
   * Make room for one more block before it is placed.
   *
   * This has to run in the APPLY path rather than when events are appended.
   * Both the floor's occupancy and a team's telemetry are consequences of events
   * being APPLIED, not of their arriving — an event that has arrived but whose
   * timestamp the clock has not yet reached has changed nothing. Doing it at
   * append time left both exactly one step stale, which for the grid means the
   * check passes and then the block that overflows it is placed anyway.
   */
  private reserveCell(ev: FrameEvent): void {
    if (ev.kind !== 'file' || !ev.path || !ev.teamId) return;
    const team = this.world.teams.get(ev.teamId);
    if (!team) return;
    // Two cells of headroom: the check must fail BEFORE the cursor can be
    // clamped, never on the event that would already have been stacked.
    if (team.nextCell < team.cells.length - 2) return;
    ensureGridCapacity(this.world, team.cells.length + GRID_GROWTH_STEP);
  }

  /**
   * Re-derive per-team telemetry from the running tallies. What a provider
   * actually reports is not observable until it has reported something, so a
   * live arena starts out knowing only what the capability table declares and
   * learns the rest. Cheap — one pass over the teams, not over the events.
   */
  private syncTelemetry(): void {
    let changed = false;
    for (const team of this.world.teams.values()) {
      const next = telemetryFromStats(team.model, team.fileStats);
      if (next.editDepth !== team.telemetry.editDepth || next.note !== team.telemetry.note) {
        team.telemetry = next;
        changed = true;
      }
    }
    if (changed) refreshNotes(this.world);
  }

  /**
   * Set the arena clock directly. In live mode the HOST owns the clock — it
   * knows the real elapsed competition time — whereas `tick()` integrates its
   * own and is clamped to the end of a known stream, which a live stream has
   * not got. Applies every event the jump passed over, with effects, so the
   * arena animates rather than teleporting.
   */
  setTime(tMs: number): void {
    const t = Math.max(0, tMs);
    if (t < this.world.t) {
      // Time moved backwards: only a rebuild is coherent.
      this.seek(t);
      return;
    }
    this.world.t = t;
    let applied = false;
    while (this.applied < this.events.length && this.events[this.applied].t <= t) {
      const ev = this.events[this.applied++];
      this.reserveCell(ev);
      this.applyLive(ev);
      applied = true;
    }
    if (applied) this.syncTelemetry();
  }

  // ─── time ──────────────────────────────────────────────────────────────────

  /** Advance playback by `dtMs` of arena time, applying any events it passes. */
  tick(dtMs: number): void {
    this.world.t = Math.min(this.totalMs, this.world.t + dtMs);
    while (this.applied < this.events.length && this.events[this.applied].t <= this.world.t) {
      const ev = this.events[this.applied++];
      this.reserveCell(ev);
      this.applyLive(ev);
    }
  }

  /** Jump to `t`, rebuilding the world without firing effects. */
  seek(t: number): void {
    resetWorld(this.world);
    this.effects.length = 0;
    this.applied = 0;
    this.world.t = t;
    while (this.applied < this.events.length && this.events[this.applied].t <= t) {
      applyEvent(this.world, this.events[this.applied++], false, { onState: (s) => this.onState(s, false) });
    }
    for (const st of this.world.structures.values()) st.h = st.th;
  }

  private applyLive(ev: FrameEvent): void {
    applyEvent(this.world, ev, true, {
      onWrite: (team, st) => {
        const u = this.units.get(team.id)!;
        this.flashPose(u, 'strike');
        this.push({ kind: 'streak', t0: this.world.t, dur: 260, color: team.color, fx: u.x, fz: u.z, tx: st.x, tz: st.z, th: st.th });
        this.push({ kind: 'label', t0: this.world.t, dur: 2200, color: team.color, st });
      },
      onTool: (team) => {
        const u = this.units.get(team.id)!;
        this.flashPose(u, 'power');
        this.push({ kind: 'beam', t0: this.world.t, dur: 650, color: team.color, x: u.x, z: u.z });
        this.push({ kind: 'ring', t0: this.world.t, dur: 900, color: team.color, x: u.x, z: u.z });
      },
      onError: (team) => {
        const u = this.units.get(team.id)!;
        this.flashPose(u, 'hit');
        if (!this.reduced) this.camera.shake = 1;
      },
      onReasoning: (team) => {
        this.units.get(team.id)!.thinkUntil = this.world.t + 900;
      },
      onState: (s) => this.onState(s, true),
    });
  }

  private onState(state: string, live: boolean): void {
    const phase = phaseFor(state);
    if (phase === 'reveal' && this.world.winnerId) {
      for (const u of this.units.values()) u.terminal = u.teamId === this.world.winnerId ? 'triumph' : 'kneel';
      const w = this.units.get(this.world.winnerId);
      if (w) {
        this.camera.tyaw = DEFAULT_YAW + w.side * 0.18;
        this.camera.tzoom = 1.12;
        if (live) this.push({ kind: 'confetti', t0: this.world.t, dur: 2600, color: w.color, x: w.x, z: w.z });
      }
    } else if (phase !== 'reveal') {
      for (const u of this.units.values()) u.terminal = null;
      this.camera.tzoom = phase === 'judging' ? 0.96 : 1;
      this.camera.tyaw = DEFAULT_YAW;
    }
  }

  /** Declare the winner (from the SCORED result, which is not an event payload). */
  setWinner(teamId: string | null): void {
    this.world.winnerId = teamId;
    this.onState(this.world.compState, false);
  }

  private push(e: Effect): void {
    if (this.effects.length >= EFFECT_CAP) this.effects.shift();
    this.effects.push(e);
  }

  private flashPose(u: Unit, pose: string): void {
    u.flash = pose;
    u.flashUntil = this.world.t + (pose === 'hit' ? 520 : 380);
  }

  // ─── drawing ───────────────────────────────────────────────────────────────

  draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const vp = this.viewport;
    const now = this.world.t;

    stepCamera(this.camera, this.reduced);
    const scale = worldScale(vp, this.camera, this.world.grid);
    const { cx, cy } = focus(vp, this.camera);
    const P = (x: number, y: number, z: number): Projected => project(x, y, z, this.camera, scale, cx, cy);

    // momentum energy per team, 3s window
    const e3 = new Map<string, number>();
    for (const r of this.world.recent) {
      if (now - r.t < 3000) e3.set(r.teamId, (e3.get(r.teamId) ?? 0) + 1);
    }
    for (const u of this.units.values()) u.energy = clamp((e3.get(u.teamId) ?? 0) / 5, 0, 1);

    ctx.fillStyle = OBSERVER.void;
    ctx.fillRect(0, 0, vp.width, vp.height);

    this.drawFloor(ctx, P, now);
    this.drawScene(ctx, P, now);
    this.drawEffects(ctx, P, now);
    if (this.showLegend) this.drawLegend(ctx);
  }

  private dim(): number {
    return this.world.phase === 'freeze' ? 0.45 : this.world.phase === 'reveal' ? 0.55 : 1;
  }

  private drawFloor(ctx: Ctx2D, P: (x: number, y: number, z: number) => Projected, now: number): void {
    const { gx, gz } = this.world.grid;
    const dim = this.dim();

    // territory tint
    for (const team of this.world.teams.values()) {
      const isLoser = this.world.phase === 'reveal' && this.world.winnerId !== null && team.id !== this.world.winnerId;
      const pts = [P(team.side * 0.2, 0, -gz), P(team.side * gx, 0, -gz), P(team.side * gx, 0, gz), P(team.side * 0.2, 0, gz)];
      const g = ctx.createLinearGradient(P(team.side * gx, 0, 0).x, 0, P(0, 0, 0).x, 0);
      const a = (isLoser ? 0.03 : 0.1) * dim + (this.world.phase === 'reveal' && team.id === this.world.winnerId ? 0.06 : 0);
      g.addColorStop(0, rgba(team.color, a));
      g.addColorStop(1, rgba(team.color, 0));
      ctx.fillStyle = g;
      poly(ctx, pts);
      ctx.fill();
    }

    // grid
    ctx.lineWidth = 1;
    for (let ix = -gx; ix <= gx; ix++) {
      const a = P(ix, 0, -gz);
      const b = P(ix, 0, gz);
      ctx.strokeStyle = ix === 0 ? rgba(OBSERVER.chrome, 0.35 * dim) : rgba(OBSERVER.chrome, (0.07 + 0.05 * (Math.abs(ix) % 4 === 0 ? 1 : 0)) * dim);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(OBSERVER.chrome, 0.09 * dim);
    for (let iz = -gz; iz <= gz; iz++) {
      const a = P(-gx, 0, iz);
      const b = P(gx, 0, iz);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // frame
    ctx.strokeStyle = rgba(OBSERVER.chrome, 0.35 * dim);
    ctx.lineWidth = 1.5;
    poly(ctx, [P(-gx, 0, -gz), P(gx, 0, -gz), P(gx, 0, gz), P(-gx, 0, gz)]);
    ctx.stroke();

    // base pads
    for (const u of this.units.values()) {
      this.ring(ctx, P, u.x, u.z, 0.9, rgba(u.color, 0.5 * dim), 2);
      this.ring(ctx, P, u.x, u.z, 0.55, rgba(u.color, 0.25 * dim), 1);
    }

    // judge scan
    if (this.world.phase === 'judging') {
      const z = -gz + ((now / 2600) % 1) * gz * 2;
      const a = P(-gx, 0, z);
      const b = P(gx, 0, z);
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      g.addColorStop(0, rgba(OBSERVER.gold, 0));
      g.addColorStop(0.5, rgba(OBSERVER.gold, 0.9));
      g.addColorStop(1, rgba(OBSERVER.gold, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.shadowColor = OBSERVER.gold;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
      this.world.judgeScanZ = z;
    }
  }

  private ring(ctx: Ctx2D, P: (x: number, y: number, z: number) => Projected, x: number, z: number, r: number, style: string, lw: number): void {
    ctx.strokeStyle = style;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const p = P(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  /**
   * Painter's algorithm over structures + units.
   *
   * The prototype rebuilt an array of `{d, draw: () => ...}` closures every
   * frame. At sixty-three blocks that is invisible; at four hundred it is four
   * hundred closures and four hundred objects per frame, which is 24,000
   * allocations a second for the garbage collector to clean up during the exact
   * animation it is meant not to stutter. Depths go into a reused Float64Array
   * and only an index array is sorted.
   */
  private drawScene(ctx: Ctx2D, P: (x: number, y: number, z: number) => Projected, now: number): void {
    const list = this.drawList;
    list.length = 0;
    for (const st of this.world.structures.values()) list.push(st);
    for (const u of this.units.values()) list.push(u);

    const n = list.length;
    if (this.sortIdx.length < n) {
      this.sortIdx = new Int32Array(n * 2);
      this.sortDepth = new Float64Array(n * 2);
    }
    const idx = this.sortIdx.subarray(0, n);
    for (let i = 0; i < n; i++) {
      const it = list[i];
      idx[i] = i;
      // Units sit a hair in front of a block on the same cell.
      this.sortDepth[i] = P(it.x, 0, it.z).d + ('key' in it ? 0 : 0.01);
    }
    const depth = this.sortDepth;
    // Array.prototype.sort on a TypedArray sorts numerically, not by index, so
    // sort a plain index list with a comparator into the depth buffer.
    const order = Array.from(idx);
    order.sort((a, b) => depth[a] - depth[b]);

    const box = safeBox(this.viewport);
    for (const i of order) {
      const it = list[i];
      if ('key' in it) this.drawStructure(ctx, P, it as Structure, now, box);
      else this.drawUnit(ctx, P, it as Unit, now);
    }
  }

  private drawStructure(
    ctx: Ctx2D,
    P: (x: number, y: number, z: number) => Projected,
    st: Structure,
    now: number,
    box: { x: number; y: number; w: number; h: number },
  ): void {
    const team = this.world.teams.get(st.teamId)!;
    const c = team.color;
    const isLoser = this.world.phase === 'reveal' && this.world.winnerId !== null && st.teamId !== this.world.winnerId;
    const isWinner = this.world.phase === 'reveal' && st.teamId === this.world.winnerId;
    const half = st.kind === 'config' ? 0.28 : st.kind === 'doc' ? 0.34 : 0.38;
    const h = st.h;

    const b0 = P(st.x - half, 0, st.z - half);
    // Cull anything fully outside the safe box. At four hundred blocks with the
    // camera pushed in, this is most of them.
    if (b0.x < box.x - 200 || b0.x > box.x + box.w + 200 || b0.y < box.y - 300 || b0.y > box.y + box.h + 200) {
      st.h += (st.th - st.h) * 0.12;
      st.flash *= 0.88;
      st.hit *= 0.975;
      return;
    }

    const b = [b0, P(st.x + half, 0, st.z - half), P(st.x + half, 0, st.z + half), P(st.x - half, 0, st.z + half)];
    const t = [P(st.x - half, h, st.z - half), P(st.x + half, h, st.z - half), P(st.x + half, h, st.z + half), P(st.x - half, h, st.z + half)];

    if (this.world.phase === 'judging') {
      st.gold = Math.abs(this.world.judgeScanZ - st.z) < 0.6 ? 1 : Math.max(0, st.gold - 0.02);
    } else if (this.world.phase === 'reveal') {
      // Let the judge's gold fade off as the verdict lands. The spike held it
      // frozen, so after a full scan every block on both floors stayed gold and
      // the two cities became the same colour — losing the one channel that says
      // which competitor built what. Model colour is load-bearing brand; the
      // judge borrows the floor, it does not keep it.
      st.gold = Math.max(0, st.gold - 0.03);
    } else {
      st.gold = 0;
    }
    const goldT = st.gold * 0.7;

    ctx.globalAlpha = isLoser ? 0.35 : 1;

    // sides, far → near
    const faces: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 0]];
    const sides = faces.map(([i, j], ix) => ({ pts: [b[i], b[j], t[j], t[i]], d: (b[i].d + b[j].d) / 2, ix }));
    sides.sort((p, q) => p.d - q.d);
    for (const s of sides) {
      const lit = s.ix === 1 || s.ix === 2 ? 0.55 : 0.32;
      const base = mixHex(OBSERVER.void, c, 0.14 + lit * 0.22);
      ctx.fillStyle = st.gold ? mixHex(base, OBSERVER.gold, goldT) : base;
      poly(ctx, s.pts);
      ctx.fill();
      ctx.strokeStyle = rgba(c, 0.35 + 0.4 * st.flash);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // top
    const topBase = mixHex('#0a1420', c, 0.42 + (st.kind === 'test' ? 0.1 : 0));
    ctx.fillStyle = st.gold
      ? mixHex(topBase, OBSERVER.gold, goldT)
      : st.flash > 0
        ? mixHex(topBase, OBSERVER.white, st.flash * 0.8)
        : topBase;
    poly(ctx, t);
    ctx.fill();

    const cx = (t[0].x + t[2].x) / 2;
    const cy = (t[0].y + t[2].y) / 2;
    const u = t[0].u * 0.12;

    // ── THE HONEST-ABSENCE CHANNEL ──────────────────────────────────────────
    // The cap outline states how far the height beneath it can be trusted.
    if (st.depth === 'measured') {
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(isWinner ? OBSERVER.white : c, 0.75);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (st.depth === 'inferred') {
      // Dashed cap: the height is a reasonable guess from repeated paths.
      ctx.setLineDash([u * 0.5, u * 0.4]);
      ctx.strokeStyle = rgba(c, 0.8);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // Hatched cap at UNIT height: there is nothing to count. Deliberately not
      // a short solid block — that would read as "this model did less work",
      // which is a claim about the model rather than about its CLI's logging.
      ctx.setLineDash([]);
      ctx.strokeStyle = rgba(OBSERVER.ice3, 0.9);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = rgba(OBSERVER.ice3, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(cx - u * 1.4 + k * u * 0.7, cy + u * 0.8);
        ctx.lineTo(cx + u * 0.2 + k * u * 0.7, cy - u * 0.8);
      }
      ctx.stroke();
    }

    // kind glyph
    if (u > 3 && st.depth !== 'unavailable') {
      ctx.fillStyle = rgba(OBSERVER.white, 0.55);
      if (st.kind === 'test') {
        ctx.strokeStyle = rgba(OBSERVER.white, 0.5);
        ctx.lineWidth = 1;
        ctx.strokeRect(cx - u, cy - u * 0.6, u * 2, u * 1.2);
      } else if (st.kind === 'doc') {
        ctx.fillRect(cx - u, cy - 1, u * 2, 1.5);
        ctx.fillRect(cx - u, cy + 3, u * 1.3, 1.5);
      } else if (st.kind === 'src') {
        ctx.beginPath();
        ctx.arc(cx, cy, u * 0.45, 0, 7);
        ctx.fill();
      }
    }

    // crack = error
    if (st.hit > 0.02) {
      ctx.strokeStyle = rgba(OBSERVER.red, st.hit);
      ctx.lineWidth = 1.5;
      ctx.shadowColor = OBSERVER.red;
      ctx.shadowBlur = 10 * st.hit;
      ctx.beginPath();
      ctx.moveTo(cx - u * 1.6, cy - u);
      ctx.lineTo(cx - u * 0.2, cy + u * 0.3);
      ctx.lineTo(cx + u * 0.7, cy - u * 0.6);
      ctx.lineTo(cx + u * 1.6, cy + u * 1.1);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    ctx.globalAlpha = 1;
    st.h += (st.th - st.h) * 0.12;
    st.flash *= 0.88;
    st.hit *= 0.975;
  }

  private drawUnit(ctx: Ctx2D, P: (x: number, y: number, z: number) => Projected, u: Unit, now: number): void {
    const p = P(u.x, 0, u.z);
    const s = p.u * 0.92;
    const c = u.color;

    const tg: Pose =
      u.terminal === 'triumph' ? { lean: 0, armR: -1, armL: -1, crouch: -0.1, tint: 0, think: 0 }
      : u.terminal === 'kneel' ? { lean: 0.25, armR: 0.3, armL: 0.3, crouch: 0.5, tint: 0, think: 0 }
      : u.flash === 'strike' ? { lean: 0.55, armR: -0.7, armL: 0.2, crouch: 0.05, tint: 0, think: 0 }
      : u.flash === 'power' ? { lean: -0.1, armR: -0.95, armL: -0.95, crouch: 0.15, tint: 0, think: 0 }
      : u.flash === 'hit' ? { lean: -0.5, armR: 0.6, armL: 0.5, crouch: 0.2, tint: 1, think: 0 }
      : { lean: 0, armR: 0.15, armL: 0.15, crouch: 0, tint: 0, think: now < u.thinkUntil ? 1 : 0 };

    if (u.flash && now > u.flashUntil) u.flash = null;
    const k = this.reduced ? 1 : 0.22;
    (Object.keys(tg) as Array<keyof Pose>).forEach((key) => {
      u.pose[key] += (tg[key] - u.pose[key]) * k;
    });

    const Q = u.pose;
    const dir = -u.side;
    const bob = this.reduced ? 0 : Math.sin(now / 520 + u.bob) * s * 0.02;
    const isLoser = this.world.phase === 'reveal' && this.world.winnerId !== null && u.teamId !== this.world.winnerId;

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.globalAlpha = isLoser ? 0.55 : 1;

    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.9);
    g.addColorStop(0, rgba(c, 0.25 + u.energy * 0.35));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.9, s * 0.32, 0, 0, 7);
    ctx.fill();

    if (Q.think > 0.05) {
      ctx.strokeStyle = rgba(c, 0.55 * Q.think);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([s * 0.08, s * 0.12]);
      ctx.lineDashOffset = -now / 40;
      ctx.beginPath();
      ctx.ellipse(0, -s * 1.65, s * 0.42, s * 0.16, 0, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const hip = -s * (0.62 - Q.crouch * 0.25);
    const shoulder = -s * (1.25 - Q.crouch * 0.3);
    const headY = -s * (1.5 - Q.crouch * 0.3);
    const lean = Q.lean * dir * s * 0.18;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = c;
    ctx.shadowBlur = 14 + u.energy * 14;

    ctx.strokeStyle = rgba(c, 0.85);
    ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    ctx.moveTo(-s * 0.14, hip);
    ctx.lineTo(-s * 0.2, 0);
    ctx.moveTo(s * 0.14, hip);
    ctx.lineTo(s * 0.22 * (1 + Q.crouch), 0);
    ctx.stroke();

    ctx.fillStyle = '#050a12';
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.05;
    rrect(ctx, lean - s * 0.27, shoulder, s * 0.54, hip - shoulder, s * 0.12);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = rgba(c, 0.55);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lean, shoulder + s * 0.1);
    ctx.lineTo(lean, hip - s * 0.06);
    ctx.stroke();
    ctx.fillStyle = Q.tint > 0.3 ? mixHex(c, OBSERVER.red, Q.tint) : c;
    ctx.beginPath();
    ctx.arc(lean, shoulder + s * 0.22, s * 0.05 + u.energy * s * 0.02, 0, 7);
    ctx.fill();

    ctx.fillStyle = mixHex('#050a12', c, 0.5);
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(lean + sgn * s * 0.42, shoulder + s * 0.02);
      ctx.lineTo(lean + sgn * s * 0.2, shoulder - s * 0.06);
      ctx.lineTo(lean + sgn * s * 0.22, shoulder + s * 0.16);
      ctx.closePath();
      ctx.fill();
    }

    const armLen = s * 0.5;
    ctx.strokeStyle = rgba(c, 0.9);
    ctx.lineWidth = s * 0.07;
    const aR = Q.armR * 1.2 + 0.2;
    const aL = Q.armL * 1.2 + 0.2;
    const hRx = lean + dir * Math.cos(aR) * armLen;
    const hRy = shoulder + s * 0.06 + Math.sin(aR) * armLen;
    const hLx = lean - dir * Math.cos(aL) * armLen * 0.9;
    const hLy = shoulder + s * 0.06 + Math.sin(aL) * armLen * 0.9;
    ctx.beginPath();
    ctx.moveTo(lean + dir * s * 0.25, shoulder + s * 0.06);
    ctx.lineTo(hRx, hRy);
    ctx.moveTo(lean - dir * s * 0.25, shoulder + s * 0.06);
    ctx.lineTo(hLx, hLy);
    ctx.stroke();

    ctx.fillStyle = '#050a12';
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.04;
    ctx.beginPath();
    if (u.provider === 'claude') {
      ctx.moveTo(lean - s * 0.17, headY + s * 0.1);
      ctx.lineTo(lean - s * 0.12, headY - s * 0.22);
      ctx.lineTo(lean + s * 0.12, headY - s * 0.22);
      ctx.lineTo(lean + s * 0.17, headY + s * 0.1);
      ctx.closePath();
    } else if (u.provider === 'codex') {
      ctx.rect(lean - s * 0.2, headY - s * 0.14, s * 0.4, s * 0.26);
    } else {
      ctx.moveTo(lean - s * 0.16, headY + s * 0.1);
      ctx.lineTo(lean, headY - s * 0.28);
      ctx.lineTo(lean + s * 0.16, headY + s * 0.1);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = rgba(OBSERVER.white, 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(lean - s * 0.1 + dir * s * 0.03, headY + s * 0.02);
    ctx.lineTo(lean + s * 0.1 + dir * s * 0.03, headY + s * 0.02);
    ctx.stroke();

    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.05;
    if (u.provider === 'claude') {
      ctx.beginPath();
      ctx.arc(hRx, hRy, s * 0.16, 0, 7);
      ctx.stroke();
      ctx.strokeStyle = rgba(OBSERVER.white, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hRx, hRy, s * 0.09, now / 300, now / 300 + 4);
      ctx.stroke();
    } else if (u.provider === 'codex') {
      ctx.beginPath();
      ctx.moveTo(hRx, hRy);
      ctx.lineTo(hRx + dir * s * 0.32, hRy - s * 0.1);
      ctx.moveTo(hRx, hRy + s * 0.06);
      ctx.lineTo(hRx + dir * s * 0.28, hRy + s * 0.04);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(hRx - dir * s * 0.1, hRy + s * 0.45);
      ctx.lineTo(hRx + dir * s * 0.1, hRy - s * 0.45);
      ctx.stroke();
      ctx.fillStyle = OBSERVER.white;
      ctx.beginPath();
      ctx.arc(hRx + dir * s * 0.1, hRy - s * 0.45, s * 0.05, 0, 7);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.restore();
  }

  private drawEffects(ctx: Ctx2D, P: (x: number, y: number, z: number) => Projected, now: number): void {
    let w = 0;
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i];
      if (now - e.t0 < e.dur) this.effects[w++] = e;
    }
    this.effects.length = w;

    for (const e of this.effects) {
      const k = clamp((now - e.t0) / e.dur, 0, 1);
      if (e.kind === 'streak') {
        const a = P(e.fx, 1.1, e.fz);
        const b = P(e.tx, e.th, e.tz);
        const t = easeOut(k);
        const t0 = Math.max(0, t - 0.35);
        ctx.strokeStyle = rgba(e.color, 0.9 * (1 - k * 0.5));
        ctx.lineWidth = 2;
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(lerp(a.x, b.x, t0), lerp(a.y, b.y, t0));
        ctx.lineTo(lerp(a.x, b.x, t), lerp(a.y, b.y, t));
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (e.kind === 'beam') {
        // beam = tool call
        const b = P(e.x, 0, e.z);
        const t = P(e.x, 3.2, e.z);
        const a = (1 - k) * 0.8;
        const wd = t.u * 0.22 * (1 + k);
        const g = ctx.createLinearGradient(0, t.y, 0, b.y);
        g.addColorStop(0, rgba(e.color, 0));
        g.addColorStop(1, rgba(e.color, a));
        ctx.fillStyle = g;
        ctx.fillRect(b.x - wd / 2, t.y, wd, b.y - t.y);
      } else if (e.kind === 'ring') {
        this.ring(ctx, P, e.x, e.z, 0.6 + easeOut(k) * 2.2, rgba(e.color, (1 - k) * 0.6), 1.5);
      } else if (e.kind === 'label') {
        const p = P(e.st.x, e.st.th + 0.35, e.st.z);
        const a = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        ctx.font = `600 ${Math.max(10, p.u * 0.2)}px ${FONT_MONO}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = rgba(OBSERVER.ice, 0.9 * a);
        ctx.fillText(e.st.key, p.x, p.y - (1 - a) * 4);
        ctx.textAlign = 'left';
      } else if (e.kind === 'confetti') {
        if (!e.pts) {
          e.pts = Array.from({ length: 90 }, (_, i) => ({
            a: (i / 90) * Math.PI * 2 + (i % 7) * 0.31,
            v: 0.5 + ((i * 37) % 100) / 71,
            s: 1 + ((i * 13) % 30) / 10,
            c: i % 5 === 0 ? OBSERVER.gold : i % 7 === 0 ? OBSERVER.white : e.color,
          }));
        }
        const o = P(e.x, 1.6, e.z);
        for (const q of e.pts) {
          const d = easeOut(k) * q.v * o.u * 2.2;
          ctx.fillStyle = q.c;
          ctx.globalAlpha = 1 - k;
          ctx.fillRect(o.x + Math.cos(q.a) * d, o.y + Math.sin(q.a) * d * 0.6 + k * k * o.u * 1.5, q.s, q.s);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /**
   * The legend. It carries the design contract AND every honest-absence note,
   * on the canvas rather than in the host's DOM, so no wrapper can ship the
   * picture without the caveat that makes it true.
   */
  private drawLegend(ctx: Ctx2D): void {
    const box = safeBox(this.viewport);
    const notes = this.world.notes;
    const lines = ['every block is a file · height = edits · beam = tool call · crack = error', ...notes];
    ctx.font = `500 10.5px ${FONT_MONO}`;
    ctx.textAlign = 'left';
    let y = box.y + box.h - 8 - (lines.length - 1) * 14;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = i === 0 ? rgba(OBSERVER.ice3, 0.95) : rgba(OBSERVER.gold, 0.8);
      ctx.fillText(i === 0 ? lines[i] : `⚠ ${lines[i]}`, box.x + 4, y);
      y += 14;
    }
  }
}
