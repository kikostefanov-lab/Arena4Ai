'use client';

import { useRef, useEffect, useMemo, useState, useCallback, Fragment } from 'react';
import { teamDisplayName, IsoArenaRenderer, stepStructures, momentumShares, squadSummary, deliveredList, toFrameEvent, toFrameEvents, phaseFor, reconcileWithManifest, corpusFromEvents } from '@arena/shared';
import type { TeamManifest } from '@arena/shared';
import type { FrameEvent, TeamSpec, Ctx2D } from '@arena/shared';
import type { ArenaPhase } from '../lib/arena/types';
import type { Arena3D } from '@arena/video/dist/arena3d/scene';
import { getModelColor, hexToRgb, MONOSPACE_FONT, BODY_FONT, BG_DARK } from '../lib/design-tokens';

/**
 * AA-066 — the arena is now drawn by `IsoArenaRenderer` from @arena/shared.
 *
 * What used to live here was a hand-rolled Canvas 2D scene: two gladiators on a
 * flat ring, animated from event TYPES alone. It showed that something was
 * happening; it could not show WHAT. The shared renderer binds four channels to
 * real event fields — every block is a file, height is the edit count, a beam is
 * a tool call, a crack is an error — and, critically, it branches on
 * PROVIDER_FILE_CAPABILITIES so a provider that cannot report edits is drawn as
 * an honest absence rather than as a short city that reads as "did less work".
 *
 * This file is now a HOST: it owns the DOM, the HUD, the clock and the controls.
 * It does not own the picture, and it must not — the legend that carries the
 * honesty caveat is drawn onto the canvas by the renderer precisely so that no
 * wrapper can ship the image without it.
 */

// ── Types ───────────────────────────────────────────────────────

interface ArenaEvent {
  eventId: string;
  type: string;
  teamId?: string;
  timestamp: string;
  payload?: Record<string, unknown>;
}

interface Team {
  id: string;
  model: string;
  persona?: string;
}

interface ArenaViewerV2Props {
  teams: Team[];
  events: ArenaEvent[];
  state: string;
  elapsedMs: number;
  timeLimitMs: number;
  scores?: Array<{ teamId: string; finalScore: number }>;
  winnerId?: string;
  /**
   * `results.deliverables` — the files actually collected off disk, when the
   * competition has finished. AA-079(b): a provider's event stream can be
   * INCOMPLETE (codex applies edits via apply_patch and, before the normalizer
   * was fixed, reported only the first file of each patch block), and a team
   * that reported 4 of the 17 files it delivered would otherwise be drawn as a
   * team that did a quarter of the work. Passing this lets the floor be built
   * from what was delivered, with the recovered blocks marked `inferred`.
   * Absent while a competition is still running — there is nothing to compare to
   * yet, and a partial run is legitimately partial.
   */
  deliverables?: Array<{ teamId: string; files?: Array<{ path: string }> }>;
  /**
   * Draw the world as the 3D "Neon District" scene instead of the isometric
   * canvas. Same world, same clock, same honesty notes — only the picture
   * changes. Falls back to the isometric canvas if WebGL is unavailable.
   */
  view3d?: boolean;
  /**
   * The brief's `deliverables` entries, raw. The world reduces them to file
   * names and checks each off per team as a file event lands, which feeds the
   * strip under every header.
   */
  deliverableNames?: string[];
}

interface SquadSummary { active: number; spawned: number; failed: number; models: string[] }
interface DeliveredItem { name: string; done: boolean }
interface MomentumShare { id: string; label: string; color: string; share: number }

const NO_SQUAD: SquadSummary = { active: 0, spawned: 0, failed: 0, models: [] };

// ── HUD subcomponents ───────────────────────────────────────────

function LaneHeader({ team, color, align, latest, squad, delivered }: {
  team: Team; color: string; align: 'left' | 'right'; latest: string;
  squad: SquadSummary; delivered: DeliveredItem[];
}) {
  const rgb = hexToRgb(color);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      alignItems: align === 'right' ? 'flex-end' : 'flex-start',
      fontFamily: BODY_FONT,
    }}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: 4,
        border: `1px solid rgba(${rgb},0.45)`,
        background: `rgba(${rgb},0.08)`,
        fontFamily: MONOSPACE_FONT,
        fontWeight: 800, fontSize: 12, letterSpacing: 2,
        color, textTransform: 'uppercase',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: color, boxShadow: `0 0 10px ${color}`,
        }}/>
        {teamDisplayName(team.model, team.persona)}
      </div>
      <div style={{
        color: `rgba(${rgb},0.55)`, fontSize: 10, letterSpacing: 1.5, minHeight: 14,
      }}>
        {latest || '—'}
      </div>
      {squad.spawned > 0 && (
        <div
          title={squad.models.length ? `Squad models: ${squad.models.join(', ')}` : 'Squad'}
          style={{
            fontFamily: MONOSPACE_FONT, fontSize: 10, fontWeight: 700, letterSpacing: 1.5,
            color: `rgba(${rgb},0.8)`, textTransform: 'uppercase',
          }}
        >
          ◆ {squad.active} active · {squad.spawned} spawned{squad.failed > 0 ? ` · ${squad.failed} failed` : ''}
        </div>
      )}
      {delivered.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '2px 10px',
          justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
          fontFamily: MONOSPACE_FONT, fontSize: 10, letterSpacing: 0.5,
        }}>
          {delivered.map((d) => (
            <span key={d.name} style={{ color: d.done ? color : '#4a8fa8', opacity: d.done ? 1 : 0.7 }}>
              {d.done ? '✓' : '·'} {d.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MomentumMeter({ shares }: { shares: MomentumShare[] }) {
  const total = shares.reduce((n, x) => n + x.share, 0);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 6,
      padding: '10px 14px',
      border: '1px solid #0a2235',
      background: '#040c18',
      borderRadius: 6,
      fontFamily: BODY_FONT,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
        fontFamily: MONOSPACE_FONT, fontSize: 9, fontWeight: 800,
        letterSpacing: 2, textTransform: 'uppercase',
      }}>
        <span style={{ color: shares[0].color }}>◀ {shares[0].label}</span>
        <span style={{ color: '#4a8fa8' }}>MOMENTUM · last 10s</span>
        <span style={{ color: shares[shares.length - 1].color }}>{shares[shares.length - 1].label} ▶</span>
      </div>
      <div style={{
        position: 'relative', display: 'flex', height: 10,
        background: '#01060c', borderRadius: 2,
        border: '1px solid #0a2235', overflow: 'hidden',
      }}>
        {total > 0 && shares.map((x) => (
          <div key={x.id} title={`${x.label} ${Math.round(x.share * 100)}%`} style={{
            width: `${x.share * 100}%`, height: '100%',
            background: x.color, boxShadow: `0 0 12px ${x.color}`,
            transition: 'width 180ms ease',
          }}/>
        ))}
      </div>
    </div>
  );
}

function PhaseChip({ phase }: { phase: ArenaPhase }) {
  if (phase === 'active' || phase === 'reveal') return null;
  const label = phase === 'freeze' ? "TIME'S UP" : phase === 'judging' ? 'JUDGING…' : '';
  if (!label) return null;
  return (
    <div style={{
      position: 'absolute', left: '50%', top: 18,
      transform: 'translateX(-50%)',
      fontFamily: MONOSPACE_FONT,
      fontSize: 11, fontWeight: 800, letterSpacing: 4,
      padding: '6px 14px',
      border: '1px solid rgba(255,102,0,0.4)',
      background: 'rgba(255,102,0,0.08)',
      color: '#ff6600', textTransform: 'uppercase',
      borderRadius: 4,
      zIndex: 3,
    }}>{label}</div>
  );
}

function WinnerBanner({ visible, winner, color, scores, teams }: {
  visible: boolean; winner?: Team; color: string;
  scores?: Array<{ teamId: string; finalScore: number }>;
  teams: Team[];
}) {
  const opacity = visible && winner ? 1 : 0;
  const rgb = winner ? hexToRgb(color) : '0,0,0';
  const sortedScores = useMemo(() => (
    scores ? [...scores].sort((a, b) => b.finalScore - a.finalScore) : []
  ), [scores]);

  return (
    <div style={{
      position: 'absolute',
      left: '50%', top: '8%',
      transform: 'translateX(-50%)',
      opacity, transition: 'opacity 600ms ease',
      pointerEvents: 'none',
      textAlign: 'center',
      width: '60%',
      maxWidth: 520,
      zIndex: 3,
    }}>
      <div style={{
        fontFamily: MONOSPACE_FONT,
        fontSize: 9, fontWeight: 800, letterSpacing: 5,
        color: `rgba(${rgb},0.75)`, textTransform: 'uppercase', marginBottom: 4,
      }}>◆ VICTOR ◆</div>
      <div style={{
        fontFamily: MONOSPACE_FONT,
        fontSize: 'clamp(24px, 2.5vw, 42px)',
        fontWeight: 900, letterSpacing: 3,
        color, textTransform: 'uppercase',
        textShadow: `0 0 24px ${color}, 0 0 48px rgba(${rgb},0.55)`,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}>{winner?.model ?? ''}</div>
      <div style={{
        fontFamily: MONOSPACE_FONT,
        fontSize: 10, fontWeight: 800, letterSpacing: 3,
        color: `rgba(${rgb},0.8)`, textTransform: 'uppercase', marginTop: 4,
      }}>WINS</div>
      {sortedScores.length > 0 && (
        <div style={{
          marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5,
          maxWidth: 340, margin: '12px auto 0',
        }}>
          {sortedScores.map((s) => {
            const t = teams.find((tm) => tm.id === s.teamId);
            if (!t) return null;
            const c = getModelColor(t.model);
            const pct = Math.round(s.finalScore * 100);
            return (
              <div key={s.teamId} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontFamily: MONOSPACE_FONT, fontSize: 10, fontWeight: 700,
                letterSpacing: 1,
              }}>
                <span style={{ color: c, minWidth: 80, textAlign: 'left' }}>
                  {teamDisplayName(t.model, t.persona)}
                </span>
                <div style={{
                  flex: 1, height: 5, background: '#0a2235',
                  borderRadius: 3, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', background: c,
                    transition: 'width 800ms ease-out',
                  }}/>
                </div>
                <span style={{ color: c, minWidth: 36, textAlign: 'right' }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────


// ── Layout ──────────────────────────────────────────────────────

/**
 * Fallback canvas size, used only until the element has been measured.
 *
 * The arena does NOT draw at a fixed resolution. Its container on the
 * competition page is `flex: 1; min-height: 0; overflow: hidden` — a box whose
 * height is whatever is left on the page — so a canvas that sizes itself from
 * its own aspect ratio is simply clipped by it. The backing store is matched to
 * the measured box instead, which also means the picture is sharp on a retina
 * display rather than a 1200px bitmap stretched over it.
 */
const FALLBACK_W = 1200;
const FALLBACK_H = 640;

/**
 * Space the HUD occupies, in canvas units, reported to the renderer so it
 * composes the world into what is LEFT rather than underneath the panels.
 * The two defects in the AA-059 spike — the right lane sitting over its own
 * block city, and the event log clipped — were both this: a world drawn into
 * the full viewport with chrome laid on top. Numbers here are the measured
 * heights of the surrounding chrome, not margins tuned until it looked right.
 */
const HUD_INSETS = { top: 18, right: 24, bottom: 34, left: 24 };

/** Playback speeds offered when reviewing a finished competition. */
const SPEEDS = [1, 3, 8] as const;

/** Above the TopBar (z 100) and the page's fixed HUD corners. */
const THEATER_Z = 1000;

export default function ArenaViewerV2({
  teams, events, state, elapsedMs, timeLimitMs, scores, winnerId, deliverables, view3d, deliverableNames: deliverableNamesProp,
}: ArenaViewerV2Props) {
  // A re-fetched brief is a new array with the same entries; keep the identity
  // stable so it does not rebuild the renderer.
  const namesKey = (deliverableNamesProp ?? []).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deliverableNames = useMemo(() => deliverableNamesProp, [namesKey]);
  const [glFailed, setGlFailed] = useState(false);
  const use3d = !!view3d && !glFailed;
  /**
   * Theater: the arena alone, over the whole viewport, for recording. Only
   * styles change between the two modes, never the element tree, so the canvas
   * and its renderer and WebGL scene survive the switch; the box's
   * ResizeObserver resizes the backing store.
   */
  const [theater, setTheater] = useState(false);
  useEffect(() => {
    if (!theater) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setTheater(false); };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // The site chrome (TopBar, HUD corners) is fixed above <main>'s stacking
    // context, which holds the arena; globals.css hides it under this class.
    document.body.classList.add('arena-theater');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      document.body.classList.remove('arena-theater');
    };
  }, [theater]);
  const sceneRef = useRef<Arena3D | null>(null);
  const lastFrameRef = useRef(0);
  const [sceneReady, setSceneReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IsoArenaRenderer | null>(null);
  /** Measured CSS size of the canvas box; the renderer composes into this. */
  const sizeRef = useRef({ w: FALLBACK_W, h: FALLBACK_H, dpr: 1 });

  /**
   * `deliverables` in the shape `reconcileWithManifest` wants (AA-079(b)).
   *
   * The corpus is built from `events` — the RAW ArenaEvents — and must stay that
   * way. Passing frame events here would drop `payload.input.command`, where the
   * shell heredoc that names a file lives, and recovery would quietly fall to
   * zero without any test failing. See `corpusFromEvents`.
   */
  const manifests = useMemo<TeamManifest[]>(() => {
    const src = deliverables ?? [];
    if (src.length === 0) return [];
    const corpora = corpusFromEvents(events as never);
    return src
      .map((d) => ({
        teamId: d.teamId,
        paths: (d.files ?? []).map((f) => f.path).filter(Boolean),
        corpus: corpora.get(d.teamId) ?? '',
      }))
      .filter((m) => m.paths.length > 0);
  }, [deliverables, events]);

  /**
   * Build the frame list for a BULK load, reconciling it against the manifest.
   *
   * Only the bulk paths use this. The incremental live path deliberately does
   * not: while a competition is running there are no deliverables to compare
   * against, and a run that is only half done is legitimately half drawn.
   * `reconcileWithManifest` returns its input array unchanged when the stream is
   * already complete, so this costs nothing in the common case.
   */
  const loadFrames = useCallback((evs: ArenaEvent[], origin: number) => {
    const all = toFrameEvents(evs as never, origin);
    return manifests.length ? reconcileWithManifest(all, manifests).events : all;
  }, [manifests]);

  /**
   * How many of the `events` prop we have already handed to the renderer, plus
   * the id of the last one we took.
   *
   * The parent rebuilds `allEventsSorted` with a fresh array identity and a
   * fresh sort on every websocket message, so identity tells us nothing about
   * what is new. The id check is what distinguishes the normal case — the
   * prefix is unchanged and events were appended — from a genuine reorder,
   * which only a rebuild can handle correctly.
   */
  const consumedRef = useRef(0);
  const lastIdRef = useRef<string | null>(null);
  const originRef = useRef<number | null>(null);
  /** Current winner, so a renderer rebuilt mid-flight does not lose the verdict. */
  const winnerRef = useRef<string | null>(null);
  /** The final state of a FINISHED competition (null while live), for the same reason. */
  const finalStateRef = useRef<string | null>(null);
  /**
   * End of stream as of the last frame, so a paused view can tell "parked at the
   * end" (follow the end as the stream grows) from "paused mid-match" (hold).
   */
  const endSeenRef = useRef<number | null>(null);

  const [shares, setShares] = useState<MomentumShare[]>([]);
  const [squads, setSquads] = useState<Record<string, SquadSummary>>({});
  const [delivered, setDelivered] = useState<Record<string, DeliveredItem[]>>({});
  const [latest, setLatest] = useState<Record<string, string>>({});
  const [orbit, setOrbit] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(3);

  const phase: ArenaPhase = phaseFor(state) as ArenaPhase;

  /**
   * A finished competition has its whole history in hand, so scrubbing it is
   * meaningful. A RUNNING one does not: you cannot fast-forward past events
   * that have not happened, and a pause button that quietly desynced the arena
   * from the competition would misrepresent what you are looking at. So the
   * transport appears only once the competition is over, and while it is live
   * the arena follows the real clock. Camera orbit is offered in both.
   */
  const isLive = phase === 'active' || phase === 'freeze' || phase === 'judging';

  /**
   * A replay plays as a match: the renderer's world is 'active' until the
   * playhead reaches the end and only then reveals the verdict. The HUD follows
   * that, not the final `state` prop, or the VICTOR panel would sit over the
   * whole replay. Live, the prop is the truth and this is not consulted.
   */
  const [playheadPhase, setPlayheadPhase] = useState<ArenaPhase | null>(null);
  const playheadPhaseRef = useRef<ArenaPhase | null>(null);
  const hudPhase: ArenaPhase = isLive ? phase : (playheadPhase ?? phase);

  const teamsKey = useMemo(
    () => teams.map((t) => `${t.id}|${t.model}|${t.persona ?? ''}`).join('::'),
    [teams],
  );
  const teamColors = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, getModelColor(t.model)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamsKey],
  );

  // ── Build the renderer once per meaningful team change ────────
  useEffect(() => {
    const specs: TeamSpec[] = teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona }));
    const r = new IsoArenaRenderer({
      teams: specs,
      events: [],
      timeLimitMs,
      deliverables: deliverableNames,
      reducedMotion:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    r.setWinner(winnerRef.current);
    r.setFinalState(finalStateRef.current);
    rendererRef.current = r;
    consumedRef.current = 0;
    lastIdRef.current = null;
    originRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsKey, timeLimitMs, deliverableNames]);

  // ── Track the box the arena has to live inside ────────────────
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;

    const measure = (): void => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(320, Math.round(r.width));
      const h = Math.max(240, Math.round(r.height));
      if (sizeRef.current.w === w && sizeRef.current.h === h && sizeRef.current.dpr === dpr) return;
      sizeRef.current = { w, h, dpr };
      if (use3d) {
        // three owns the WebGL backing store.
        sceneRef.current?.resize(w, h, dpr);
        return;
      }
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };

    // This effect re-runs when the canvas element is replaced (3D <-> Iso, or
    // the WebGL fallback). The new element starts at its fallback backing size,
    // so forget the cached measurement or an unchanged box would skip sizing it.
    sizeRef.current = { w: 0, h: 0, dpr: 0 };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [use3d]);

  // ── The 3D scene, when asked for ──────────────────────────────
  //
  // Loaded with a dynamic import so three.js stays out of the bundle for anyone
  // who never opens the 3D view, and out of the server render entirely.
  useEffect(() => {
    if (!use3d) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dead = false;
    let scene: Arena3D | null = null;
    (async () => {
      try {
        const mod = await import('@arena/video/dist/arena3d/scene');
        if (dead) return;
        scene = new mod.Arena3D(canvas, {
          teams: teams.map((t) => ({ id: t.id, model: t.model, color: getModelColor(t.model) })),
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
        const { w, h, dpr } = sizeRef.current;
        scene.resize(w, h, dpr);
        scene.onFreeCam = () => setOrbit(false);
        const r = rendererRef.current;
        if (!r) throw new Error('arena world not ready');
        await scene.load(r.world);
        if (dead) return;
        sceneRef.current = scene;
        setSceneReady(true);
      } catch (err) {
        // No WebGL, a lost context, or a missing model: the isometric canvas
        // shows the same world, so fall back rather than leave a blank box.
        console.error('[arena3d] falling back to the isometric view:', err);
        if (!dead) setGlFailed(true);
      }
    })();
    return () => {
      dead = true;
      setSceneReady(false);
      sceneRef.current = null;
      scene?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3d, teamsKey]);

  // ── Feed the stream ───────────────────────────────────────────
  const ingest = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;

    if (events.length === 0) return;

    /**
     * Competition start = the EARLIEST timestamp we hold, recomputed whenever
     * something older turns up.
     *
     * Taking it from `events[0]` of the first non-empty array looked equivalent
     * and was not: the page fills its event list progressively, so the first
     * array to arrive is often a later chunk. Everything preceding that origin
     * then clamped to t=0 and the whole competition collapsed into a couple of
     * seconds — 78c7452f, which really spans 831s, reported a totalMs of 2426ms
     * and drew an empty floor. An origin that can only ever be too late is a
     * bug that hides as "nothing has happened yet".
     */
    let earliest = Infinity;
    for (const e of events) {
      const ts = Date.parse(e.timestamp);
      if (ts < earliest) earliest = ts;
    }
    if (!Number.isFinite(earliest)) return;
    if (originRef.current === null || earliest < originRef.current) {
      // An older event than anything seen so far invalidates every `t` already
      // computed, so the world has to be rebuilt against the corrected origin.
      originRef.current = earliest;
      consumedRef.current = 0;
      lastIdRef.current = null;
    }
    const origin = originRef.current;

    /**
     * A FINISHED competition is a replay, and the renderer has a contract for
     * that: hand it the whole list at construction. Doing so matters for more
     * than tidiness — telemetry is derived from what has been APPLIED, so a
     * completed competition fed incrementally would withhold its own honesty
     * caveat until playback happened to reach the evidence. We already know the
     * whole stream; a viewer who screenshots the first five seconds must not get
     * a picture with the caveat still missing from it.
     */
    if (!isLive && consumedRef.current === 0 && events.length > 0) {
      // toFrameEvents (plural) sorts; toFrameEvent (singular) does not. The
      // renderer walks its list with a monotonic cursor, so an unsorted list
      // stalls at the first out-of-order timestamp.
      const all = loadFrames(events, origin);
      const specs: TeamSpec[] = teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona }));
      const replay = new IsoArenaRenderer({ teams: specs, events: all, timeLimitMs, deliverables: deliverableNames });
      replay.setWinner(winnerRef.current);
      replay.setFinalState(finalStateRef.current);
      /**
       * Open a FINISHED competition on its finished state, not on an empty floor.
       *
       * Playing a completed competition from t=0 by default is what made the
       * arena look broken on real data: 78c7452f spans 831 seconds and its first
       * file event is at t+259s, so at the default 3x a viewer stares at a bare
       * floor for 86 seconds and waits four minutes to see all nine blocks. The
       * city is the result; someone opening a finished match wants to see what
       * was built, and can then rewind deliberately with the transport.
       */
      replay.seek(replay.totalMs);
      rendererRef.current = replay;
      endSeenRef.current = replay.totalMs;
      setPlaying(false);
      consumedRef.current = events.length;
      lastIdRef.current = events[events.length - 1]?.eventId ?? null;
      return;
    }

    const consumed = consumedRef.current;
    const prefixIntact =
      consumed === 0 ||
      (events.length >= consumed && events[consumed - 1]?.eventId === lastIdRef.current);

    if (!prefixIntact) {
      // A reorder: the only coherent response is to rebuild from scratch.
      // Rare, and cheaper to do correctly than to patch up incrementally.
      const all = loadFrames(events, origin);
      // A replay keeps its playhead across the rebuild: the end if it was
      // parked there, else the same moment.
      const at = r.world.t;
      const wasAtEnd = at >= r.totalMs;
      r.appendEvents([]);
      r.seek(0);
      rendererRef.current = null;
      const specs: TeamSpec[] = teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona }));
      const rebuilt = new IsoArenaRenderer({ teams: specs, events: all, timeLimitMs, deliverables: deliverableNames });
      rebuilt.setWinner(winnerRef.current);
      rebuilt.setFinalState(finalStateRef.current);
      if (!isLive) rebuilt.seek(wasAtEnd ? rebuilt.totalMs : Math.min(at, rebuilt.totalMs));
      endSeenRef.current = rebuilt.totalMs;
      rendererRef.current = rebuilt;
      consumedRef.current = events.length;
      lastIdRef.current = events[events.length - 1]?.eventId ?? null;
      return;
    }

    if (events.length === consumed) return;
    const fresh: FrameEvent[] = [];
    for (let i = consumed; i < events.length; i++) {
      fresh.push(toFrameEvent(events[i] as never, origin));
    }
    // The tail is appended in arrival order; the renderer's cursor needs it
    // ordered, and a websocket can deliver two events out of order.
    fresh.sort((a, b) => a.t - b.t);
    r.appendEvents(fresh);
    consumedRef.current = events.length;
    lastIdRef.current = events[events.length - 1]?.eventId ?? null;
  }, [events, teams, timeLimitMs, isLive, loadFrames, deliverableNames]);

  // ── Winner / terminal poses ───────────────────────────────────
  useEffect(() => {
    winnerRef.current = phase === 'reveal' ? (winnerId ?? null) : null;
    finalStateRef.current = isLive ? null : state;
    rendererRef.current?.setWinner(winnerRef.current);
    rendererRef.current?.setFinalState(finalStateRef.current);
  }, [phase, winnerId, isLive, state]);

  // ── The single animation loop ─────────────────────────────────
  //
  // Everything time-driven happens here and nothing per event. The component
  // this replaced re-derived energy and momentum by walking the ENTIRE event
  // array inside an effect keyed on `events`, which is O(n) work per arriving
  // event and therefore O(n squared) over a competition — worst exactly on the
  // long, busy runs most worth watching. The renderer keeps its own capped
  // recent-activity window, so that loop is gone rather than memoised around.
  useEffect(() => {
    let raf = 0;
    let hudAcc = 0;

    const step = (): void => {
      const r = rendererRef.current;
      const canvas = canvasRef.current;
      if (r && canvas) {
        // A WebGL canvas has no 2D context; the 3D branch never asks for one.
        const ctx = use3d ? null : canvas.getContext('2d');
        if (use3d || ctx) {
          ingest();

          if (isLive) {
            // The host owns the clock: the competition's real elapsed time.
            r.setTime(elapsedMs);
          } else if (playing) {
            r.tick(16.7 * speed);
            endSeenRef.current = r.totalMs;
          } else {
            /**
             * Paused. A view paused mid-match HOLDS its frame: that is what
             * pause means, and a recording depends on it.
             *
             * A view parked on the END follows the end as the stream grows.
             * Seeking once at construction is not enough: the page delivers its
             * events progressively, so the first batch can be a single event.
             * The renderer then gets built from that one-event snapshot — end of
             * stream 2,000ms — and everything afterwards is appended, so the
             * view stays parked two seconds into an 831-second competition and
             * the floor is bare. That is the empty arena. Re-parking when the
             * end moves, and only if the view sat at the old end, converges on
             * the real end as the list fills, at one seek per change.
             */
            const prevEnd = endSeenRef.current;
            if (prevEnd !== null && r.totalMs !== prevEnd && r.world.t >= prevEnd) r.seek(r.totalMs);
            endSeenRef.current = r.totalMs;
          }

          // A replay's phase lives in the world. Mirror it into React only when
          // it changes, never per frame.
          if (!isLive && r.world.phase !== playheadPhaseRef.current) {
            playheadPhaseRef.current = r.world.phase;
            setPlayheadPhase(r.world.phase);
          }

          // Live is never 'reveal' (that is what makes it live); a replay holds
          // the orbit off only once its playhead has reached the verdict.
          if (orbit && !(!isLive && r.world.phase === 'reveal')) {
            r.camera.tyaw = -0.62 + Math.sin(performance.now() / 9000) * 0.14;
          }

          const nowMs = performance.now();
          const dtSec = Math.min(0.05, (nowMs - (lastFrameRef.current || nowMs)) / 1000);
          lastFrameRef.current = nowMs;
          if (use3d) {
            const scene = sceneRef.current;
            if (scene) {
              scene.director = orbit;
              // The isometric draw() is what normally eases block heights and
              // fades their flashes. It is not called here, so advance them.
              stepStructures(r.world);
              scene.sync(r.world, dtSec);
              scene.render();
            }
          } else if (ctx) {
            const { w, h, dpr } = sizeRef.current;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            r.attach(ctx as unknown as Ctx2D);
            r.setViewport({ width: w, height: h, dpr, insets: HUD_INSETS });
            r.draw();
          }

          // HUD text is throttled to ~4Hz. It is prose for a human to read;
          // re-rendering React at 60Hz to update it would spend the frame
          // budget on text nobody can follow that fast.
          if (++hudAcc % 15 === 0) {
            const next: Record<string, string> = {};
            for (const team of r.world.teams.values()) next[team.id] = team.latest;
            setLatest(next);
            const nextSquads: Record<string, SquadSummary> = {};
            const nextDelivered: Record<string, DeliveredItem[]> = {};
            for (const team of r.world.teams.values()) {
              nextSquads[team.id] = squadSummary(team);
              nextDelivered[team.id] = deliveredList(r.world, team.id);
            }
            setSquads(nextSquads);
            setDelivered(nextDelivered);
            const share = momentumShares(r.world);
            setShares(teams.map((t) => ({
              id: t.id, label: t.model, color: teamColors[t.id], share: share.get(t.id) ?? 0,
            })));
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ingest, isLive, elapsedMs, playing, speed, orbit, phase, teams, teamColors, use3d]);

  const notes = rendererRef.current?.honestyNotes ?? [];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0,
      ...(theater ? {
        position: 'fixed', inset: 0, zIndex: THEATER_Z, height: 'auto',
        padding: 16, boxSizing: 'border-box', background: BG_DARK,
      } : {}),
    }}>
      {teams.length >= 2 && (
        <>
          {teams.length > 2 && (
            <div style={{ position: 'relative', height: 48 }}><PhaseChip phase={hudPhase} /></div>
          )}
          <div style={{
            display: 'grid', alignItems: 'start', gap: 12,
            gridTemplateColumns: teams.length === 2 ? '1fr auto 1fr' : `repeat(${teams.length}, 1fr)`,
          }}>
            {teams.map((t, i) => (
              <Fragment key={t.id}>
                {teams.length === 2 && i === 1 && <PhaseChip phase={hudPhase} />}
                <LaneHeader
                  team={t} color={teamColors[t.id]}
                  align={teams.length === 2 ? (i === 0 ? 'left' : 'right') : 'left'}
                  latest={latest[t.id] ?? ''}
                  squad={squads[t.id] ?? NO_SQUAD}
                  delivered={delivered[t.id] ?? []}
                />
              </Fragment>
            ))}
          </div>
        </>
      )}

      {/*
        The stage. In theater it is a size container and the box inside it is
        the largest 16:9 rectangle that fits; otherwise the box fills it.
      */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: theater ? 'center' : 'stretch',
        width: '100%', flex: 1, minHeight: theater ? 0 : 240,
        containerType: theater ? 'size' : 'normal',
      }}>
      <div ref={boxRef} style={{
        position: 'relative',
        ...(theater
          ? { flex: 'none', width: 'min(100cqw, calc(100cqh * 16 / 9))', aspectRatio: '16 / 9' }
          : { flex: 1, minHeight: 240 }),
      }}>
        <canvas
          // A canvas can only ever hand out one kind of context, so switching
          // between the 2D and WebGL pictures needs a fresh element.
          key={use3d ? 'gl' : '2d'}
          ref={canvasRef}
          width={FALLBACK_W}
          height={FALLBACK_H}
          aria-label={use3d ? '3D arena: each block is a file a team wrote' : 'Isometric arena'}
          style={{
            width: '100%', height: '100%', display: 'block',
            borderRadius: 6, background: '#03060b',
            touchAction: use3d ? 'none' : undefined, cursor: use3d ? 'grab' : undefined,
          }}
        />
        {use3d && (
          // The isometric renderer paints its legend onto the canvas so the
          // picture cannot travel without it. This overlay is the 3D
          // equivalent: it sits inside the frame a screenshot captures.
          <div style={{
            position: 'absolute', left: 14, bottom: 12, pointerEvents: 'none',
            fontFamily: MONOSPACE_FONT, fontSize: 10, lineHeight: 1.6, letterSpacing: 0.6,
            color: '#8fc7d8', background: 'rgba(2,6,14,0.72)', border: '1px solid #0a2235',
            borderRadius: 4, padding: '6px 10px', maxWidth: 'min(70%, 460px)',
          }}>
            <div>EACH BLOCK IS A FILE · HEIGHT IS ITS EDIT COUNT</div>
            <div>SOLID EDGE measured · DASHED inferred · HOLLOW provider cannot report edits</div>
            {/* Theater hides the notes below, so the caveats travel inside the frame. */}
            {notes.length > 0 && !theater && <div style={{ color: '#ffd700' }}>⚠ {notes.length} telemetry caveat{notes.length > 1 ? 's' : ''} below</div>}
            {theater && [...new Set(notes)].map((n) => <div key={n} style={{ color: '#ffd700' }}>⚠ {n}</div>)}
          </div>
        )}
        {use3d && !sceneReady && (
          <div style={{
            position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none',
            fontFamily: MONOSPACE_FONT, fontSize: 11, letterSpacing: 3, color: '#4a8fa8', textTransform: 'uppercase',
          }}>
            Loading 3D arena…
          </div>
        )}
        <WinnerBanner
          visible={hudPhase === 'reveal' && !!winnerId}
          winner={teams.find((t) => t.id === winnerId)}
          color={winnerId ? teamColors[winnerId] : '#00f0ff'}
          scores={scores}
          teams={teams}
        />
        {[['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']].map(([v, h]) => (
          <div
            key={`${v}${h}`}
            style={{
              position: 'absolute', [v]: 8, [h]: 8, width: 12, height: 12,
              [`border${v === 'top' ? 'Top' : 'Bottom'}`]: '1px solid #00f0ff',
              [`border${h === 'left' ? 'Left' : 'Right'}`]: '1px solid #00f0ff',
              opacity: 0.5, pointerEvents: 'none',
            } as React.CSSProperties}
          />
        ))}
      </div>
      </div>

      {teams.length >= 2 && shares.length === teams.length && <MomentumMeter shares={shares} />}

      {/* Controls. Transport only once the history exists to scrub. */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end',
        fontFamily: MONOSPACE_FONT, fontSize: '0.62rem',
      }}>
        {!isLive && (
          <>
            <button
              type="button"
              onClick={() => {
                const r = rendererRef.current;
                // Sitting on the final frame, Play means "watch it again";
                // anywhere else it resumes from the playhead.
                if (r && !playing && r.world.t >= r.totalMs) r.seek(0);
                setPlaying((p) => !p);
              }}
              style={ctrlStyle(playing)}
            >
              {transportLabel(playing, rendererRef.current)}
            </button>
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} style={ctrlStyle(speed === s)}>
                {s}×
              </button>
            ))}
          </>
        )}
        {isLive && (
          <span style={{ color: '#4a8fa8', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            following live
          </span>
        )}
        {use3d && (
          <button type="button" onClick={() => { sceneRef.current?.nextShot(); setOrbit(true); }} style={ctrlStyle(false)}>
            Next shot
          </button>
        )}
        <button type="button" onClick={() => setOrbit((o) => !o)} style={ctrlStyle(orbit)}>
          {use3d ? (orbit ? 'Director cam' : 'Free cam') : 'Cam'}
        </button>
        <button
          type="button"
          onClick={() => setTheater((t) => !t)}
          style={ctrlStyle(theater)}
          aria-pressed={theater}
          title={theater ? 'Exit theater (Esc)' : 'Fill the screen with the arena, for recording'}
        >
          {theater ? '⛶ Exit theater' : '⛶ Theater'}
        </button>
      </div>

      {/*
        The renderer already draws these notes onto the canvas — that is
        deliberate, so the picture cannot travel without its caveat. They are
        repeated here as selectable text because a screenshot is not accessible
        and a caveat nobody can copy is a caveat nobody quotes.
      */}
      {notes.length > 0 && !theater && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {[...new Set(notes)].map((n) => (
            <div key={n} style={{
              fontFamily: BODY_FONT, fontSize: '0.62rem', color: '#ffd700',
              border: '1px solid rgba(255,215,0,0.3)', background: 'rgba(255,215,0,0.05)',
              borderRadius: 3, padding: '4px 8px',
            }}>
              ⚠ {n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Pause while playing; Replay on the final frame; Play at the start, Resume mid-match. */
function transportLabel(playing: boolean, r: IsoArenaRenderer | null): string {
  if (playing) return 'Pause';
  if (!r || r.world.t >= r.totalMs) return 'Replay';
  return r.world.t <= 0 ? 'Play' : 'Resume';
}

function ctrlStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 9px',
    border: `1px solid ${active ? '#00f0ff' : '#0a2235'}`,
    borderRadius: 3,
    background: 'rgba(7,16,24,0.85)',
    color: active ? '#00f0ff' : '#4a8fa8',
    fontFamily: MONOSPACE_FONT,
    fontSize: '0.6rem',
    letterSpacing: '1px',
    textTransform: 'uppercase',
    cursor: 'pointer',
  };
}
