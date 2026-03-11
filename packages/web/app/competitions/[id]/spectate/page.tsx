'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { LANE_COLORS, getStateStyle, hexToRgb, MODEL_BADGE_COLORS } from '../../../../lib/design-tokens';
import { classifyEvent } from '../../../../lib/EventRow';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Team { id: string; model: string; persona?: string; }

interface Brief { title: string; }

interface ArenaEvent {
  eventId: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

interface CriterionScore { criterionId: string; score: number; maxScore: number; commentary: string; }
interface TeamResult { teamId: string; totalScore: number; criteriaScores: CriterionScore[]; }
interface CompetitionResult {
  winnerId: string | null;
  teams: TeamResult[];
  summary?: string;
}

type CompetitionState = 'PENDING' | 'RUNNING' | 'COLLECTING' | 'PRESENTING' | 'JUDGING' | 'SYNTHESIZING' | 'COMPLETE' | 'FORGING' | 'FORGE_COMPLETE' | 'ERROR' | 'FAILED' | 'CANCELLED';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getModelName(model: string): string {
  return model.toLowerCase().split(':')[0];
}

function resolveTeamLabel(teams: Team[], teamId: string, fallback: string): string {
  const team = teams.find((t) => t.id === teamId);
  if (!team) return fallback;
  const base = team.model;
  return team.persona ? `${base}:${team.persona}` : base;
}

// ─── Global CSS ──────────────────────────────────────────────────────────────

const SPECTATE_STYLES = `
@keyframes spectate-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
@keyframes spectate-slide-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes spectate-live-pulse {
  0%, 100% { box-shadow: 0 0 4px rgba(0,240,255,0.5); }
  50%       { box-shadow: 0 0 10px rgba(0,240,255,0.9); }
}
@keyframes spectate-winner-glow {
  0%, 100% { box-shadow: inset 0 0 0 1px rgba(0,240,255,0.2), 0 0 20px rgba(0,240,255,0.08); }
  50%       { box-shadow: inset 0 0 0 1px rgba(0,240,255,0.5), 0 0 40px rgba(0,240,255,0.15); }
}

.spec-event-row {
  animation: spectate-slide-in 0.18s ease-out;
}
.spec-scrollbar::-webkit-scrollbar { width: 4px; }
.spec-scrollbar::-webkit-scrollbar-track { background: transparent; }
.spec-scrollbar::-webkit-scrollbar-thumb { background: #0a2235; border-radius: 2px; }
.spec-scrollbar::-webkit-scrollbar-thumb:hover { background: #0e3050; }
`;

// ─── Model Badge ─────────────────────────────────────────────────────────────

function ModelBadge({ model }: { model: string }) {
  const name = getModelName(model);
  const colors = MODEL_BADGE_COLORS[name] ?? { bg: 'rgba(74,143,168,0.12)', fg: '#4a8fa8', border: 'rgba(74,143,168,0.3)' };
  return (
    <span style={{
      fontSize: '0.88rem', fontWeight: 900,
      padding: '0.3rem 0.85rem', borderRadius: '5px',
      background: colors.bg, color: colors.fg, border: `1px solid ${colors.border}`,
      letterSpacing: '1.5px', textTransform: 'uppercase',
    }}>
      {name}
    </span>
  );
}

// ─── Status Dot ──────────────────────────────────────────────────────────────

function StatusDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: '8px', height: '8px',
      borderRadius: '50%', background: color,
      boxShadow: pulsing ? `0 0 5px ${color}` : 'none',
      animation: pulsing ? 'spectate-pulse 1.5s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  );
}

// ─── Single event row in spectate view ───────────────────────────────────────

function SpectateEventRow({ event }: { event: ArenaEvent }) {
  const info = classifyEvent(event.type, event.payload);
  if (!info) return null;

  return (
    <div
      className="spec-event-row"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.45rem',
        padding: '0.25rem 0.5rem', borderRadius: '3px',
        background: `rgba(${hexToRgb(info.bg.startsWith('rgba') ? '#050f1e' : info.bg)},0.08)`,
      }}
    >
      <span style={{ fontSize: '0.65rem', flexShrink: 0, lineHeight: '1.4', marginTop: '0.05rem' }}>{info.icon}</span>
      <span style={{
        fontSize: '0.68rem', color: info.color, fontFamily: 'monospace',
        lineHeight: 1.4, wordBreak: 'break-all',
        overflow: 'hidden', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>
        <span style={{ color: '#3d7d94', marginRight: '0.3rem', fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.5px' }}>
          {info.label}
        </span>
        {info.text.slice(0, 120)}{info.text.length > 120 ? '…' : ''}
      </span>
    </div>
  );
}

// ─── Lane column ─────────────────────────────────────────────────────────────

function SpectateColumn({
  team,
  color,
  events,
  isRunning,
  isWinner,
  score,
  borderLeft,
  scrollRef,
}: {
  team: Team;
  color: string;
  events: ArenaEvent[];
  isRunning: boolean;
  isWinner: boolean;
  score?: number;
  borderLeft?: boolean;
  scrollRef: (el: HTMLDivElement | null) => void;
}) {
  const recentActivity = events.length > 0 &&
    (Date.now() - new Date(events[events.length - 1].timestamp).getTime()) < 5000;
  const rgb = hexToRgb(color);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: '#050f1e',
      borderLeft: borderLeft ? '1px solid #0a2235' : 'none',
      overflow: 'hidden',
      animation: isWinner ? 'spectate-winner-glow 2s ease-in-out infinite' : 'none',
    }}>
      {/* Column header */}
      <div style={{
        padding: '1rem 1.25rem 0.85rem',
        background: `linear-gradient(180deg, rgba(${rgb},0.10) 0%, rgba(${rgb},0.03) 100%)`,
        borderBottom: `2px solid ${isRunning ? color : '#0a2235'}`,
        flexShrink: 0,
        transition: 'border-color 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '0.5rem' }}>
          <StatusDot color={color} pulsing={isRunning && recentActivity} />
          <ModelBadge model={team.model} />
          {isWinner && (
            <span style={{
              fontSize: '0.65rem', fontWeight: 900, color: '#eab308',
              background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.4)',
              borderRadius: '4px', padding: '0.15rem 0.45rem', letterSpacing: '1px',
            }}>
              WINNER
            </span>
          )}
          {score !== undefined && (
            <span style={{
              marginLeft: 'auto',
              fontSize: '1.1rem', fontWeight: 900,
              color: isWinner ? '#eab308' : '#7cc6db',
              fontFamily: 'monospace',
            }}>
              {Math.round(score * 100)}%
            </span>
          )}
        </div>
        {team.persona && (
          <div style={{
            fontSize: '0.78rem', color, fontWeight: 700,
            letterSpacing: '0.5px', paddingLeft: '1.4rem',
          }}>
            :{team.persona}
          </div>
        )}
        <div style={{
          fontSize: '0.6rem', color: '#3d7d94', fontFamily: 'monospace',
          paddingLeft: '1.4rem', marginTop: '0.25rem',
        }}>
          {events.length} events
        </div>
      </div>

      {/* Event stream */}
      <div
        ref={scrollRef}
        className="spec-scrollbar"
        style={{
          flex: 1, overflowY: 'auto',
          padding: '0.5rem 0.4rem',
          display: 'flex', flexDirection: 'column', gap: '2px',
        }}
      >
        {events.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%',
            color: '#1e4a5a', fontSize: '0.72rem', fontStyle: 'italic',
          }}>
            {isRunning ? 'Waiting for activity…' : 'No events yet'}
          </div>
        )}
        {events.map((ev) => (
          <SpectateEventRow key={ev.eventId} event={ev} />
        ))}
      </div>
    </div>
  );
}

// ─── Main spectate page ───────────────────────────────────────────────────────

export default function SpectatePage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [teamEvents, setTeamEvents] = useState<Map<string, ArenaEvent[]>>(new Map());
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [connected, setConnected] = useState(false);

  // Map of teamId -> scroll container DOM node
  const laneEls = useRef<Map<string, HTMLDivElement>>(new Map());

  // Fetch initial competition metadata
  useEffect(() => {
    if (!id) return;
    fetch(`/api/competitions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: {
        teams?: Team[];
        brief?: Brief;
        state?: CompetitionState;
        result?: Record<string, unknown> | null;
      } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief) setBrief(data.brief);
        if (data.state) setState(data.state);
        if (data.result) {
          const raw = data.result;
          const scorecards = (raw.scorecards ?? []) as Array<{
            teamId: string;
            finalScore: number;
            judgeResults?: Array<{ scores?: Array<{ criterionId: string; score: number; maxScore?: number; commentary?: string }> }>;
          }>;
          setResult({
            winnerId: (raw.winnerId as string) ?? null,
            teams: scorecards.map((sc) => ({
              teamId: sc.teamId,
              totalScore: sc.finalScore,
              criteriaScores: sc.judgeResults?.[0]?.scores?.map((s) => ({
                criterionId: s.criterionId,
                score: s.score,
                maxScore: s.maxScore ?? 10,
                commentary: s.commentary ?? '',
              })) ?? [],
            })),
            summary: raw.summary as string | undefined,
          });
        }
      })
      .catch(() => {});
  }, [id]);

  // WebSocket connection
  useEffect(() => {
    if (!id) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000';
    let ws: WebSocket;
    let lastSeq = 0;
    let retries = 0;
    let intentionalClose = false;
    const MAX_RETRIES = 5;

    function pushEvent(teamId: string, ev: ArenaEvent) {
      if (!teamId || teamId === '') return; // ignore broadcast events in spectate
      setTeamEvents((prev) => {
        const next = new Map(prev);
        const existing = next.get(teamId) ?? [];
        const updated = [...existing, ev];
        // Cap at 600 per team, preserving important events
        if (updated.length > 600) {
          const important = updated.filter((e) => e.type !== 'REASONING');
          const reasoning = updated.filter((e) => e.type === 'REASONING');
          next.set(teamId, [...important, ...reasoning.slice(-Math.max(200, 500 - important.length))]);
        } else {
          next.set(teamId, updated);
        }
        return next;
      });
    }

    function connect() {
      ws = new WebSocket(`${wsUrl}/competitions/${id}/stream`);
      ws.onopen = () => {
        setConnected(true);
        retries = 0;
        ws.send(JSON.stringify({ lastSeq }));
      };
      ws.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data as string) as ArenaEvent & {
            result?: CompetitionResult;
            _seq?: number;
            state?: string;
          };
          if (typeof ev._seq === 'number') lastSeq = ev._seq;

          if (ev.type === 'STATE_CHANGE') {
            const s = ev.state as string;
            if (s === 'RUNNING') setState('RUNNING');
            else if (s === 'JUDGING' || s === 'COLLECTING' || s === 'SYNTHESIZING') setState(s as CompetitionState);
            else if (s === 'PAUSED') { /* ignore paused in spectate */ }
            else if (s === 'FAILED' || s === 'CANCELLED') {
              setState(s as CompetitionState);
              intentionalClose = true;
              ws.close();
            }
            return;
          }
          if (ev.type === 'COMPETITION_START') {
            setState('RUNNING');
            return;
          }
          if (ev.type === 'COMPETITION_COMPLETE' || ev.type === 'COMPLETE') {
            setState('COMPLETE');
            if (ev.result) setResult(ev.result);
            intentionalClose = true;
            ws.close();
            return;
          }

          pushEvent(ev.teamId ?? '', ev);
        } catch { /* ignore */ }
      };
      ws.onerror = () => setConnected(false);
      ws.onclose = () => {
        setConnected(false);
        if (!intentionalClose && retries < MAX_RETRIES) {
          retries++;
          setTimeout(connect, Math.min(1000 * retries, 5000));
        }
      };
    }

    connect();
    return () => { intentionalClose = true; ws?.close(); };
  }, [id]);

  // Auto-scroll lanes to bottom
  useEffect(() => {
    for (const el of laneEls.current.values()) {
      if (!el) continue;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [teamEvents]);

  const isRunning = state === 'RUNNING';
  const isComplete = state === 'COMPLETE' || state === 'FORGE_COMPLETE';
  const stateBadge = getStateStyle(state);

  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : Array.from(teamEvents.keys()).map((tid) => ({ id: tid, model: tid }));

  const numTeams = Math.max(orderedTeams.length, 2);
  const winnerLabel = result?.winnerId
    ? resolveTeamLabel(orderedTeams, result.winnerId, result.winnerId)
    : null;

  return (
    <>
      <style suppressHydrationWarning>{SPECTATE_STYLES}</style>
      <div style={{
        display: 'flex', flexDirection: 'column',
        height: '100vh', overflow: 'hidden',
        background: '#000408',
        fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        color: '#c8eef8',
      }}>
        {/* ── Top bar ───────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          padding: '0.5rem 1.2rem',
          borderBottom: '1px solid #0a2235',
          background: 'rgba(2,8,20,0.98)',
          flexShrink: 0,
        }}>
          {/* Back link */}
          <a
            href={`/competitions/${id}`}
            style={{
              fontSize: '0.68rem', color: '#3d7d94', textDecoration: 'none',
              display: 'flex', alignItems: 'center', gap: '0.3rem',
              transition: 'color 0.15s',
              flexShrink: 0,
            }}
          >
            ← Back
          </a>

          <span style={{ color: '#0a2235', fontSize: '1rem' }}>│</span>

          {/* Title */}
          <div style={{
            flex: 1, minWidth: 0,
            display: 'flex', alignItems: 'center', gap: '0.75rem',
          }}>
            {brief?.title && (
              <span style={{
                fontSize: '0.9rem', fontWeight: 800, color: '#c8eef8',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {brief.title}
              </span>
            )}

            {/* State badge */}
            <span style={{
              fontSize: '0.65rem', fontWeight: 800, padding: '0.18rem 0.55rem',
              borderRadius: '4px', letterSpacing: '1.5px',
              background: stateBadge.bg, color: stateBadge.color,
              border: `1px solid ${stateBadge.color}33`,
              flexShrink: 0,
            }}>
              {state}
            </span>

            {/* LIVE pulse badge */}
            {isRunning && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 900, letterSpacing: '2px',
                color: '#00f0ff', background: 'rgba(0,240,255,0.1)',
                border: '1px solid rgba(0,240,255,0.4)',
                borderRadius: '4px', padding: '0.15rem 0.5rem',
                animation: 'spectate-live-pulse 1.5s ease-in-out infinite',
                flexShrink: 0,
              }}>
                LIVE
              </span>
            )}

            {/* Connection dot */}
            {!connected && (
              <span style={{ fontSize: '0.6rem', color: '#eab308', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <StatusDot color="#eab308" pulsing={true} />
                connecting…
              </span>
            )}
          </div>

          {/* Winner banner (when complete) */}
          {isComplete && winnerLabel && (
            <span style={{
              fontSize: '0.72rem', fontWeight: 800,
              color: '#eab308', background: 'rgba(234,179,8,0.1)',
              border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: '5px', padding: '0.25rem 0.75rem',
              letterSpacing: '1px', flexShrink: 0,
            }}>
              🏆 {winnerLabel} wins
            </span>
          )}
        </div>

        {/* ── Two-column event grid ─────────────────────────────────────────── */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'grid',
          gridTemplateColumns: `repeat(${numTeams}, 1fr)`,
          gap: '1px',
          background: '#0a2235',
          overflow: 'hidden',
        }}>
          {orderedTeams.map((team, i) => {
            const color = LANE_COLORS[i] ?? '#4a8fa8';
            const events = (teamEvents.get(team.id) ?? [])
              .slice()
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            const isWinner = !!result?.winnerId && team.id === result.winnerId;
            const teamScore = result?.teams.find((tr) => tr.teamId === team.id)?.totalScore;

            return (
              <SpectateColumn
                key={team.id}
                team={team}
                color={color}
                events={events}
                isRunning={isRunning}
                isWinner={isWinner}
                score={teamScore}
                borderLeft={i > 0}
                scrollRef={(el) => {
                  if (el) laneEls.current.set(team.id, el);
                  else laneEls.current.delete(team.id);
                }}
              />
            );
          })}

          {orderedTeams.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gridColumn: '1 / -1',
              color: '#1e4a5a', fontSize: '0.82rem',
            }}>
              Waiting for competition data…
            </div>
          )}
        </div>
      </div>
    </>
  );
}
