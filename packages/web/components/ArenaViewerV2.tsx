'use client';

import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { IsoArenaRenderer, toFrameEvent, phaseFor } from '@arena/shared';
import type { FrameEvent, TeamSpec, Ctx2D } from '@arena/shared';
import type { ArenaPhase } from '../lib/arena/types';
import { getModelColor, hexToRgb, MONOSPACE_FONT, BODY_FONT } from '../lib/design-tokens';

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
}

// ── HUD subcomponents ───────────────────────────────────────────

function LaneHeader({ team, color, align, latest }: {
  team: Team; color: string; align: 'left' | 'right'; latest: string;
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
        {team.model}{team.persona ? `:${team.persona}` : ''}
      </div>
      <div style={{
        color: `rgba(${rgb},0.55)`, fontSize: 10, letterSpacing: 1.5, minHeight: 14,
      }}>
        {latest || '—'}
      </div>
    </div>
  );
}

function MomentumMeter({ momentum, teamA, teamB, colorA, colorB }: {
  momentum: number; teamA: Team; teamB: Team; colorA: string; colorB: string;
}) {
  const rgbA = hexToRgb(colorA);
  const rgbB = hexToRgb(colorB);
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
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: MONOSPACE_FONT, fontSize: 9, fontWeight: 800,
        letterSpacing: 2, textTransform: 'uppercase',
      }}>
        <span style={{ color: colorA }}>◀ {teamA.model}</span>
        <span style={{ color: '#4a8fa8' }}>MOMENTUM · last 10s</span>
        <span style={{ color: colorB }}>{teamB.model} ▶</span>
      </div>
      <div style={{
        position: 'relative', height: 10,
        background: '#01060c', borderRadius: 2,
        border: '1px solid #0a2235', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: momentum < 0 ? `${50 + momentum * 50}%` : '50%',
          width: `${Math.abs(momentum) * 50}%`,
          background: momentum < 0
            ? `linear-gradient(90deg, ${colorA}, rgba(${rgbA},0.5))`
            : `linear-gradient(90deg, rgba(${rgbB},0.5), ${colorB})`,
          boxShadow: `0 0 12px ${momentum < 0 ? colorA : colorB}`,
          transition: 'left 180ms ease, width 180ms ease',
        }}/>
        <div style={{
          position: 'absolute', top: -2, bottom: -2, left: '50%',
          width: 1, background: '#4a8fa8', opacity: 0.6,
        }}/>
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
                  {t.model}{t.persona ? `:${t.persona}` : ''}
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

export default function ArenaViewerV2({
  teams, events, state, elapsedMs, timeLimitMs, scores, winnerId,
}: ArenaViewerV2Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<IsoArenaRenderer | null>(null);
  /** Measured CSS size of the canvas box; the renderer composes into this. */
  const sizeRef = useRef({ w: FALLBACK_W, h: FALLBACK_H, dpr: 1 });

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

  const [momentum, setMomentum] = useState(0);
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
      reducedMotion:
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    rendererRef.current = r;
    consumedRef.current = 0;
    lastIdRef.current = null;
    originRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsKey, timeLimitMs]);

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
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // ── Feed the stream ───────────────────────────────────────────
  const ingest = useCallback(() => {
    const r = rendererRef.current;
    if (!r) return;

    // Competition start, fixed on the first event we ever see, so the renderer
    // works in elapsed time regardless of when the events were recorded. This
    // is also what makes a historical competition replay correctly.
    if (originRef.current === null && events.length > 0) {
      originRef.current = Date.parse(events[0].timestamp);
    }
    const origin = originRef.current;
    if (origin === null) return;

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
      const all = events.map((e) => toFrameEvent(e as never, origin));
      const specs: TeamSpec[] = teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona }));
      const replay = new IsoArenaRenderer({ teams: specs, events: all, timeLimitMs });
      replay.setWinner(winnerRef.current);
      rendererRef.current = replay;
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
      const all = events.map((e) => toFrameEvent(e as never, origin));
      r.appendEvents([]);
      r.seek(0);
      rendererRef.current = null;
      const specs: TeamSpec[] = teams.map((t) => ({ id: t.id, model: t.model, persona: t.persona }));
      const rebuilt = new IsoArenaRenderer({ teams: specs, events: all, timeLimitMs });
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
    r.appendEvents(fresh);
    consumedRef.current = events.length;
    lastIdRef.current = events[events.length - 1]?.eventId ?? null;
  }, [events, teams, timeLimitMs, isLive]);

  // ── Winner / terminal poses ───────────────────────────────────
  useEffect(() => {
    winnerRef.current = phase === 'reveal' ? (winnerId ?? null) : null;
    rendererRef.current?.setWinner(winnerRef.current);
  }, [phase, winnerId]);

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
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ingest();

          if (isLive) {
            // The host owns the clock: the competition's real elapsed time.
            r.setTime(elapsedMs);
          } else if (playing) {
            r.tick(16.7 * speed);
          }

          if (orbit && phase !== 'reveal') {
            r.camera.tyaw = -0.62 + Math.sin(performance.now() / 9000) * 0.14;
          }

          const { w, h, dpr } = sizeRef.current;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          r.attach(ctx as unknown as Ctx2D);
          r.setViewport({ width: w, height: h, dpr, insets: HUD_INSETS });
          r.draw();

          // HUD text is throttled to ~4Hz. It is prose for a human to read;
          // re-rendering React at 60Hz to update it would spend the frame
          // budget on text nobody can follow that fast.
          if (++hudAcc % 15 === 0) {
            const next: Record<string, string> = {};
            for (const team of r.world.teams.values()) next[team.id] = team.latest;
            setLatest(next);
            if (teams.length === 2) {
              const now = r.world.t;
              let a = 0;
              let b = 0;
              for (const rec of r.world.recent) {
                if (now - rec.t >= 10_000) continue;
                if (rec.teamId === teams[0].id) a++;
                else if (rec.teamId === teams[1].id) b++;
              }
              setMomentum(a + b === 0 ? 0 : (b - a) / (a + b));
            }
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ingest, isLive, elapsedMs, playing, speed, orbit, phase, teams]);

  const notes = rendererRef.current?.honestyNotes ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 }}>
      {teams.length === 2 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'start', gap: 12 }}>
          <LaneHeader
            team={teams[0]} color={teamColors[teams[0].id]} align="left"
            latest={latest[teams[0].id] ?? ''}
          />
          <PhaseChip phase={phase} />
          <LaneHeader
            team={teams[1]} color={teamColors[teams[1].id]} align="right"
            latest={latest[teams[1].id] ?? ''}
          />
        </div>
      )}

      <div ref={boxRef} style={{ position: 'relative', width: '100%', flex: 1, minHeight: 240 }}>
        <canvas
          ref={canvasRef}
          width={FALLBACK_W}
          height={FALLBACK_H}
          style={{
            width: '100%', height: '100%', display: 'block',
            borderRadius: 6, background: '#03060b',
          }}
        />
        <WinnerBanner
          visible={phase === 'reveal' && !!winnerId}
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

      {teams.length === 2 && (
        <MomentumMeter
          momentum={momentum}
          teamA={teams[0]} teamB={teams[1]}
          colorA={teamColors[teams[0].id]} colorB={teamColors[teams[1].id]}
        />
      )}

      {/* Controls. Transport only once the history exists to scrub. */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end',
        fontFamily: MONOSPACE_FONT, fontSize: '0.62rem',
      }}>
        {!isLive && (
          <>
            <button type="button" onClick={() => setPlaying((p) => !p)} style={ctrlStyle(playing)}>
              {playing ? 'Pause' : 'Play'}
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
        <button type="button" onClick={() => setOrbit((o) => !o)} style={ctrlStyle(orbit)}>
          Cam
        </button>
      </div>

      {/*
        The renderer already draws these notes onto the canvas — that is
        deliberate, so the picture cannot travel without its caveat. They are
        repeated here as selectable text because a screenshot is not accessible
        and a caveat nobody can copy is a caveat nobody quotes.
      */}
      {notes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {notes.map((n) => (
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
