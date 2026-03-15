'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { GladiatorRenderer } from '../lib/arena/gladiator';
import { ParticleSystem } from '../lib/arena/particles';
import { EventProcessor } from '../lib/arena/event-processor';
import type { ArenaPhase } from '../lib/arena/types';
import { resolveModelBuild } from '../lib/arena/poses';
import {
  getModelColor,
  BG_DARK,
  ACCENT_CYAN,
  TEXT_PRIMARY,
  TEXT_DIM,
  MONOSPACE_FONT,
  BODY_FONT,
  hexToRgb,
} from '../lib/design-tokens';
import { classifyEvent, getRelativeTime } from '../lib/EventRow';
import { formatElapsed } from '../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BattleArenaProps {
  teams: Array<{ id: string; model: string; persona?: string }>;
  events: Array<{
    eventId: string;
    type: string;
    teamId?: string;
    timestamp: string;
    payload?: Record<string, unknown>;
  }>;
  state: string;
  elapsedMs: number;
  timeLimitMs: number;
  scores?: Array<{ teamId: string; finalScore: number }>;
  winnerId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stateToPhase(state: string): ArenaPhase {
  switch (state) {
    case 'RUNNING':
      return 'active';
    case 'TIME_UP':
    case 'COLLECTING':
      return 'freeze';
    case 'PRESENTING':
    case 'JUDGING':
      return 'judging';
    case 'SCORED':
    case 'COMPLETE':
    case 'FORGE_COMPLETE':
      return 'reveal';
    default:
      return 'active';
  }
}

function phaseLabel(phase: ArenaPhase, winnerId?: string, teams?: BattleArenaProps['teams']): string {
  switch (phase) {
    case 'freeze':
      return "TIME'S UP";
    case 'judging':
      return 'JUDGING...';
    case 'reveal': {
      if (winnerId && teams) {
        const t = teams.find((tm) => tm.id === winnerId);
        if (t) return `${t.persona ? `${t.model}:${t.persona}` : t.model} WINS`;
      }
      return 'COMPLETE';
    }
    default:
      return '';
  }
}

/** Compute gladiator positions for N teams within a (W x H) canvas. */
function computePositions(
  teams: BattleArenaProps['teams'],
  W: number,
  H: number,
): Array<{ x: number; y: number; facing: 1 | -1 }> {
  if (teams.length === 2) {
    return [
      { x: W * 0.3, y: H * 0.65, facing: 1 },
      { x: W * 0.7, y: H * 0.65, facing: -1 },
    ];
  }
  const cx = W / 2;
  const cy = H * 0.55;
  const radius = Math.min(W, H) * 0.25;
  return teams.map((_, i) => {
    const angle = (i / teams.length) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    const facing: 1 | -1 = x < cx ? 1 : -1;
    return { x, y, facing };
  });
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, W, H);
}

function drawGridFloor(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  phase: ArenaPhase,
) {
  const vpX = W / 2;
  const vpY = H * 0.35; // vanishing point
  const baseAlpha = phase === 'freeze' ? 0.03 : 0.07;

  ctx.save();
  ctx.strokeStyle = `rgba(0,240,255,${baseAlpha})`;
  ctx.lineWidth = 1;

  // Horizontal lines (perspective-scaled)
  const hLines = 14;
  for (let i = 0; i <= hLines; i++) {
    const t = i / hLines;
    const y = vpY + (H - vpY) * t;
    const spread = t * 0.7 + 0.3;
    const x1 = vpX - (W * 0.6 * spread);
    const x2 = vpX + (W * 0.6 * spread);
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
  }

  // Radial lines from vanishing point
  const vLines = 12;
  for (let i = 0; i <= vLines; i++) {
    const t = i / vLines;
    const bx = W * 0.1 + W * 0.8 * t;
    ctx.beginPath();
    ctx.moveTo(vpX, vpY);
    ctx.lineTo(bx, H);
    ctx.stroke();
  }

  // Elliptical arena boundary
  const ellipseRx = W * 0.38;
  const ellipseRy = H * 0.18;
  const ellipseCy = H * 0.65;
  const glowAlpha = phase === 'active' ? 0.3 : phase === 'reveal' ? 0.5 : 0.15;

  ctx.save();
  ctx.strokeStyle = `rgba(0,240,255,${glowAlpha})`;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = `rgba(0,240,255,${glowAlpha})`;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(vpX, ellipseCy, ellipseRx, ellipseRy, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

function drawScanBeam(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  time: number,
) {
  const beamY = (H * 0.3) + (Math.sin(time * 0.001) * 0.5 + 0.5) * (H * 0.5);
  ctx.save();
  const grad = ctx.createLinearGradient(0, beamY - 20, 0, beamY + 20);
  grad.addColorStop(0, 'rgba(0,240,255,0)');
  grad.addColorStop(0.5, 'rgba(0,240,255,0.08)');
  grad.addColorStop(1, 'rgba(0,240,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, beamY - 20, W, 40);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Mini-log row
// ---------------------------------------------------------------------------

interface MiniLogEntry {
  key: string;
  relTime: string;
  teamColor: string;
  label: string;
  icon: string;
  color: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'arena-mini-log';

export default function BattleArena({
  teams,
  events,
  state,
  elapsedMs,
  timeLimitMs,
  scores,
  winnerId,
}: BattleArenaProps) {
  // ── Refs ──────────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gladiatorsRef = useRef<GladiatorRenderer[]>([]);
  const particlesRef = useRef<ParticleSystem>(new ParticleSystem());
  const processorRef = useRef<EventProcessor | null>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const phaseRef = useRef<ArenaPhase>('active');
  const revealFiredRef = useRef(false);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // ── State (only for HUD — not per-frame) ──────────────────────────────
  const [miniLogOpen, setMiniLogOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  // Force HUD re-render every ~250ms to update counters/actions
  const [, setHudTick] = useState(0);
  const hudTickRef = useRef(0);

  // Toggle mini-log persistence
  const toggleMiniLog = useCallback(() => {
    setMiniLogOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  // ── Initialize gladiators + processor ─────────────────────────────────
  useEffect(() => {
    const W = sizeRef.current.w || 800;
    const H = sizeRef.current.h || 600;
    const positions = computePositions(teams, W, H);
    const scale = Math.min(W, H) / 270;

    gladiatorsRef.current = teams.map((t, i) => {
      const pos = positions[i];
      return new GladiatorRenderer(
        t.id,
        resolveModelBuild(t.model),
        getModelColor(t.model),
        pos.x,
        pos.y,
        scale,
        pos.facing,
      );
    });

    processorRef.current = new EventProcessor(teams.map((t) => t.id));
    particlesRef.current.clear();
    revealFiredRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.map((t) => t.id).join(',')]);

  // ── Phase tracking ────────────────────────────────────────────────────
  useEffect(() => {
    const phase = stateToPhase(state);
    phaseRef.current = phase;

    if (phase === 'reveal' && !revealFiredRef.current) {
      revealFiredRef.current = true;
      const proc = processorRef.current;
      if (proc) {
        proc.setTerminalPoses(winnerId ?? null, teams.map((t) => t.id));
      }
      // Set terminal poses on gladiators
      for (const glad of gladiatorsRef.current) {
        const m = processorRef.current?.getMomentum(glad.teamId);
        if (m?.terminalPose) glad.setTerminalPose(m.terminalPose);
      }
      // Spawn triumph explosion for winner
      if (winnerId) {
        const winGlad = gladiatorsRef.current.find((g) => g.teamId === winnerId);
        if (winGlad) {
          const color = winGlad.color;
          particlesRef.current.spawn('triumph_explosion', winGlad.x, winGlad.y, color, 30);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, winnerId]);

  // ── Resize observer ───────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sizeRef.current = { w: width, h: height };

        // Reposition gladiators on resize
        const positions = computePositions(teams, width, height);
        const scale = Math.min(width, height) / 270;
        gladiatorsRef.current = teams.map((t, i) => {
          const pos = positions[i];
          const g = new GladiatorRenderer(
            t.id,
            resolveModelBuild(t.model),
            getModelColor(t.model),
            pos.x,
            pos.y,
            scale,
            pos.facing,
          );
          // Restore terminal pose if already set
          const m = processorRef.current?.getMomentum(t.id);
          if (m?.terminalPose) g.setTerminalPose(m.terminalPose);
          return g;
        });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.map((t) => t.id).join(',')]);

  // ── Animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    let running = true;

    function animate(timestamp: number) {
      if (!running) return;

      const dt = lastTimeRef.current ? timestamp - lastTimeRef.current : 16.67;
      lastTimeRef.current = timestamp;
      const dtSec = dt / 1000;

      const canvas = canvasRef.current;
      if (!canvas) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const W = sizeRef.current.w;
      const H = sizeRef.current.h;
      if (W === 0 || H === 0) {
        rafRef.current = requestAnimationFrame(animate);
        return;
      }

      const proc = processorRef.current;
      const phase = phaseRef.current;

      // Process new events
      if (proc) {
        const commands = proc.processEvents(events);
        for (const cmd of commands) {
          const glad = gladiatorsRef.current.find((g) => g.teamId === cmd.teamId);
          if (!glad) continue;

          if (cmd.flash) glad.triggerFlash(cmd.flash);
          if (cmd.basePose && !cmd.flash) glad.setBasePose(cmd.basePose);

          if (cmd.particle && phase === 'active') {
            if (cmd.particle === 'strike_projectile') {
              // Fire toward another gladiator
              const others = gladiatorsRef.current.filter((g) => g.teamId !== cmd.teamId);
              if (others.length > 0) {
                const target = others[Math.floor(Math.random() * others.length)];
                const [hx, hy] = glad.getHandPosition();
                particlesRef.current.spawnProjectile(hx, hy, target.x, target.y, glad.color);
              }
            } else {
              particlesRef.current.spawn(cmd.particle, glad.x, glad.y, glad.color, 6);
            }
          }
        }

        proc.tick(dtSec);
      }

      // Update gladiators
      for (const glad of gladiatorsRef.current) {
        const m = proc?.getMomentum(glad.teamId);
        const energy = m?.energy ?? 0;
        if (m?.terminalPose) {
          glad.setTerminalPose(m.terminalPose);
        } else if (m?.basePose) {
          glad.setBasePose(m.basePose);
        }
        glad.update(dt, energy);
      }

      // Update particles
      particlesRef.current.update(dt);

      // Draw
      ctx.clearRect(0, 0, W, H);
      drawBackground(ctx, W, H);
      drawGridFloor(ctx, W, H, phase);

      if (phase === 'judging') {
        drawScanBeam(ctx, W, H, timestamp);
      }

      particlesRef.current.draw(ctx);
      for (const glad of gladiatorsRef.current) {
        glad.draw(ctx);
      }

      // HUD tick (every ~250ms)
      hudTickRef.current += dt;
      if (hudTickRef.current > 250) {
        hudTickRef.current = 0;
        setHudTick((prev) => prev + 1);
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
    // events is intentionally in the dep array so processEvents picks up new ones
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // ── Derive HUD data ───────────────────────────────────────────────────
  const phase = stateToPhase(state);
  const remainingMs = Math.max(0, timeLimitMs - elapsedMs);
  const timerText = phase === 'active' ? formatElapsed(remainingMs) : '';
  const pLabel = phaseLabel(phase, winnerId, teams);

  // Per-team HUD data
  const teamHud = teams.map((t) => {
    const m = processorRef.current?.getMomentum(t.id);
    const energy = m?.energy ?? 0;
    const counts = m?.eventCounts ?? { reasoning: 0, fileCreate: 0, toolCall: 0, error: 0 };
    const action = m?.latestAction ?? '';
    const color = getModelColor(t.model);
    const label = t.persona ? `${t.model}:${t.persona}` : t.model;
    const score = scores?.find((s) => s.teamId === t.id)?.finalScore;
    return { id: t.id, label, color, energy, counts, action, score };
  });

  // Mini-log: last 8 events
  const startTs = events.length > 0 ? events[0].timestamp : null;
  const miniLogEntries: MiniLogEntry[] = [];
  for (let i = events.length - 1; i >= 0 && miniLogEntries.length < 8; i--) {
    const ev = events[i];
    const info = classifyEvent(ev.type, ev.payload);
    if (!info) continue;
    const teamColor = ev.teamId
      ? getModelColor(teams.find((t) => t.id === ev.teamId)?.model ?? '')
      : ACCENT_CYAN;
    miniLogEntries.push({
      key: ev.eventId,
      relTime: getRelativeTime(ev.timestamp, startTs),
      teamColor,
      label: info.label,
      icon: info.icon,
      color: info.color,
      text: info.text.length > 40 ? info.text.slice(0, 40) + '...' : info.text,
    });
  }
  miniLogEntries.reverse();

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: '8px',
        border: '1px solid rgba(0,240,255,0.1)',
      }}
    >
      {/* Canvas layer */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />

      {/* HUD overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          fontFamily: MONOSPACE_FONT,
        }}
      >
        {/* Top bar: timer + live indicator */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '12px 16px 0',
          }}
        >
          {phase === 'active' && (
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 6px #22c55e',
                display: 'inline-block',
                animation: 'arena-live-pulse 1.5s ease-in-out infinite',
              }}
            />
          )}
          <span
            style={{
              color: TEXT_PRIMARY,
              fontSize: '1.1rem',
              fontWeight: 700,
              letterSpacing: '2px',
              textShadow: '0 0 10px rgba(0,240,255,0.4)',
            }}
          >
            {timerText || pLabel}
          </span>
          {phase === 'active' && (
            <span
              style={{
                color: '#22c55e',
                fontSize: '0.55rem',
                fontWeight: 700,
                letterSpacing: '2px',
                textTransform: 'uppercase' as const,
              }}
            >
              LIVE
            </span>
          )}
        </div>

        {/* Team names + energy + counters — top row */}
        <div
          style={{
            display: 'flex',
            justifyContent: teams.length === 2 ? 'space-between' : 'center',
            flexWrap: 'wrap',
            gap: '12px',
            padding: '10px 16px 0',
          }}
        >
          {teamHud.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: teams.length === 2
                  ? t.id === teams[0].id ? 'flex-start' : 'flex-end'
                  : 'center',
                minWidth: 120,
              }}
            >
              {/* Name */}
              <span
                style={{
                  color: t.color,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textShadow: `0 0 8px ${t.color}`,
                  textTransform: 'uppercase' as const,
                }}
              >
                {t.label}
              </span>

              {/* Energy bar */}
              <div
                style={{
                  width: 100,
                  height: 4,
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: 2,
                  marginTop: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.round(t.energy * 100)}%`,
                    height: '100%',
                    background: t.color,
                    boxShadow: `0 0 6px ${t.color}`,
                    borderRadius: 2,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              {/* Event counters */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  marginTop: 4,
                  fontSize: '0.5rem',
                  color: TEXT_DIM,
                  fontFamily: BODY_FONT,
                }}
              >
                <span title="Files created">
                  📄 {t.counts.fileCreate}
                </span>
                <span title="Tool calls">
                  ⚡ {t.counts.toolCall}
                </span>
                <span title="Reasoning">
                  🧠 {t.counts.reasoning}
                </span>
              </div>

              {/* Score (reveal phase) */}
              {phase === 'reveal' && t.score != null && (
                <span
                  style={{
                    color: t.color,
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    marginTop: 4,
                    textShadow: `0 0 8px ${t.color}`,
                  }}
                >
                  {(t.score * 100).toFixed(0)}%
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Bottom: latest action per team */}
        <div
          style={{
            position: 'absolute',
            bottom: miniLogOpen ? 210 : 36,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: teams.length === 2 ? 'space-between' : 'center',
            gap: '16px',
            padding: '0 16px',
            transition: 'bottom 0.3s ease',
          }}
        >
          {teamHud.map((t) => (
            <div
              key={t.id}
              style={{
                maxWidth: teams.length === 2 ? '45%' : 200,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.5rem',
                color: t.color,
                fontFamily: BODY_FONT,
                opacity: 0.8,
                textShadow: `0 0 4px rgba(${hexToRgb(t.color)},0.3)`,
              }}
            >
              {t.action}
            </div>
          ))}
        </div>
      </div>

      {/* Mini event log */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          pointerEvents: 'auto',
        }}
      >
        {/* Toggle button */}
        <button
          onClick={toggleMiniLog}
          style={{
            position: 'absolute',
            top: miniLogOpen ? -28 : -28,
            right: 12,
            background: 'rgba(0,4,8,0.85)',
            border: `1px solid rgba(0,240,255,0.15)`,
            borderRadius: '4px 4px 0 0',
            color: TEXT_DIM,
            fontSize: '0.55rem',
            fontFamily: MONOSPACE_FONT,
            padding: '3px 10px',
            cursor: 'pointer',
            letterSpacing: '1px',
            zIndex: 2,
          }}
        >
          {miniLogOpen ? '▾ LOG' : '▴ LOG'}
        </button>

        {/* Log panel */}
        {miniLogOpen && (
          <div
            style={{
              background: 'rgba(0,4,8,0.9)',
              borderTop: '1px solid rgba(0,240,255,0.12)',
              maxHeight: 200,
              overflowY: 'auto',
              padding: '6px 12px',
            }}
          >
            {miniLogEntries.length === 0 && (
              <div
                style={{
                  color: TEXT_DIM,
                  fontSize: '0.55rem',
                  fontFamily: BODY_FONT,
                  textAlign: 'center',
                  padding: '8px 0',
                }}
              >
                No events yet
              </div>
            )}
            {miniLogEntries.map((entry) => (
              <div
                key={entry.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '2px 0',
                  fontSize: '0.52rem',
                  fontFamily: BODY_FONT,
                  lineHeight: 1.4,
                }}
              >
                {/* Relative time */}
                <span
                  style={{
                    color: TEXT_DIM,
                    width: 36,
                    textAlign: 'right',
                    flexShrink: 0,
                  }}
                >
                  {entry.relTime}
                </span>
                {/* Team color dot */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: entry.teamColor,
                    boxShadow: `0 0 4px ${entry.teamColor}`,
                    flexShrink: 0,
                  }}
                />
                {/* Type badge */}
                <span
                  style={{
                    color: entry.color,
                    fontWeight: 700,
                    fontSize: '0.48rem',
                    letterSpacing: '0.5px',
                    background: `rgba(${hexToRgb(entry.color)},0.1)`,
                    padding: '1px 5px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                >
                  {entry.icon} {entry.label}
                </span>
                {/* Text */}
                <span
                  style={{
                    color: TEXT_PRIMARY,
                    opacity: 0.7,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CSS animation for live pulse */}
      <style>{`
        @keyframes arena-live-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
