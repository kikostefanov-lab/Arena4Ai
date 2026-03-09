'use client';

import { forwardRef, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { formatElapsed } from '../../../lib/format';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Team { id: string; model: string; persona?: string; }

interface ArenaEvent {
  eventId: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: unknown;
  metadata: Record<string, unknown>;
}

interface CriterionScore { criterionId: string; score: number; maxScore: number; }
interface TeamResult { teamId: string; totalScore: number; criteriaScores: CriterionScore[]; }
interface CompetitionResult { winnerId: string | null; teams: TeamResult[]; summary?: string; synthesis?: string | null; }

type CompetitionState = 'PENDING' | 'RUNNING' | 'JUDGING' | 'COMPLETE' | 'ERROR';

// ─── Event classification ─────────────────────────────────────────────────────

interface EventInfo {
  label: string;
  icon: string;
  color: string;
  bg: string;
  text: string;
}

function getToolIcon(toolName: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec|command/.test(n)) return '⚡';
  if (/write|create|save/.test(n)) return '✍️';
  if (/read|cat|view|open/.test(n)) return '👁️';
  if (/search|grep|find|glob/.test(n)) return '🔍';
  if (/python|py|node|js/.test(n)) return '🐍';
  if (/edit|replace|patch|str/.test(n)) return '✏️';
  if (/web|http|fetch|curl|url/.test(n)) return '🌐';
  if (/list|ls|dir/.test(n)) return '📂';
  if (/git/.test(n)) return '🔀';
  return '🔧';
}

function toolCommentary(toolName: string, valStr: string): string {
  const n = toolName.toLowerCase();
  if (/bash|shell|run|exec/.test(n)) return `$ ${valStr}`;
  if (/write|create/.test(n)) return `Writing to ${valStr}`;
  if (/read|cat|view/.test(n)) return `Reading ${valStr}`;
  if (/search|grep|find/.test(n)) return `Searching: ${valStr}`;
  if (/edit|replace|patch|str/.test(n)) return `Patching ${valStr}`;
  if (/glob/.test(n)) return `Glob: ${valStr}`;
  return valStr ? `${toolName}: ${valStr}` : toolName;
}

function classifyEvent(type: string, payload: unknown): EventInfo | null {
  const p = payload as Record<string, unknown> | null;
  if (!p) return null;

  switch (type) {
    case 'TOOL_CALL': {
      const tool = String(p.tool ?? 'unknown');
      const input = (p.input ?? {}) as Record<string, unknown>;
      const val = input.command ?? input.code ?? input.path ?? input.query ?? input.content;
      const valStr = val ? String(val).replace(/\n/g, ' ').trim().slice(0, 80) : '';
      const keys = Object.keys(input);
      const text = toolCommentary(tool, valStr || (keys.length ? `${keys[0]}=…` : ''));
      return {
        label: tool.toUpperCase().slice(0, 8),
        icon: getToolIcon(tool),
        color: '#3b82f6',
        bg: 'rgba(59,130,246,0.08)',
        text,
      };
    }

    case 'FILE_CREATE': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      const fname = m ? m[1] : text.slice(0, 80);
      return { label: 'CREATE', icon: '📄', color: '#22c55e', bg: 'rgba(34,197,94,0.08)', text: `New file: ${fname}` };
    }

    case 'FILE_MODIFY': {
      const text = String(p.text ?? p.path ?? '');
      const m = text.match(/(\/?(?:[\w.-]+\/)*[\w.-]+\.\w+)/);
      const fname = m ? m[1] : text.slice(0, 80);
      return { label: 'MODIFY', icon: '✏️', color: '#10b981', bg: 'rgba(16,185,129,0.08)', text: `Modified: ${fname}` };
    }

    case 'REASONING': {
      if (p.text && typeof p.text === 'string') {
        return { label: 'THINK', icon: '🧠', color: '#06b6d4', bg: 'rgba(6,182,212,0.06)', text: p.text.trim().slice(0, 160) };
      }
      if (p.raw) {
        const raw = p.raw as Record<string, unknown>;

        if (raw.type === 'system' || raw.type === 'rate_limit_event') return null;

        if (raw.type === 'user') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const toolResult = (content as Record<string, unknown>[]).find((b) => b.type === 'tool_result');
            if (toolResult?.content && typeof toolResult.content === 'string') {
              const resultText = toolResult.content.replace(/\n/g, ' ').trim();
              const isErr = /error|failed|exception|traceback|command not found/i.test(resultText);
              return {
                label: isErr ? 'FAIL' : 'RESULT',
                icon: isErr ? '❌' : '✅',
                color: isErr ? '#ef4444' : '#22c55e',
                bg: isErr ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.06)',
                text: resultText.slice(0, 160),
              };
            }
          }
          return null;
        }

        if (raw.type === 'result') {
          const res = raw.result;
          const resText = res && typeof res === 'string' ? res.trim() : null;
          if (!resText) return null;
          return { label: 'DONE', icon: '🏁', color: '#f97316', bg: 'rgba(249,115,22,0.08)', text: resText.slice(0, 160) };
        }

        if (raw.type === 'assistant') {
          const msg = raw.message as Record<string, unknown> | null;
          const content = msg?.content;
          if (Array.isArray(content)) {
            const blocks = content as Record<string, unknown>[];

            // Text output from agent
            const tb = blocks.find((b) => b.type === 'text');
            if (tb?.text && typeof tb.text === 'string') {
              return { label: 'OUTPUT', icon: '💬', color: '#a78bfa', bg: 'rgba(167,139,250,0.07)', text: tb.text.slice(0, 160) };
            }

            // Claude's internal thinking
            const thinkBlock = blocks.find((b) => b.type === 'thinking');
            if (thinkBlock?.thinking && typeof thinkBlock.thinking === 'string') {
              const raw = thinkBlock.thinking.replace(/\n/g, ' ').trim();
              // Take first natural sentence for punchy commentary
              const sentence = raw.match(/[^.!?]{10,}[.!?]/)?.[0]?.trim() ?? raw;
              return { label: 'THINK', icon: '🧠', color: '#06b6d4', bg: 'rgba(6,182,212,0.06)', text: sentence.slice(0, 160) };
            }

            // Tool invocation
            const toolBlock = blocks.find((b) => b.type === 'tool_use');
            if (toolBlock) {
              const toolName = String(toolBlock.name ?? 'tool');
              const input = toolBlock.input as Record<string, unknown> | undefined;
              const val = input?.command ?? input?.code ?? input?.path ?? input?.content ?? input?.query ?? input?.pattern;
              const valStr = val && typeof val === 'string' ? val.replace(/\n/g, ' ').slice(0, 80) : '';
              const text = toolCommentary(toolName, valStr);
              return {
                label: toolName.toUpperCase().slice(0, 8),
                icon: getToolIcon(toolName),
                color: '#3b82f6',
                bg: 'rgba(59,130,246,0.08)',
                text,
              };
            }
          }
          return null;
        }
      }
      return null;
    }

    case 'ERROR': {
      const err = p.error;
      let text = '';
      if (typeof err === 'string') text = err.slice(0, 160);
      else if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        text = String(e.message ?? e.text ?? JSON.stringify(err)).slice(0, 160);
      } else {
        text = typeof p.raw === 'string' ? p.raw.slice(0, 120) : '';
      }
      if (!text) return null;
      return { label: 'ERROR', icon: '⚠️', color: '#ef4444', bg: 'rgba(239,68,68,0.10)', text };
    }

    case 'TIME_WARNING':
    case 'TIME_UP': {
      const rem = p.remainingMs ?? p.remaining;
      const text = rem != null ? `${Math.round(Number(rem) / 1000)}s remaining on the clock` : null;
      if (!text) return null;
      const isUp = type === 'TIME_UP';
      return { label: isUp ? 'TIME UP' : 'TIME', icon: '⏰', color: isUp ? '#f97316' : '#eab308', bg: isUp ? 'rgba(249,115,22,0.12)' : 'rgba(234,179,8,0.10)', text };
    }

    case 'JUDGE_SCORE': {
      const score = p.score ?? p.totalScore;
      const crit = p.criterionId ?? p.criterion;
      if (crit && score != null) return { label: 'SCORE', icon: '⚖️', color: '#a855f7', bg: 'rgba(168,85,247,0.10)', text: `${String(crit)} → ${score}` };
      return null;
    }

    default: return null;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HIST_COLORS: Record<string, string> = {
  TOOL_CALL:   '#3b82f6',
  FILE_CREATE: '#22c55e',
  FILE_MODIFY: '#10b981',
  REASONING:   '#06b6d4',
  ERROR:       '#ef4444',
};

const LANE_COLORS = ['#3b82f6', '#a855f7', '#22c55e', '#f97316', '#eab308'];

const MODEL_BADGE_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  claude: { bg: 'rgba(249,115,22,0.15)', fg: '#f97316', border: 'rgba(249,115,22,0.4)' },
  codex:  { bg: 'rgba(34,197,94,0.15)',  fg: '#22c55e', border: 'rgba(34,197,94,0.4)' },
  gemini: { bg: 'rgba(59,130,246,0.15)', fg: '#3b82f6', border: 'rgba(59,130,246,0.4)' },
};

const STATE_BADGE: Record<string, { bg: string; color: string }> = {
  PENDING:  { bg: 'rgba(136,150,171,0.1)', color: '#8896ab' },
  RUNNING:  { bg: 'rgba(249,115,22,0.15)', color: '#f97316' },
  JUDGING:  { bg: 'rgba(234,179,8,0.12)',  color: '#eab308' },
  COMPLETE: { bg: 'rgba(34,197,94,0.12)',  color: '#22c55e' },
  ERROR:    { bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' },
};

// ─── Global CSS ──────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 4px rgba(249,115,22,0.3); }
  50% { box-shadow: 0 0 12px rgba(249,115,22,0.6); }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideInScore {
  from { opacity: 0; transform: translateY(12px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes glow {
  0%, 100% { box-shadow: 0 0 8px rgba(234,179,8,0.3), 0 0 20px rgba(234,179,8,0.1); }
  50% { box-shadow: 0 0 16px rgba(234,179,8,0.5), 0 0 40px rgba(234,179,8,0.2); }
}

@keyframes judgingPulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

@keyframes spinDot {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes progressReveal {
  from { width: 0%; }
}

@keyframes borderGlow {
  0%, 100% { border-color: rgba(249,115,22,0.2); }
  50% { border-color: rgba(249,115,22,0.5); }
}

@keyframes celebrationFlash {
  0% { background: rgba(34,197,94,0.15); }
  50% { background: rgba(34,197,94,0.05); }
  100% { background: rgba(34,197,94,0); }
}

.arena-scrollbar::-webkit-scrollbar { width: 5px; }
.arena-scrollbar::-webkit-scrollbar-track { background: transparent; }
.arena-scrollbar::-webkit-scrollbar-thumb { background: #1e2d45; border-radius: 3px; }
.arena-scrollbar::-webkit-scrollbar-thumb:hover { background: #2d4060; }

.arena-event-row { animation: slideIn 0.2s ease-out; }
.arena-score-card { animation: slideInScore 0.4s ease-out both; }
.arena-winner-card { animation: glow 2s ease-in-out infinite; }
.arena-progress-bar { animation: progressReveal 0.8s ease-out both; }
.arena-running-border { animation: borderGlow 2s ease-in-out infinite; }
.arena-celebration { animation: celebrationFlash 1.5s ease-out; }

.resize-handle {
  flex-shrink: 0;
  height: 5px;
  background: #1e2d45;
  cursor: ns-resize;
  user-select: none;
  transition: background 0.15s;
  position: relative;
}
.resize-handle:hover, .resize-handle.dragging {
  background: rgba(249,115,22,0.5);
}
.resize-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255,255,255,0.12);
}
`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveLabel(teams: Team[], teamId: string, fallback: string): string {
  const t = teams.find((x) => x.id === teamId);
  if (!t) return fallback;
  return t.persona ? `${t.model}:${t.persona}` : t.model;
}

function getModelName(model: string): string {
  return model.split(':')[0].toLowerCase();
}

function getRelativeTime(eventTimestamp: string, competitionStartTime: number | null): string {
  if (!competitionStartTime) return '';
  const eventTime = new Date(eventTimestamp).getTime();
  const diff = Math.max(0, eventTime - competitionStartTime);
  const totalSecs = Math.floor(diff / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`
    : '255,255,255';
}

function ctrlBtn(color: string, bg: string): React.CSSProperties {
  return {
    fontSize: '0.72rem', fontWeight: 700, padding: '0.4rem 1rem',
    background: bg, color, border: `1px solid ${color}`,
    borderRadius: '6px', cursor: 'pointer', letterSpacing: '0.5px', fontFamily: 'inherit',
    transition: 'all 0.15s ease',
  };
}

// ─── Activity spinner ────────────────────────────────────────────────────────

function ActivitySpinner({ color, active }: { color: string; active: boolean }) {
  if (!active) return null;
  return (
    <div style={{
      width: '15px', height: '15px', borderRadius: '50%',
      border: `2px solid rgba(${hexToRgb(color)},0.2)`,
      borderTopColor: color,
      animation: 'spinDot 0.8s linear infinite',
      flexShrink: 0,
    }} />
  );
}

// ─── Model badge ─────────────────────────────────────────────────────────────

function ModelBadge({ model }: { model: string }) {
  const name = getModelName(model);
  const colors = MODEL_BADGE_COLORS[name] ?? {
    bg: 'rgba(136,150,171,0.12)', fg: '#8896ab', border: 'rgba(136,150,171,0.3)',
  };
  return (
    <span style={{
      fontSize: '0.68rem', fontWeight: 800,
      padding: '0.2rem 0.6rem', borderRadius: '4px',
      background: colors.bg, color: colors.fg,
      border: `1px solid ${colors.border}`,
      letterSpacing: '0.8px', textTransform: 'uppercase', flexShrink: 0,
    }}>
      {name}
    </span>
  );
}

// ─── Pulsing status dot ──────────────────────────────────────────────────────

function StatusDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: '9px', height: '9px',
      borderRadius: '50%', background: color, flexShrink: 0,
      boxShadow: pulsing ? `0 0 6px ${color}` : 'none',
      animation: pulsing ? 'pulse 1.5s ease-in-out infinite' : 'none',
    }} />
  );
}

// ─── Lane histogram ───────────────────────────────────────────────────────────

function LaneHistogram({ events }: { events: ArenaEvent[] }) {
  const counts: Record<string, number> = {};
  for (const ev of events) {
    if (ev.type in HIST_COLORS) counts[ev.type] = (counts[ev.type] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  return (
    <div style={{
      display: 'flex', width: '80px', height: '5px', borderRadius: '3px',
      overflow: 'hidden', gap: '1px', background: 'rgba(30,45,69,0.5)',
    }}>
      {Object.entries(HIST_COLORS).map(([t, color]) => {
        const count = counts[t] ?? 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={t}
            title={`${t}: ${count}`}
            style={{ width: `${pct}%`, background: color, minWidth: '2px', borderRadius: '2px' }}
          />
        );
      })}
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({
  event, competitionStartTime,
}: {
  event: ArenaEvent; competitionStartTime: number | null;
}) {
  const info = classifyEvent(event.type, event.payload);
  if (!info) return null;

  const relTime = getRelativeTime(event.timestamp, competitionStartTime);

  return (
    <div className="arena-event-row" style={{
      background: info.bg, borderRadius: '7px',
      padding: '0.5rem 0.75rem', fontSize: '0.78rem', lineHeight: 1.55,
      display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
      transition: 'background 0.15s ease',
    }}>
      {/* Timestamp */}
      <span style={{
        color: '#4a5568', fontSize: '0.68rem', fontFamily: 'monospace',
        flexShrink: 0, width: '2.5rem', textAlign: 'right',
        marginTop: '2px', letterSpacing: '-0.3px',
      }}>
        {relTime}
      </span>
      {/* Icon */}
      <span style={{ flexShrink: 0, fontSize: '0.88rem', lineHeight: 1.4 }}>{info.icon}</span>
      {/* Label badge */}
      <span style={{
        color: info.color, fontWeight: 800, flexShrink: 0, fontSize: '0.62rem',
        letterSpacing: '0.5px',
        background: `rgba(${hexToRgb(info.color)},0.12)`,
        padding: '0.08rem 0.4rem', borderRadius: '4px', marginTop: '2px',
        whiteSpace: 'nowrap',
      }}>
        {info.label}
      </span>
      {/* Summary text */}
      <span style={{
        color: '#c4d4e8', overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', flex: 1, minWidth: 0,
      }}>
        {info.text}
      </span>
    </div>
  );
}

// ─── Lane panel ───────────────────────────────────────────────────────────────

const LanePanel = forwardRef<
  HTMLDivElement,
  {
    team: Team;
    color: string;
    events: ArenaEvent[];
    borderLeft?: boolean;
    isRunning: boolean;
    competitionStartTime: number | null;
  }
>(({ team, color, events, borderLeft, isRunning, competitionStartTime }, ref) => {
  const recentActivity = events.length > 0 &&
    (Date.now() - new Date(events[events.length - 1].timestamp).getTime()) < 5000;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0,
      overflow: 'hidden',
      borderLeft: borderLeft ? '1px solid #1e2d45' : 'none',
      background: '#0a0e17',
    }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem 1.1rem',
        background: 'linear-gradient(180deg, #0f1724 0%, #0d1520 100%)',
        borderBottom: `2px solid ${isRunning ? color : '#1e2d45'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, gap: '0.6rem',
        transition: 'border-color 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0, flex: 1 }}>
          <StatusDot color={color} pulsing={isRunning && recentActivity} />
          <ModelBadge model={team.model} />
          {team.persona && (
            <span style={{
              fontSize: '0.72rem', color: '#8896ab',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontStyle: 'italic',
            }}>
              {team.persona}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexShrink: 0 }}>
          <ActivitySpinner color={color} active={isRunning && recentActivity} />
          <LaneHistogram events={events} />
          <span style={{
            fontSize: '0.70rem', color: '#4a5568', fontWeight: 700,
            fontFamily: 'monospace', background: 'rgba(30,45,69,0.4)',
            padding: '0.12rem 0.5rem', borderRadius: '4px',
          }}>
            {events.length}
          </span>
        </div>
      </div>

      {/* Scroll area */}
      <div
        ref={ref}
        className="arena-scrollbar"
        style={{
          flex: 1, overflowY: 'auto', padding: '0.6rem 0.6rem',
          display: 'flex', flexDirection: 'column', gap: '3px',
        }}
      >
        {events.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: '0.6rem',
          }}>
            {isRunning ? (
              <>
                <ActivitySpinner color={color} active={true} />
                <p style={{ color: '#2d4060', fontSize: '0.78rem', fontStyle: 'italic' }}>
                  Waiting for events...
                </p>
              </>
            ) : (
              <p style={{ color: '#2d4060', fontSize: '0.78rem', fontStyle: 'italic' }}>
                Waiting for competition to start...
              </p>
            )}
          </div>
        )}
        {events.map((ev) => (
          <EventRow key={ev.eventId} event={ev} competitionStartTime={competitionStartTime} />
        ))}
      </div>

      {/* Lane footer: quick stats */}
      {events.length > 0 && (
        <div style={{
          display: 'flex', gap: '0.8rem', padding: '0.4rem 1.1rem',
          borderTop: '1px solid rgba(30,45,69,0.6)',
          background: '#0d1520', flexShrink: 0, flexWrap: 'wrap',
        }}>
          {Object.entries(HIST_COLORS).map(([evType, c]) => {
            const count = events.filter((e) => e.type === evType).length;
            if (count === 0) return null;
            return (
              <span key={evType} style={{
                fontSize: '0.65rem', color: c, fontWeight: 600, letterSpacing: '0.3px',
              }}>
                {evType === 'TOOL_CALL' ? '⚡' : evType === 'FILE_CREATE' ? '📄' : evType === 'FILE_MODIFY' ? '✏️' : evType === 'REASONING' ? '🧠' : '⚠️'} {count}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
});
LanePanel.displayName = 'LanePanel';

// ─── Score drawer ─────────────────────────────────────────────────────────────

const SCORE_DRAWER_COLLAPSED = 52;
const SCORE_DRAWER_EXPANDED = 300;

function ScoreDrawer({
  result,
  teams,
  height,
  onToggle,
}: {
  result: CompetitionResult;
  teams: Team[];
  height: number;
  onToggle: () => void;
}) {
  const [synthOpen, setSynthOpen] = useState(true);
  const isExpanded = height > SCORE_DRAWER_COLLAPSED;

  const winnerLabel = result.winnerId
    ? resolveLabel(teams, result.winnerId, result.winnerId)
    : null;

  const teamDisplays = result.teams.map((tr, i) => ({
    result: tr,
    label: resolveLabel(teams, tr.teamId, `Team ${i + 1}`),
    color: LANE_COLORS[i] ?? '#8896ab',
    isWinner: tr.teamId === result.winnerId,
  }));

  const scoreSummary = teamDisplays
    .map((d) => `${d.label} ${d.result.totalScore.toFixed(1)}`)
    .join('  vs  ');

  return (
    <div className="arena-celebration" style={{
      borderTop: '2px solid rgba(34,197,94,0.4)',
      background: 'rgba(10,14,23,0.98)', flexShrink: 0,
      height: `${height}px`, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'none',
    }}>
      {/* Collapsed strip */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
          padding: '0 1.4rem', height: `${SCORE_DRAWER_COLLAPSED}px`, minHeight: `${SCORE_DRAWER_COLLAPSED}px`,
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          color: '#e2e8f0', textAlign: 'left', flexShrink: 0,
          borderBottom: isExpanded ? '1px solid #1e2d45' : 'none',
        }}
      >
        <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>🏆</span>
        <span style={{
          color: '#eab308', fontSize: '0.82rem', fontWeight: 800,
          letterSpacing: '1px', flexShrink: 0,
        }}>
          {winnerLabel ?? 'DRAW'}
        </span>
        <span style={{
          color: '#4a5568', fontSize: '0.72rem', flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          letterSpacing: '0.3px',
        }}>
          {scoreSummary}
        </span>
        <span style={{
          color: '#8896ab', fontSize: '0.72rem', flexShrink: 0,
          background: 'rgba(30,45,69,0.4)', padding: '0.25rem 0.6rem', borderRadius: '4px',
        }}>
          {isExpanded ? '▲ hide' : '▼ details'}
        </span>
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem 1.5rem' }}>
          {/* Score grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(teamDisplays.length, 4)}, 1fr)`,
            gap: '1rem', maxWidth: '700px', margin: '0 auto',
          }}>
            {teamDisplays.map(({ result: tr, label, color, isWinner }, cardIdx) => (
              <div
                key={tr.teamId}
                className={`arena-score-card ${isWinner ? 'arena-winner-card' : ''}`}
                style={{
                  background: isWinner
                    ? 'linear-gradient(135deg, rgba(234,179,8,0.08) 0%, rgba(234,179,8,0.02) 100%)'
                    : 'linear-gradient(135deg, #111827 0%, #0f1724 100%)',
                  border: `1px solid ${isWinner ? 'rgba(234,179,8,0.4)' : '#1e2d45'}`,
                  borderRadius: '10px', padding: '1rem',
                  animationDelay: `${cardIdx * 0.15}s`,
                }}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginBottom: '0.75rem', paddingBottom: '0.6rem',
                  borderBottom: `1px solid ${isWinner ? 'rgba(234,179,8,0.2)' : '#1e2d45'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                    {isWinner && <span style={{ fontSize: '0.95rem' }}>🏆</span>}
                    <ModelBadge model={label.split(':')[0]} />
                  </div>
                  <span style={{
                    fontSize: '1.4rem', fontWeight: 900,
                    color: isWinner ? '#eab308' : '#e2e8f0',
                    flexShrink: 0, fontFamily: 'monospace',
                  }}>
                    {tr.totalScore.toFixed(1)}
                  </span>
                </div>

                <div style={{
                  fontSize: '0.72rem', fontWeight: 700, color,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  marginBottom: '0.65rem',
                }}>
                  {label}
                </div>

                {tr.criteriaScores.map((cs, csIdx) => {
                  const pct = cs.maxScore > 0 ? (cs.score / cs.maxScore) * 100 : 0;
                  return (
                    <div key={cs.criterionId} style={{ marginBottom: '0.5rem' }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: '0.68rem', marginBottom: '0.22rem',
                      }}>
                        <span style={{ color: '#8896ab', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                          {cs.criterionId}
                        </span>
                        <span style={{ color: isWinner ? '#eab308' : '#e2e8f0', fontWeight: 700, marginLeft: '0.4rem', flexShrink: 0, fontFamily: 'monospace' }}>
                          {cs.score}/{cs.maxScore}
                        </span>
                      </div>
                      <div style={{ height: '4px', background: 'rgba(30,45,69,0.6)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div
                          className="arena-progress-bar"
                          style={{
                            height: '100%', width: `${pct}%`,
                            background: isWinner
                              ? 'linear-gradient(90deg, #eab308, #f59e0b)'
                              : `linear-gradient(90deg, ${color}, ${color}88)`,
                            borderRadius: '2px',
                            animationDelay: `${(cardIdx * 0.15) + (csIdx * 0.1) + 0.3}s`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {result.summary && (
            <p style={{
              fontSize: '0.78rem', color: '#8896ab', textAlign: 'center',
              fontFamily: "-apple-system, 'Segoe UI', sans-serif",
              lineHeight: 1.7, maxWidth: '600px', margin: '1rem auto 0',
            }}>
              {result.summary}
            </p>
          )}

          {result.synthesis && (
            <div style={{
              marginTop: '1.25rem', border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '10px', overflow: 'hidden',
              maxWidth: '700px', marginLeft: 'auto', marginRight: 'auto',
            }}>
              <button
                onClick={() => setSynthOpen((o) => !o)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                  background: 'rgba(168,85,247,0.07)', padding: '0.75rem 1rem',
                  borderBottom: synthOpen ? '1px solid rgba(168,85,247,0.18)' : 'none',
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  color: 'inherit', textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#a855f7', letterSpacing: '2px', textTransform: 'uppercase' }}>
                  ✨ Synthesis
                </span>
                <span style={{ fontSize: '0.72rem', color: '#8896ab', fontFamily: "-apple-system, 'Segoe UI', sans-serif", flex: 1 }}>
                  Best elements from both teams, merged by synthesis agent
                </span>
                <span style={{ fontSize: '0.72rem', color: '#8896ab', flexShrink: 0 }}>
                  {synthOpen ? '▲' : '▼'}
                </span>
              </button>
              {synthOpen && (
                <div className="arena-scrollbar" style={{ padding: '1rem 1.25rem', background: '#0d1520', maxHeight: '260px', overflowY: 'auto' }}>
                  <pre style={{ fontSize: '0.80rem', color: '#c4d4e8', whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.7, margin: 0 }}>
                    {result.synthesis}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── State banner ─────────────────────────────────────────────────────────────

function StateBanner({ state }: { state: CompetitionState }) {
  if (state === 'JUDGING') {
    return (
      <div style={{
        background: 'linear-gradient(90deg, rgba(234,179,8,0.08) 0%, rgba(234,179,8,0.15) 50%, rgba(234,179,8,0.08) 100%)',
        borderBottom: '1px solid rgba(234,179,8,0.3)',
        padding: '0.55rem 1.4rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.7rem',
        animation: 'judgingPulse 2s ease-in-out infinite',
      }}>
        <span style={{ fontSize: '1rem' }}>⚖️</span>
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#eab308', letterSpacing: '2px' }}>
          JUDGING IN PROGRESS
        </span>
        <span style={{ fontSize: '0.70rem', color: '#8896ab', fontStyle: 'italic' }}>
          AI judge is evaluating both submissions...
        </span>
      </div>
    );
  }
  return null;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPage() {
  const params = useParams();
  const id = params.id as string;

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [briefTitle, setBriefTitle] = useState('');
  const [teamEvents, setTeamEvents] = useState<Map<string, ArenaEvent[]>>(new Map());
  const [broadcastEvents, setBroadcastEvents] = useState<ArenaEvent[]>([]);
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [competitionStartTime, setCompetitionStartTime] = useState<number | null>(null);

  // Resizable score drawer
  const [scoreDrawerHeight, setScoreDrawerHeight] = useState(SCORE_DRAWER_COLLAPSED);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const [isDraggingActive, setIsDraggingActive] = useState(false);

  const handleResizeStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = scoreDrawerHeight;
    setIsDraggingActive(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartY.current - e.clientY; // dragging up = bigger drawer
      const newH = Math.max(SCORE_DRAWER_COLLAPSED, Math.min(600, dragStartHeight.current + delta));
      setScoreDrawerHeight(newH);
    };
    const handleUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsDraggingActive(false);
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // One ref per lane
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Fetch competition metadata
  useEffect(() => {
    if (!id) return;
    fetch(`/api/competitions/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { teams?: Team[]; brief?: { title?: string }; startedAt?: string } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief?.title) setBriefTitle(data.brief.title);
        if (data.startedAt) setCompetitionStartTime(new Date(data.startedAt).getTime());
      })
      .catch(() => { /* non-critical */ });
  }, [id]);

  // Elapsed timer
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    return () => clearInterval(iv);
  }, [startTime]);

  // Auto-scroll lanes
  useEffect(() => {
    for (const el of laneRefs.current) {
      if (!el) continue;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [teamEvents, broadcastEvents]);

  // WebSocket
  useEffect(() => {
    if (!id) return;
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000';
    let ws: WebSocket;
    let lastSeq = 0;
    let retries = 0;
    let intentionalClose = false;
    const MAX_RETRIES = 5;

    function pushEvent(teamId: string, ev: ArenaEvent) {
      if (!teamId || teamId === '') {
        setBroadcastEvents((prev) => {
          const n = [...prev, ev];
          return n.length > 500 ? n.slice(-500) : n;
        });
        return;
      }
      setTeamEvents((prev) => {
        const next = new Map(prev);
        const existing = next.get(teamId) ?? [];
        const updated = [...existing, ev];
        next.set(teamId, updated.length > 500 ? updated.slice(-500) : updated);
        return next;
      });
    }

    function connect() {
      ws = new WebSocket(`${wsUrl}/competitions/${id}/stream`);
      ws.onopen = () => {
        setConnected(true);
        setSseError(null);
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
            if (ev.state === 'RUNNING') setState('RUNNING');
            else if (ev.state === 'JUDGING') setState('JUDGING');
            return;
          }
          if (ev.type === 'COMPETITION_START') {
            setState('RUNNING');
            setCompetitionStartTime(new Date(ev.timestamp).getTime());
            return;
          }
          if (ev.type === 'JUDGE_SCORE') setState('JUDGING');
          if (ev.type === 'COMPETITION_COMPLETE' || ev.type === 'COMPLETE') {
            setState('COMPLETE');
            if (ev.result) {
              setResult(ev.result);
              setScoreDrawerHeight(SCORE_DRAWER_EXPANDED);
            }
            intentionalClose = true;
            ws.close();
            return;
          }

          pushEvent(ev.teamId ?? '', ev);
        } catch { /* ignore parse errors */ }
      };
      ws.onerror = () => { setSseError('WebSocket error'); setConnected(false); };
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

  const sendControl = async (action: 'cancel' | 'pause' | 'resume') => {
    const res = await fetch(`/api/competitions/${id}?action=${action}`, { method: 'POST' });
    if (!res.ok) return;
    if (action === 'pause') setIsPaused(true);
    if (action === 'resume') setIsPaused(false);
    if (action === 'cancel') setState('COMPLETE');
  };

  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : Array.from(teamEvents.keys()).map((tid) => ({ id: tid, model: tid }));

  const numTeams = Math.max(orderedTeams.length, 1);
  const stateBadge = STATE_BADGE[state] ?? STATE_BADGE.PENDING;
  const isRunning = state === 'RUNNING';
  const isComplete = state === 'COMPLETE';

  const totalEvents = Array.from(teamEvents.values()).reduce(
    (sum, evs) => sum + evs.length, 0,
  ) + broadcastEvents.length;

  return (
    <>
      <style>{GLOBAL_STYLES}</style>
      <div
        className={isRunning ? 'arena-running-border' : ''}
        style={{
          display: 'flex', flexDirection: 'column',
          height: '100vh', overflow: 'hidden',
          background: '#0a0e17',
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          color: '#e2e8f0',
          border: isRunning ? '1px solid rgba(249,115,22,0.2)' : '1px solid transparent',
          transition: 'border-color 0.5s ease',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          padding: '0.7rem 1.4rem', borderBottom: '1px solid #1e2d45',
          background: 'linear-gradient(180deg, rgba(15,23,36,0.98) 0%, rgba(10,14,23,0.98) 100%)',
          flexShrink: 0,
        }}>
          <a href="/" style={{
            fontSize: '0.75rem', color: '#f97316', fontWeight: 800,
            letterSpacing: '2.5px', textDecoration: 'none', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <span style={{ fontSize: '0.9rem' }}>🎮</span>
            ARENA
          </a>

          <span style={{ color: '#1e2d45', fontSize: '1.1rem' }}>│</span>

          <div style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
            gap: '0.8rem', flexWrap: 'wrap',
          }}>
            {briefTitle && (
              <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#e2e8f0' }}>
                {briefTitle}
              </span>
            )}
            <span style={{
              fontSize: '0.65rem', fontWeight: 800, padding: '0.18rem 0.6rem',
              borderRadius: '4px', letterSpacing: '1.5px',
              background: stateBadge.bg, color: stateBadge.color,
              border: `1px solid ${stateBadge.color}33`,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
            }}>
              {isRunning && <StatusDot color={stateBadge.color} pulsing={true} />}
              {isComplete && <span>✅</span>}
              {state}
            </span>

            {!connected && !result && (
              <span style={{ fontSize: '0.70rem', color: '#eab308', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <StatusDot color="#eab308" pulsing={true} />
                connecting...
              </span>
            )}
            {connected && isRunning && (
              <span style={{ fontSize: '0.65rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <StatusDot color="#22c55e" pulsing={false} />
                live
              </span>
            )}
            {sseError && (
              <span style={{ fontSize: '0.70rem', color: '#ef4444' }}>{sseError}</span>
            )}
            {totalEvents > 0 && (
              <span style={{
                fontSize: '0.65rem', color: '#4a5568',
                background: 'rgba(30,45,69,0.4)',
                padding: '0.12rem 0.5rem', borderRadius: '3px', fontFamily: 'monospace',
              }}>
                {totalEvents} events
              </span>
            )}
          </div>

          {state === 'RUNNING' && (
            <div style={{ display: 'flex', gap: '0.45rem' }}>
              {!isPaused
                ? <button onClick={() => sendControl('pause')} style={ctrlBtn('#eab308', 'rgba(234,179,8,0.1)')}>PAUSE</button>
                : <button onClick={() => sendControl('resume')} style={ctrlBtn('#22c55e', 'rgba(34,197,94,0.1)')}>RESUME</button>
              }
              <button onClick={() => sendControl('cancel')} style={ctrlBtn('#ef4444', 'rgba(239,68,68,0.1)')}>CANCEL</button>
            </div>
          )}

          <a href={`/competitions/${id}/replay`} style={{
            fontSize: '0.70rem', color: '#8896ab', textDecoration: 'none',
            border: '1px solid #1e2d45', borderRadius: '6px',
            padding: '0.35rem 0.75rem', flexShrink: 0,
            letterSpacing: '0.5px', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            transition: 'all 0.15s ease',
          }}>
            ▶ REPLAY
          </a>

          <div style={{
            fontFamily: 'monospace',
            color: isRunning ? '#f97316' : '#8896ab',
            fontSize: '0.95rem', fontWeight: 800,
            flexShrink: 0, minWidth: '4rem', textAlign: 'right',
            letterSpacing: '0.5px', transition: 'color 0.3s ease',
          }}>
            {formatElapsed(elapsed)}
          </div>
        </header>

        {/* ── State banner ─────────────────────────────────────────────────── */}
        <StateBanner state={state} />

        {/* ── Lanes ────────────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${numTeams}, 1fr)`,
          overflow: 'hidden', flex: 1, minHeight: 0,
        }}>
          {orderedTeams.map((team, i) => {
            const events = [
              ...(teamEvents.get(team.id) ?? []),
              ...broadcastEvents,
            ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            const color = LANE_COLORS[i] ?? '#8896ab';

            return (
              <LanePanel
                key={team.id}
                ref={(el) => { laneRefs.current[i] = el; }}
                team={team}
                color={color}
                events={events}
                borderLeft={i > 0}
                isRunning={isRunning}
                competitionStartTime={competitionStartTime}
              />
            );
          })}

          {orderedTeams.length === 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: '#2d4060', fontSize: '0.82rem', gap: '0.75rem',
            }}>
              <ActivitySpinner color="#3b82f6" active={true} />
              <span>Waiting for competition data...</span>
            </div>
          )}
        </div>

        {/* ── Resize handle (only visible when there are results) ──────────── */}
        {result && (
          <div
            className={`resize-handle${isDraggingActive ? ' dragging' : ''}`}
            onMouseDown={handleResizeStart}
            title="Drag to resize"
          />
        )}

        {/* ── Score drawer ─────────────────────────────────────────────────── */}
        {result && (
          <ScoreDrawer
            result={result}
            teams={orderedTeams}
            height={scoreDrawerHeight}
            onToggle={() => setScoreDrawerHeight((h) =>
              h > SCORE_DRAWER_COLLAPSED ? SCORE_DRAWER_COLLAPSED : SCORE_DRAWER_EXPANDED
            )}
          />
        )}
      </div>
    </>
  );
}
