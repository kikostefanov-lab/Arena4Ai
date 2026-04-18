'use client';

import { useRef, useEffect, useMemo, useState } from 'react';
import { GladiatorV2 } from '../lib/arena/gladiator-v2';
import { ArenaRingV2, ShockwavesV2 } from '../lib/arena/ring-v2';
import { classifyEventV2, stateToPhase } from '../lib/arena/classify-v2';
import { resolveModelBuild } from '../lib/arena/poses';
import type { ArenaPhase } from '../lib/arena/types';
import { getModelColor, hexToRgb, MONOSPACE_FONT, BODY_FONT } from '../lib/design-tokens';

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

// ── Canvas constants ────────────────────────────────────────────

const CW = 1200;
const CH = 640;
const GROUND_Y = CH * 0.68;
const FIGURE_SCALE = 1.8;

function computePositions(teams: Team[]): Array<{ x: number; y: number; facing: 1 | -1 }> {
  if (teams.length === 2) {
    return [
      { x: CW * 0.3, y: GROUND_Y, facing: 1 },
      { x: CW * 0.7, y: GROUND_Y, facing: -1 },
    ];
  }
  // N-team ring layout
  const cx = CW / 2;
  const cy = CH * 0.55;
  const radius = Math.min(CW, CH) * 0.25;
  return teams.map((_, i) => {
    const angle = (i / teams.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius + GROUND_Y - cy;
    const facing: 1 | -1 = x < cx ? 1 : -1;
    return { x, y, facing };
  });
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

export default function ArenaViewerV2({
  teams, events, state, winnerId, scores,
}: ArenaViewerV2Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const gladsRef = useRef<Map<string, GladiatorV2>>(new Map());
  const ringRef = useRef<ArenaRingV2 | null>(null);
  const shockRef = useRef<ShockwavesV2 | null>(null);
  const lastEventIdxRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const cameraRef = useRef({ x: 0, zoom: 1, tx: 0, tzoom: 1 });
  const camTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confettiFiredRef = useRef(false);
  const latestActionRef = useRef<Record<string, string>>({});

  const [momentum, setMomentum] = useState(0);
  const [, setTick] = useState(0); // forces re-render for latest-action HUD text

  const phase: ArenaPhase = stateToPhase(state);

  // Stable signature so re-renders with a new `teams` array reference don't
  // reset the gladiators. Only team id + model + persona participate in init.
  const teamsKey = useMemo(
    () => teams.map((t) => `${t.id}|${t.model}|${t.persona ?? ''}`).join('::'),
    [teams],
  );
  const teamColors = useMemo(
    () => Object.fromEntries(teams.map((t) => [t.id, getModelColor(t.model)])),
    // Stable on teamsKey — prevents re-init on every parent render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamsKey],
  );

  // Init renderers when team list meaningfully changes
  useEffect(() => {
    const positions = computePositions(teams);
    const glads = new Map<string, GladiatorV2>();
    teams.forEach((team, i) => {
      const pos = positions[i];
      glads.set(team.id, new GladiatorV2({
        teamId: team.id,
        build: resolveModelBuild(team.model),
        color: teamColors[team.id],
        x: pos.x,
        y: pos.y,
        scale: FIGURE_SCALE,
        facing: pos.facing,
      }));
      latestActionRef.current[team.id] = '';
    });
    gladsRef.current = glads;
    ringRef.current = new ArenaRingV2(CW / 2, CH * 0.76, CW * 0.38, CH * 0.10);
    shockRef.current = new ShockwavesV2();
    lastEventIdxRef.current = 0;
    confettiFiredRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamsKey]);

  // Process newly-arrived events — classify, flash, pulse, camera nudge
  useEffect(() => {
    const glads = gladsRef.current;
    const ring = ringRef.current;
    const shock = shockRef.current;
    if (!ring || !shock || glads.size === 0) return;

    while (lastEventIdxRef.current < events.length) {
      const ev = events[lastEventIdxRef.current++];
      if (!ev.teamId) continue;
      const g = glads.get(ev.teamId);
      if (!g) continue;

      const choreo = classifyEventV2(ev.type);
      if (!choreo) continue;

      if (choreo.basePose === 'thinking') {
        g.setBase('thinking');
        latestActionRef.current[ev.teamId] = '> reasoning…';
        setTimeout(() => { g.setBase('idle'); }, 400 + Math.random() * 300);
      } else if (choreo.flash === 'strike' || choreo.flash === 'power') {
        g.flash(choreo.flash);
        // Nearest opponent for shockwave target
        const opp = [...glads.values()].find((o) => o.teamId !== ev.teamId);
        if (opp) {
          shock.spawnShockwave(opp.x, opp.y - 20, g.color);
          opp.flash('hit');
          // Camera nudge toward striker
          cameraRef.current.tx = (g.x - CW / 2) * 0.08;
          cameraRef.current.tzoom = 1.05;
          if (camTimerRef.current) clearTimeout(camTimerRef.current);
          camTimerRef.current = setTimeout(() => {
            cameraRef.current.tx = 0;
            cameraRef.current.tzoom = 1;
          }, 350);
        }
        ring.pulse(g.color);
        latestActionRef.current[ev.teamId] = choreo.flash === 'strike' ? '> write file' : '> exec tool';
      } else if (choreo.flash === 'hit') {
        g.flash('hit');
      }
    }
  }, [events]);

  // Apply reveal-phase terminals + confetti
  useEffect(() => {
    const glads = gladsRef.current;
    const ring = ringRef.current;
    const shock = shockRef.current;
    if (!ring || !shock || glads.size === 0) return;

    if (phase === 'reveal' && winnerId) {
      const winner = glads.get(winnerId);
      const winColor = winner?.color ?? '#00f0ff';
      for (const [id, g] of glads) {
        g.setTerminal(id === winnerId ? 'triumph' : 'kneel');
      }
      if (winner) {
        cameraRef.current.tx = (winner.x - CW / 2) * 0.25;
        cameraRef.current.tzoom = 1.18;
        if (!confettiFiredRef.current) {
          shock.spawnConfetti(winner.x, winner.y - 60, winColor);
          confettiFiredRef.current = true;
        }
      }
      ring.setPhase('reveal', winColor);
    } else {
      for (const g of glads.values()) g.setTerminal(null);
      confettiFiredRef.current = false;
      ring.setPhase(phase);
    }
  }, [phase, winnerId]);

  // Main RAF loop
  useEffect(() => {
    let raf = 0;
    const step = (ts: number): void => {
      const last = lastFrameTsRef.current || ts;
      let dt = ts - last;
      lastFrameTsRef.current = ts;
      if (dt > 100) dt = 16;

      drawFrame(dt);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Energy + momentum from recent events
  useEffect(() => {
    const glads = gladsRef.current;
    if (glads.size === 0) return;
    // Approximate recent-window by taking last N events (no real timestamps)
    const now = Date.now();
    const win3s = now - 3000;
    const win10s = now - 10000;
    const countsEnergy: Record<string, number> = {};
    const countsMom: Record<string, number> = {};
    for (const ev of events) {
      if (!ev.teamId) continue;
      const evTime = new Date(ev.timestamp).getTime();
      if (evTime >= win3s) countsEnergy[ev.teamId] = (countsEnergy[ev.teamId] || 0) + 1;
      if (evTime >= win10s) countsMom[ev.teamId] = (countsMom[ev.teamId] || 0) + 1;
    }
    for (const [id, g] of glads) {
      g.setEnergy(Math.min(1, (countsEnergy[id] ?? 0) / 5));
    }
    if (teams.length === 2) {
      const a = countsMom[teams[0].id] ?? 0;
      const b = countsMom[teams[1].id] ?? 0;
      const total = a + b;
      setMomentum(total === 0 ? 0 : (b - a) / total);
    }
    setTick((n) => n + 1);
  }, [events, teams]);

  function drawFrame(dt: number): void {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const glads = gladsRef.current;
    const ring = ringRef.current;
    const shock = shockRef.current;
    if (!ring || !shock) return;

    // Update
    for (const g of glads.values()) g.update(dt, performance.now());
    ring.update(dt);
    shock.update(dt);

    // Ease camera
    const cam = cameraRef.current;
    cam.x += (cam.tx - cam.x) * 0.08;
    cam.zoom += (cam.tzoom - cam.zoom) * 0.08;

    // Render
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = '#01060c';
    ctx.fillRect(0, 0, CW, CH);

    // Subtle scanlines
    ctx.fillStyle = 'rgba(0,240,255,0.02)';
    for (let y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);

    // Camera transform
    ctx.save();
    ctx.translate(CW / 2, CH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-CW / 2 - cam.x, -CH / 2);

    const dim = phase === 'reveal' ? 0.3 : 0.6;
    ring.drawGrid(ctx, dim);
    ring.drawRing(ctx);

    // Gladiators — loser first, winner on top during reveal
    if (phase === 'reveal' && winnerId) {
      for (const [id, g] of glads) if (id !== winnerId) g.draw(ctx);
      const w = glads.get(winnerId);
      if (w) w.draw(ctx);
    } else {
      for (const g of glads.values()) g.draw(ctx);
    }

    shock.draw(ctx);
    ctx.restore();
  }

  // ── Render ─────────────────────────────────────────────

  const winner = winnerId ? teams.find((t) => t.id === winnerId) : undefined;
  const winnerColor = winner ? getModelColor(winner.model) : '#00f0ff';
  const teamA = teams[0];
  const teamB = teams[1];

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: '14px 16px',
      height: '100%', overflow: 'hidden',
    }}>
      {/* Lane headers (2-team only) */}
      {teamA && teamB && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 16,
          alignItems: 'center',
        }}>
          <LaneHeader
            team={teamA}
            color={teamColors[teamA.id]}
            align="left"
            latest={latestActionRef.current[teamA.id] ?? ''}
          />
          <div style={{
            fontFamily: MONOSPACE_FONT, fontSize: 18, fontWeight: 900,
            color: '#1e4a5a', letterSpacing: 4,
          }}>VS</div>
          <LaneHeader
            team={teamB}
            color={teamColors[teamB.id]}
            align="right"
            latest={latestActionRef.current[teamB.id] ?? ''}
          />
        </div>
      )}

      {/* Canvas stage — flex-center keeps aspect ratio intact */}
      <div style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            border: '1px solid #0a2235',
            background: '#01060c',
            borderRadius: 8,
            overflow: 'hidden',
            aspectRatio: `${CW} / ${CH}`,
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
          }}
        >
          <canvas
            ref={canvasRef}
            width={CW}
            height={CH}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
          <PhaseChip phase={phase} />
          <WinnerBanner
            visible={phase === 'reveal'}
            winner={winner}
            color={winnerColor}
            scores={scores}
            teams={teams}
          />

          {/* Corner accents */}
          <div style={{ position: 'absolute', top: 8, left: 8, width: 12, height: 12, borderTop: '1px solid #00f0ff', borderLeft: '1px solid #00f0ff', opacity: 0.5 }} />
          <div style={{ position: 'absolute', top: 8, right: 8, width: 12, height: 12, borderTop: '1px solid #00f0ff', borderRight: '1px solid #00f0ff', opacity: 0.5 }} />
          <div style={{ position: 'absolute', bottom: 8, left: 8, width: 12, height: 12, borderBottom: '1px solid #00f0ff', borderLeft: '1px solid #00f0ff', opacity: 0.5 }} />
          <div style={{ position: 'absolute', bottom: 8, right: 8, width: 12, height: 12, borderBottom: '1px solid #00f0ff', borderRight: '1px solid #00f0ff', opacity: 0.5 }} />
        </div>
      </div>

      {/* Momentum meter (2-team only) */}
      {teamA && teamB && (
        <MomentumMeter
          momentum={momentum}
          teamA={teamA}
          teamB={teamB}
          colorA={teamColors[teamA.id]}
          colorB={teamColors[teamB.id]}
        />
      )}
    </div>
  );
}
