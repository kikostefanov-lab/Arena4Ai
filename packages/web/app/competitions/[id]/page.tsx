'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatElapsed, resolveTeamLabel } from '../../../lib/format';
import { MODEL_BADGE_COLORS as TOKEN_BADGE_COLORS, LANE_COLORS, getModelColor, getStateStyle, hexToRgb } from '../../../lib/design-tokens';
import { briefToYaml, downloadYaml } from '../../../lib/brief-yaml';
import { EventRow, classifyEvent } from '../../../lib/EventRow';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Team { id: string; model: string; persona?: string; }

interface RubricCriterion { id: string; description: string; maxScore: number; weight: number; }
interface Brief {
  id?: string; title: string; format?: string; problem: string;
  timeLimitMs?: number; constraints?: string[]; deliverables?: string[];
  rubric?: { criteria: RubricCriterion[] };
}

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
interface TeamDeliverable { teamId: string; files: { path: string; content: string }[]; }
interface SynthesisPerCriterion { criterionId: string; teamId: string; rationale: string; winningApproach?: string; losingApproach?: string; }
interface SynthesisResult { synthesis: string; overallRationale?: string; perCriterion: SynthesisPerCriterion[]; }
interface CriterionFinding { criterionId: string; finding: string; strength: string; gap: string; }
interface TeamPresentation { teamId: string; model: string; approach: string; criterionFindings: CriterionFinding[]; keyInsight: string; deliverableSummary: string; }
interface ForgeArtifact { type: string; title: string; content: string; generatedAt: string; }
interface ForgeOutput { forgeModel: string; artifacts: ForgeArtifact[]; generatedAt: string; }
interface CompetitionResult { winnerId: string | null; teams: TeamResult[]; summary?: string; synthesis?: SynthesisResult | null; deliverables?: TeamDeliverable[]; presentations?: TeamPresentation[]; forge?: ForgeOutput | null; }

type CompetitionState = 'PENDING' | 'RUNNING' | 'COLLECTING' | 'PRESENTING' | 'JUDGING' | 'SYNTHESIZING' | 'COMPLETE' | 'FORGING' | 'FORGE_COMPLETE' | 'ERROR' | 'FAILED' | 'CANCELLED';

// ─── Constants ────────────────────────────────────────────────────────────────

const HIST_COLORS: Record<string, string> = {
  TOOL_CALL:   '#3b82f6',
  FILE_CREATE: '#22c55e',
  FILE_MODIFY: '#10b981',
  REASONING:   '#06b6d4',
  ERROR:       '#ef4444',
};

// LANE_COLORS imported from design-tokens above

const MODEL_BADGE_COLORS = TOKEN_BADGE_COLORS;

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

@keyframes scanline {
  0% { background-position: 0 0; }
  100% { background-position: 0 40px; }
}

@keyframes msgFade {
  0%, 85% { opacity: 1; }
  95%, 100% { opacity: 0; }
}

@keyframes launchFlash {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  75%  { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes launchText {
  0%   { opacity: 0; transform: translateY(16px) scale(0.85); }
  15%  { opacity: 1; transform: translateY(0)    scale(1); }
  75%  { opacity: 1; transform: translateY(0)    scale(1); }
  100% { opacity: 0; transform: translateY(-12px) scale(1.1); }
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

const resolveLabel = resolveTeamLabel;

function getModelName(model: string): string {
  return model.split(':')[0].toLowerCase();
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
      fontSize: '0.82rem', fontWeight: 900,
      padding: '0.25rem 0.7rem', borderRadius: '5px',
      background: colors.bg, color: colors.fg,
      border: `1px solid ${colors.border}`,
      letterSpacing: '1px', textTransform: 'uppercase', flexShrink: 0,
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

// ─── Pre-battle screen ───────────────────────────────────────────────────────

const INIT_MESSAGES = [
  'Spinning up environment...',
  'Reading the brief...',
  'Loading toolkit...',
  'Allocating compute...',
  'Preparing workspace...',
  'Calibrating strategy...',
  'Reviewing objectives...',
  'Sharpening the approach...',
  'Loading battle systems...',
  'Standing by for launch...',
];

function PreBattleScreen({ color, model, persona }: { color: string; model: string; persona?: string }) {
  const [msgIdx, setMsgIdx] = useState(0);
  const [progress, setProgress] = useState(8);
  const displayName = persona ? `${model}:${persona}` : model;

  useEffect(() => {
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % INIT_MESSAGES.length), 1600);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setProgress((p) => Math.min(88, p + Math.random() * 3.5 + 0.5)), 900);
    return () => clearInterval(t);
  }, []);

  const rgb = hexToRgb(color);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem', gap: '2rem', position: 'relative', overflow: 'hidden',
    }}>
      {/* Radial bg glow */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 70% 55% at 50% 50%, rgba(${rgb},0.10) 0%, transparent 70%)`,
      }} />
      {/* Scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(${rgb},0.02) 3px, rgba(${rgb},0.02) 4px)`,
        animation: 'scanline 5s linear infinite',
      }} />

      {/* Swords */}
      <div style={{ fontSize: '3.5rem', filter: `drop-shadow(0 0 22px ${color})`, animation: 'pulse 2s ease-in-out infinite', zIndex: 1 }}>
        ⚔️
      </div>

      {/* Team name */}
      <div style={{ textAlign: 'center', zIndex: 1 }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 900, color, letterSpacing: '4px', textTransform: 'uppercase', marginBottom: '0.5rem', textShadow: `0 0 20px ${color}80` }}>
          {displayName}
        </div>
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#8896ab', letterSpacing: '3px', animation: 'pulse 2s ease-in-out infinite' }}>
          BATTLE STATION INITIALIZING
        </div>
      </div>

      {/* Progress */}
      <div style={{ width: '78%', maxWidth: '320px', zIndex: 1 }}>
        <div style={{ height: '6px', background: 'rgba(30,45,69,0.8)', borderRadius: '3px', overflow: 'hidden', marginBottom: '0.65rem' }}>
          <div style={{
            height: '100%', width: `${progress}%`, borderRadius: '3px',
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 10px ${color}80`,
            transition: 'width 0.9s ease-out',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#8896ab', animation: 'msgFade 1.6s ease-in-out infinite' }}>
            {INIT_MESSAGES[msgIdx]}
          </span>
          <span style={{ fontSize: '0.82rem', color, fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>
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
    isPaused: boolean;
    competitionStartTime: number | null;
    teamIndex: number;
    /** Accurate event type counts (not affected by display buffer trimming). */
    eventCounts?: Record<string, number>;
  }
>(({ team, color, events, borderLeft, isRunning, isPaused, competitionStartTime, teamIndex, eventCounts }, ref) => {
  const hasRenderable = events.some((e) => classifyEvent(e.type, e.payload) !== null);
  const recentActivity = events.length > 0 &&
    (Date.now() - new Date(events[events.length - 1].timestamp).getTime()) < 5000;

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  // Flash "BATTLE COMMENCED" when first renderable event arrives
  const [showLaunch, setShowLaunch] = useState(false);
  const wasRenderable = useRef(false);
  useEffect(() => {
    if (hasRenderable && !wasRenderable.current) {
      wasRenderable.current = true;
      setShowLaunch(true);
      const t = setTimeout(() => setShowLaunch(false), 2400);
      return () => clearTimeout(t);
    }
  }, [hasRenderable]);

  const rgb = hexToRgb(color);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', minWidth: 0,
      overflow: 'hidden', position: 'relative',
      borderLeft: borderLeft ? '1px solid #1e2d45' : 'none',
      background: '#0a0e17',
    }}>
      {/* Header */}
      <div style={{
        padding: '0.85rem 1.2rem',
        background: 'linear-gradient(180deg, #0f1724 0%, #0d1520 100%)',
        borderBottom: `3px solid ${isRunning ? color : '#1e2d45'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, gap: '0.7rem',
        transition: 'border-color 0.3s ease',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, flex: 1 }}>
          <StatusDot color={color} pulsing={isRunning && recentActivity} />
          <span style={{
            fontSize: '0.58rem', fontWeight: 900,
            color: color,
            background: `rgba(${hexToRgb(color)}, 0.12)`,
            border: `1px solid ${color}`,
            borderRadius: '3px',
            padding: '0.1rem 0.35rem',
            letterSpacing: '1px',
            flexShrink: 0,
          }}>
            {teamIndex === 0 ? 'A' : 'B'}
          </span>
          <ModelBadge model={team.model} />
          {team.persona && (
            <span style={{
              fontSize: '0.90rem', color, fontWeight: 700,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              letterSpacing: '0.5px',
            }}>
              :{team.persona}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexShrink: 0 }}>
          <ActivitySpinner color={color} active={isRunning && recentActivity} />
          <LaneHistogram events={events} />
          <span style={{
            fontSize: '0.78rem', color: '#4a5568', fontWeight: 700,
            fontFamily: 'monospace', background: 'rgba(30,45,69,0.4)',
            padding: '0.15rem 0.55rem', borderRadius: '4px',
          }}>
            {eventCounts ? Object.values(eventCounts).reduce((a, b) => a + b, 0) : events.length}
          </span>
        </div>
      </div>

      {/* Scroll area */}
      <div
        ref={ref}
        className="arena-scrollbar"
        style={{
          flex: 1, overflowY: 'auto',
          padding: hasRenderable ? '0.6rem 0.6rem' : '0',
          display: 'flex', flexDirection: 'column', gap: hasRenderable ? '3px' : '0',
        }}
      >
        {!hasRenderable && (isRunning || competitionStartTime !== null) && (
          <PreBattleScreen color={color} model={team.model} persona={team.persona} />
        )}
        {!hasRenderable && !isRunning && competitionStartTime === null && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: '0.5rem',
          }}>
            <p style={{ color: '#2d4060', fontSize: '0.88rem', fontStyle: 'italic' }}>
              Waiting for competition to start...
            </p>
          </div>
        )}
        {events.map((ev) => (
          <EventRow
            key={ev.eventId}
            event={ev}
            startTs={competitionStartTime ? new Date(competitionStartTime).toISOString() : null}
            expanded={expandedEventId === ev.eventId}
            onToggle={() => setExpandedEventId(prev => prev === ev.eventId ? null : ev.eventId)}
          />
        ))}
      </div>

      {/* Lane footer: quick stats */}
      {hasRenderable && (
        <div style={{
          display: 'flex', gap: '0.9rem', padding: '0.45rem 1.2rem',
          borderTop: '1px solid rgba(30,45,69,0.6)',
          background: '#0d1520', flexShrink: 0, flexWrap: 'wrap',
        }}>
          {Object.entries(HIST_COLORS).map(([evType, c]) => {
            const count = eventCounts ? (eventCounts[evType] ?? 0) : events.filter((e) => e.type === evType).length;
            if (count === 0) return null;
            return (
              <span key={evType} style={{ fontSize: '0.72rem', color: c, fontWeight: 600, letterSpacing: '0.3px' }}>
                {evType === 'TOOL_CALL' ? '⚡' : evType === 'FILE_CREATE' ? '📄' : evType === 'FILE_MODIFY' ? '✏️' : evType === 'REASONING' ? '🧠' : '⚠️'} {count}
              </span>
            );
          })}
        </div>
      )}

      {/* Pause overlay */}
      {isPaused && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 15, pointerEvents: 'none',
          background: 'rgba(10,14,23,0.65)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
          backdropFilter: 'blur(2px)',
        }}>
          <span style={{ fontSize: '2.5rem', opacity: 0.8 }}>⏸</span>
          <span style={{
            fontSize: '0.78rem', fontWeight: 900, color: '#3b82f6',
            letterSpacing: '4px', textTransform: 'uppercase',
          }}>
            PAUSED
          </span>
        </div>
      )}

      {/* BATTLE COMMENCED flash overlay */}
      {showLaunch && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: `radial-gradient(ellipse 65% 45% at 50% 45%, rgba(${rgb},0.28) 0%, transparent 70%)`,
          animation: 'launchFlash 2.4s ease-out forwards',
          zIndex: 20, gap: '0.8rem',
        }}>
          <div style={{ fontSize: '3rem', animation: 'launchText 2.4s ease-out forwards', filter: `drop-shadow(0 0 24px ${color})` }}>
            ⚔️
          </div>
          <div style={{
            color, fontWeight: 900, fontSize: '1.2rem', letterSpacing: '4px',
            animation: 'launchText 2.4s ease-out forwards',
            textShadow: `0 0 30px ${color}`,
          }}>
            BATTLE COMMENCED!
          </div>
        </div>
      )}
    </div>
  );
});
LanePanel.displayName = 'LanePanel';

// ─── Score drawer ─────────────────────────────────────────────────────────────

const SCORE_DRAWER_COLLAPSED = 52;
const SCORE_DRAWER_EXPANDED = 300;

function renderMarkdown(text: string): React.ReactNode {
  // Strip HTML comments
  const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
  const lines = stripped.split('\n');
  const nodes: React.ReactNode[] = [];
  let listItems: string[] = [];
  let numberedItems: string[] = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length > 0) {
      nodes.push(
        <ul key={`ul-${key}`} style={{ margin: '0.3rem 0 0.6rem 1.4rem', padding: 0 }}>
          {listItems.map((item, i) => (
            <li key={i} style={{ marginBottom: '0.2rem', color: '#c4d4e8' }}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
    if (numberedItems.length > 0) {
      nodes.push(
        <ol key={`ol-${key}`} style={{ margin: '0.3rem 0 0.6rem 1.4rem', padding: 0 }}>
          {numberedItems.map((item, i) => (
            <li key={i} style={{ marginBottom: '0.2rem', color: '#c4d4e8' }}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      numberedItems = [];
    }
  };

  const flushCode = (key: string) => {
    if (codeLines.length > 0) {
      nodes.push(
        <div key={`code-${key}`} style={{ margin: '0.6rem 0', borderRadius: '6px', overflow: 'hidden', border: '1px solid #1e2d45' }}>
          {codeLang && (
            <div style={{ background: '#0a1628', padding: '0.2rem 0.7rem', fontSize: '0.55rem', color: '#4a6080', fontFamily: 'monospace', letterSpacing: '0.05em', borderBottom: '1px solid #1e2d45' }}>
              {codeLang}
            </div>
          )}
          <pre style={{ margin: 0, padding: '0.75rem', background: '#060e1a', overflowX: 'auto', fontSize: '0.7rem', lineHeight: 1.55, color: '#a8d8a8', fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace" }}>
            <code>{codeLines.join('\n')}</code>
          </pre>
        </div>
      );
      codeLines = [];
      codeLang = '';
    }
  };

  const renderInline = (s: string): React.ReactNode => {
    // Handle **bold** and `code`
    const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} style={{ color: '#e2e8f0' }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: '#0a1628', color: '#7dd3a8', padding: '0.1rem 0.3rem', borderRadius: '3px', border: '1px solid #1e2d45' }}>{part.slice(1, -1)}</code>;
      return part;
    });
  };

  lines.forEach((line, idx) => {
    // Code fence toggle
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        flushList(`pre-${idx}`);
        inCodeBlock = true;
        codeLang = fenceMatch[1] || '';
      } else {
        inCodeBlock = false;
        flushCode(`${idx}`);
      }
      return;
    }
    if (inCodeBlock) { codeLines.push(line); return; }

    const h1Match = line.match(/^#\s+(.+)/);
    const h2Match = line.match(/^##\s+(.+)/);
    const h3Match = line.match(/^###\s+(.+)/);
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);

    if (h1Match) {
      flushList(`list-${idx}`);
      nodes.push(<h2 key={idx} style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f97316', margin: '1.2rem 0 0.5rem', letterSpacing: '0.5px' }}>{h1Match[1]}</h2>);
    } else if (h2Match) {
      flushList(`list-${idx}`);
      nodes.push(<h3 key={idx} style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: '1px', textTransform: 'uppercase', margin: '1rem 0 0.35rem', borderBottom: '1px solid #1e2d45', paddingBottom: '0.3rem' }}>{h2Match[1]}</h3>);
    } else if (h3Match) {
      flushList(`list-${idx}`);
      nodes.push(<h4 key={idx} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a0b4cc', margin: '0.8rem 0 0.25rem' }}>{h3Match[1]}</h4>);
    } else if (ulMatch) {
      numberedItems.length && flushList(`flush-${idx}`);
      listItems.push(ulMatch[1]);
    } else if (olMatch) {
      listItems.length && flushList(`flush-${idx}`);
      numberedItems.push(olMatch[1]);
    } else if (line.trim() === '') {
      flushList(`list-${idx}`);
    } else {
      flushList(`list-${idx}`);
      const trimmed = line.trim();
      if (trimmed) nodes.push(<p key={idx} style={{ margin: '0.2rem 0', color: '#c4d4e8', lineHeight: 1.65 }}>{renderInline(trimmed)}</p>);
    }
  });
  flushList('list-end');
  if (inCodeBlock) flushCode('eof');

  return nodes;
}

interface FileEventFile {
  path: string;
  content: string;
}

interface TeamFileEvents {
  teamId: string;
  files: FileEventFile[];
}

function ScoreDrawer({
  competitionId,
  result,
  teams,
  height,
  onToggle,
  fileEventsByTeam,
  onForgeComplete,
}: {
  competitionId: string;
  result: CompetitionResult;
  teams: Team[];
  height: number;
  onToggle: () => void;
  fileEventsByTeam?: TeamFileEvents[];
  onForgeComplete?: (forge: ForgeOutput) => void;
}) {
  const [activeTab, setActiveTab] = useState<'scores' | 'presentations' | 'files' | 'synthesis' | 'forge'>(
    result.forge ? 'forge' : 'scores'
  );
  const [activeFileIdx, setActiveFileIdx] = useState<Record<string, number>>({});
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
    .map((d) => `${d.label} ${Math.round(d.result.totalScore * 100)}%`)
    .join('  vs  ');

  const totalFileCount = (result.deliverables ?? []).reduce((sum, td) => sum + td.files.length, 0);
  const hasFiles = (result.deliverables ?? []).length > 0;
  const renderedSynthesis = useMemo(
    () => renderMarkdown(result.synthesis?.synthesis ?? ''),
    [result.synthesis?.synthesis],
  );

  const hasPresentations = (result.presentations ?? []).length > 0;

  const hasForge = result.forge != null;
  const [forging, setForging] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeProgress, setForgeProgress] = useState<Record<string, string> | null>(null);
  const forgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (forgePollRef.current) clearInterval(forgePollRef.current); }, []);

  const tabStyle = (tab: 'scores' | 'presentations' | 'files' | 'synthesis' | 'forge'): React.CSSProperties => ({
    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '0.65rem 1rem',
    color: activeTab === tab ? '#e2e8f0' : '#4a5568',
    background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: activeTab === tab ? '2px solid #f97316' : '2px solid transparent',
    transition: 'all 0.15s', fontFamily: 'inherit',
  });

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
        <>
          {/* Tab strip */}
          <div style={{
            background: '#0a0e17',
            borderBottom: '1px solid #1e2d45',
            padding: '0 1.25rem',
            display: 'flex', gap: 0,
            flexShrink: 0,
          }}>
            <button style={tabStyle('scores')} onClick={() => setActiveTab('scores')}>SCORES</button>
            {hasPresentations && (
              <button style={tabStyle('presentations')} onClick={() => setActiveTab('presentations')}>PRESENTATIONS</button>
            )}
            <button style={tabStyle('files')} onClick={() => setActiveTab('files')}>
              FILES{totalFileCount > 0 ? ` (${totalFileCount})` : ''}
            </button>
            <button style={tabStyle('synthesis')} onClick={() => setActiveTab('synthesis')}>SYNTHESIS</button>
            <button style={tabStyle('forge')} onClick={() => setActiveTab('forge')}>
              FORGE{hasForge ? ' ✓' : ''}
            </button>
          </div>

          {/* Tab content */}
          <div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem 1.5rem' }}>

            {/* SCORES TAB */}
            {activeTab === 'scores' && (
              <>
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
                          {Math.round(tr.totalScore * 100)}%
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
                        const maxScore = cs.maxScore ?? 10;
                        const pct = maxScore > 0 ? (cs.score / maxScore) * 100 : 0;
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
                                {Math.round((cs.score / maxScore) * 100)}%
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
                            {cs.commentary && (
                              <div style={{ fontSize: '0.62rem', color: '#4a5568', fontStyle: 'italic', marginTop: '0.18rem', lineHeight: 1.4 }}>
                                {cs.commentary}
                              </div>
                            )}
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
              </>
            )}

            {/* PRESENTATIONS TAB — human-readable summaries of each team's work */}
            {activeTab === 'presentations' && hasPresentations && (
              <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                {/* Header */}
                <div style={{ marginBottom: '1.2rem', padding: '0.8rem 1rem', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>🎤</span>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#3b82f6', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Team Presentations</div>
                    <div style={{ fontSize: '0.65rem', color: '#8896ab', marginTop: '0.1rem' }}>Human-readable summary of what each team built, mapped to the judging criteria</div>
                  </div>
                </div>

                {result.presentations!.map((pres, presIdx) => {
                  const label = resolveLabel(teams, pres.teamId, pres.teamId);
                  const color = LANE_COLORS[presIdx] ?? '#8896ab';
                  const rgb = hexToRgb(color);
                  const isWinner = pres.teamId === result.winnerId;

                  return (
                    <div key={pres.teamId} style={{
                      marginBottom: '1.25rem',
                      border: `1px solid ${isWinner ? 'rgba(234,179,8,0.4)' : `rgba(${rgb},0.2)`}`,
                      borderRadius: '10px', overflow: 'hidden',
                      background: isWinner
                        ? 'linear-gradient(135deg, rgba(234,179,8,0.04) 0%, rgba(234,179,8,0.01) 100%)'
                        : '#0a1628',
                    }}>
                      {/* Team header */}
                      <div style={{
                        padding: '0.7rem 1rem',
                        background: isWinner ? 'rgba(234,179,8,0.08)' : `rgba(${rgb},0.08)`,
                        borderBottom: `1px solid ${isWinner ? 'rgba(234,179,8,0.2)' : `rgba(${rgb},0.15)`}`,
                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                      }}>
                        {isWinner && <span style={{ fontSize: '0.9rem' }}>🏆</span>}
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: isWinner ? '#eab308' : color, letterSpacing: '1px', textTransform: 'uppercase' }}>
                          {label}
                        </span>
                        <span style={{ fontSize: '0.65rem', color: '#4a5568', fontStyle: 'italic' }}>
                          ({pres.model})
                        </span>
                      </div>

                      <div style={{ padding: '1rem 1.1rem' }}>
                        {/* Approach */}
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Approach</div>
                          <div style={{ fontSize: '0.78rem', color: '#c4d4e8', lineHeight: 1.7 }}>{pres.approach}</div>
                        </div>

                        {/* Key insight */}
                        <div style={{
                          marginBottom: '1rem', padding: '0.65rem 0.85rem',
                          background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)',
                          borderRadius: '6px',
                        }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#f97316', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Key Insight</div>
                          <div style={{ fontSize: '0.75rem', color: '#e2e8f0', lineHeight: 1.6 }}>{pres.keyInsight}</div>
                        </div>

                        {/* Criterion findings */}
                        {pres.criterionFindings.length > 0 && (
                          <div style={{ marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                              Criteria Assessment
                            </div>
                            {pres.criterionFindings.map((cf, cfIdx) => (
                              <div key={cf.criterionId} style={{
                                padding: '0.6rem 0.75rem',
                                borderBottom: cfIdx < pres.criterionFindings.length - 1 ? '1px solid rgba(30,45,69,0.6)' : 'none',
                              }}>
                                <code style={{
                                  fontSize: '0.62rem', color: '#4a6080', background: '#060e1a',
                                  padding: '0.12rem 0.4rem', borderRadius: '3px', border: '1px solid #1e2d45',
                                }}>{cf.criterionId}</code>
                                <div style={{ fontSize: '0.75rem', color: '#c4d4e8', lineHeight: 1.6, marginTop: '0.35rem' }}>
                                  {cf.finding}
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.3rem', fontSize: '0.68rem' }}>
                                  {cf.strength && (
                                    <span style={{ color: '#22c55e' }}>
                                      <span style={{ fontWeight: 700 }}>+</span> {cf.strength}
                                    </span>
                                  )}
                                  {cf.gap && (
                                    <span style={{ color: '#ef4444' }}>
                                      <span style={{ fontWeight: 700 }}>-</span> {cf.gap}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Deliverable summary */}
                        <div>
                          <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>What Was Delivered</div>
                          <div style={{ fontSize: '0.72rem', color: '#8896ab', lineHeight: 1.6 }}>{pres.deliverableSummary}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* FILES TAB — shows deliverable files (from result) when available, falls back to event-file captures */}
            {activeTab === 'files' && hasFiles && (
              <div style={{ maxWidth: '700px', margin: '0 auto' }}>
                {result.deliverables!.map((td, tdIdx) => {
                  const label = resolveLabel(teams, td.teamId, td.teamId);
                  const color = LANE_COLORS[tdIdx] ?? '#8896ab';
                  const rgb = hexToRgb(color);
                  const currentFileIdx = activeFileIdx[td.teamId] ?? 0;
                  const currentFile = td.files[currentFileIdx];

                  return (
                    <div key={td.teamId} style={{
                      marginBottom: tdIdx < result.deliverables!.length - 1 ? '1.25rem' : 0,
                      border: `1px solid rgba(${rgb},0.2)`,
                      borderRadius: '8px', overflow: 'hidden',
                    }}>
                      {/* Team header */}
                      <div style={{
                        padding: '0.5rem 0.85rem',
                        background: `rgba(${rgb},0.08)`,
                        borderBottom: `1px solid rgba(${rgb},0.15)`,
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                      }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase' }}>
                          {label}
                        </span>
                        <span style={{ fontSize: '0.68rem', color: '#4a5568' }}>
                          {td.files.length} {td.files.length === 1 ? 'file' : 'files'}
                        </span>
                      </div>

                      {td.files.length === 0 && (
                        <div style={{ padding: '0.75rem 0.85rem', fontSize: '0.75rem', color: '#4a5568', fontStyle: 'italic' }}>
                          No files submitted
                        </div>
                      )}

                      {td.files.length > 0 && (
                        <>
                          {/* File tabs */}
                          {td.files.length > 1 && (
                            <div style={{
                              display: 'flex', gap: '2px', padding: '0.4rem 0.6rem',
                              background: '#0a0e17', borderBottom: '1px solid #1e2d45',
                              flexWrap: 'wrap',
                            }}>
                              {td.files.map((f, fIdx) => (
                                <button
                                  key={fIdx}
                                  onClick={() => setActiveFileIdx((prev) => ({ ...prev, [td.teamId]: fIdx }))}
                                  style={{
                                    fontSize: '0.68rem', padding: '0.2rem 0.6rem',
                                    borderRadius: '4px', cursor: 'pointer',
                                    fontFamily: 'inherit', border: 'none',
                                    background: fIdx === currentFileIdx ? `rgba(${rgb},0.15)` : 'transparent',
                                    color: fIdx === currentFileIdx ? color : '#4a5568',
                                    fontWeight: fIdx === currentFileIdx ? 700 : 400,
                                    transition: 'all 0.1s ease',
                                  }}
                                >
                                  {f.path}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* File content */}
                          {currentFile && (
                            <div>
                              {td.files.length === 1 && (
                                <div style={{
                                  padding: '0.35rem 0.85rem',
                                  background: '#0a0e17', borderBottom: '1px solid #1e2d45',
                                  fontSize: '0.68rem', color: '#4a5568', fontFamily: 'monospace',
                                }}>
                                  {currentFile.path}
                                </div>
                              )}
                              <pre style={{
                                fontSize: '0.78rem', color: '#c4d4e8',
                                whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                                lineHeight: 1.6, margin: 0,
                                padding: '0.85rem 1rem',
                                background: '#0d1520',
                                overflowX: 'auto',
                              }}>
                                {currentFile.content.length > 5000
                                  ? `${currentFile.content.slice(0, 5000)}\n\n… (truncated — ${currentFile.content.length - 5000} chars remaining)`
                                  : currentFile.content}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* FILES TAB — fallback to event-captured files when no deliverables */}
            {activeTab === 'files' && !hasFiles && (
              <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                {!fileEventsByTeam || fileEventsByTeam.every((t) => t.files.length === 0) ? (
                  <div style={{ color: '#4a5568', fontStyle: 'italic', fontSize: '0.78rem', textAlign: 'center', paddingTop: '1rem' }}>
                    No files recorded for this competition.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(fileEventsByTeam.length, 2)}, 1fr)`, gap: '1rem' }}>
                    {fileEventsByTeam.map((teamFiles, tdIdx) => {
                      const label = resolveLabel(teams, teamFiles.teamId, teamFiles.teamId);
                      const color = LANE_COLORS[tdIdx] ?? '#8896ab';
                      const rgb = hexToRgb(color);
                      return (
                        <div key={teamFiles.teamId} style={{
                          border: `1px solid rgba(${rgb},0.2)`,
                          borderRadius: '8px', overflow: 'hidden',
                        }}>
                          {/* Team header */}
                          <div style={{
                            padding: '0.5rem 0.85rem',
                            background: `rgba(${rgb},0.08)`,
                            borderBottom: `1px solid rgba(${rgb},0.15)`,
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                          }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase' }}>
                              {label}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: '#4a5568' }}>
                              {teamFiles.files.length} {teamFiles.files.length === 1 ? 'file' : 'files'}
                            </span>
                          </div>
                          {/* Files */}
                          {teamFiles.files.length === 0 ? (
                            <div style={{ padding: '0.75rem 0.85rem', fontSize: '0.75rem', color: '#4a5568', fontStyle: 'italic' }}>
                              No files recorded
                            </div>
                          ) : (
                            <div style={{ maxHeight: '400px', overflowY: 'auto' }} className="arena-scrollbar">
                              {teamFiles.files.map((f, fIdx) => (
                                <div key={fIdx} style={{ borderBottom: fIdx < teamFiles.files.length - 1 ? '1px solid #1e2d45' : 'none' }}>
                                  {/* Filename bar */}
                                  <div style={{
                                    padding: '0.3rem 0.85rem',
                                    background: '#0a0e17',
                                    fontSize: '0.68rem', color: '#4a5568', fontFamily: 'monospace',
                                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                                  }}>
                                    <span style={{ color: '#22c55e' }}>📄</span>
                                    <span style={{ color: '#8896ab' }}>{f.path}</span>
                                  </div>
                                  {/* File content */}
                                  <pre style={{
                                    fontSize: '0.75rem', color: f.content ? '#c4d4e8' : '#4a5568',
                                    whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
                                    lineHeight: 1.6, margin: 0,
                                    padding: '0.65rem 1rem',
                                    background: '#0d1520',
                                    overflowX: 'auto',
                                    fontStyle: f.content ? 'normal' : 'italic',
                                  }}>
                                    {f.content
                                      ? (f.content.length > 3000
                                        ? `${f.content.slice(0, 3000)}\n\n… (truncated — ${f.content.length - 3000} chars remaining)`
                                        : f.content)
                                      : '(no content captured)'}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* SYNTHESIS TAB */}
            {activeTab === 'synthesis' && (
              <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                {result.synthesis ? (
                  <>
                    {/* Header — what synthesis is */}
                    <div style={{ marginBottom: '1.2rem', padding: '0.8rem 1rem', background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>🔬</span>
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#f97316', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI Synthesis</div>
                        <div style={{ fontSize: '0.65rem', color: '#8896ab', marginTop: '0.1rem' }}>The best elements from both submissions merged into a single hybrid solution</div>
                      </div>
                    </div>

                    {/* Overall thesis */}
                    {result.synthesis.overallRationale && (
                      <div style={{
                        marginBottom: '1.2rem', padding: '0.85rem 1rem',
                        background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)',
                        borderRadius: '8px',
                      }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#a855f7', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                          Synthesis Thesis
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#e2e8f0', lineHeight: 1.7 }}>
                          {result.synthesis.overallRationale}
                        </div>
                      </div>
                    )}

                    {/* Per-criterion breakdown */}
                    {(result.synthesis.perCriterion?.length ?? 0) > 0 && (
                      <div style={{ marginBottom: '1.4rem', background: '#0a1628', border: '1px solid #1e2d45', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ padding: '0.5rem 0.9rem', background: '#060e1a', borderBottom: '1px solid #1e2d45', fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                          Criterion-by-criterion verdict
                        </div>
                        <div style={{ padding: '0.4rem 0' }}>
                          {(result.synthesis.perCriterion ?? []).map((entry, i) => {
                            const winnerTeam = teams.find(t => t.id === entry.teamId);
                            const teamColor = winnerTeam ? getModelColor(winnerTeam.model) : '#8896ab';
                            const winnerLabel = resolveLabel(teams, entry.teamId, entry.teamId);
                            return (
                              <div key={entry.criterionId} style={{
                                padding: '0.7rem 0.9rem',
                                borderBottom: i < (result.synthesis?.perCriterion?.length ?? 1) - 1 ? '1px solid rgba(30,45,69,0.6)' : 'none',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                  <code style={{ fontSize: '0.62rem', color: '#4a6080', background: '#060e1a', padding: '0.15rem 0.4rem', borderRadius: '3px', border: '1px solid #1e2d45', whiteSpace: 'nowrap' }}>{entry.criterionId}</code>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: teamColor }}>{winnerLabel} wins</span>
                                </div>

                                {/* Winning approach */}
                                {entry.winningApproach && (
                                  <div style={{ fontSize: '0.72rem', color: '#c4d4e8', lineHeight: 1.6, marginBottom: '0.3rem' }}>
                                    <span style={{ color: '#22c55e', fontWeight: 700, marginRight: '0.3rem' }}>Selected:</span>
                                    {entry.winningApproach}
                                  </div>
                                )}

                                {/* Losing approach */}
                                {entry.losingApproach && (
                                  <div style={{ fontSize: '0.68rem', color: '#8896ab', lineHeight: 1.5, marginBottom: '0.3rem' }}>
                                    <span style={{ color: '#4a5568', fontWeight: 700, marginRight: '0.3rem' }}>Alternative:</span>
                                    {entry.losingApproach}
                                  </div>
                                )}

                                {/* Rationale */}
                                <div style={{ fontSize: '0.68rem', color: '#8896ab', fontStyle: 'italic', lineHeight: 1.5 }}>
                                  {entry.rationale}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Synthesized solution */}
                    <details style={{ background: '#060e1a', border: '1px solid #1e2d45', borderRadius: '8px', overflow: 'hidden', marginBottom: '0.8rem' }}>
                      <summary style={{
                        padding: '0.5rem 0.9rem', background: '#0a1628',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        cursor: 'pointer', listStyle: 'none',
                      }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Full Hybrid Solution</span>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              navigator.clipboard.writeText(result.synthesis?.synthesis ?? '').catch(() => {});
                            }}
                            style={{ fontSize: '0.58rem', color: '#4a6080', background: 'none', border: '1px solid #1e2d45', borderRadius: '4px', padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'monospace' }}
                          >
                            📋 copy
                          </button>
                          <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>▼</span>
                        </div>
                      </summary>
                      <div style={{ padding: '1rem', borderTop: '1px solid #1e2d45', fontFamily: "-apple-system, 'Segoe UI', sans-serif", fontSize: '0.78rem', lineHeight: 1.7, color: '#c4d4e8' }}>
                        {renderedSynthesis}
                      </div>
                    </details>
                  </>
                ) : (
                  <div style={{ color: '#4a5568', fontStyle: 'italic', fontSize: '0.78rem', textAlign: 'center', paddingTop: '2rem' }}>
                    Synthesis not available — run with <code style={{ fontFamily: 'monospace' }}>skipSynthesis: false</code> to enable
                  </div>
                )}
              </div>
            )}

            {/* FORGE TAB — build-ready artifacts */}
            {activeTab === 'forge' && (
              <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                {hasForge ? (
                  <>
                    {/* Header */}
                    <div style={{ marginBottom: '1.2rem', padding: '0.8rem 1rem', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>🔨</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#eab308', letterSpacing: '0.08em', textTransform: 'uppercase' }}>The Forge</div>
                        <div style={{ fontSize: '0.65rem', color: '#8896ab', marginTop: '0.1rem' }}>
                          Build-ready artifacts forged by <code style={{ fontFamily: 'monospace', color: '#f97316' }}>{result.forge!.forgeModel}</code>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>
                        {new Date(result.forge!.generatedAt).toLocaleString()}
                      </span>
                    </div>

                    {/* Artifact cards */}
                    {result.forge!.artifacts.map((artifact) => (
                      <details key={artifact.type} style={{
                        marginBottom: '0.75rem',
                        border: '1px solid #1e2d45',
                        borderRadius: '8px', overflow: 'hidden',
                        background: '#0a1628',
                      }}>
                        <summary style={{
                          padding: '0.7rem 1rem',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', gap: '0.6rem',
                          background: '#060e1a',
                          fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0',
                          listStyle: 'none',
                        }}>
                          <span style={{ fontSize: '0.85rem' }}>
                            {artifact.type === 'roadmap' ? '🗺️' :
                             artifact.type === 'task_graph' ? '📊' :
                             artifact.type === 'repo_blueprint' ? '🏗️' :
                             artifact.type === 'api_contracts' ? '📡' :
                             artifact.type === 'risk_register' ? '⚠️' :
                             artifact.type === 'decision_log' ? '📋' : '📄'}
                          </span>
                          <span style={{ flex: 1 }}>{artifact.title}</span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const blob = new Blob([artifact.content], { type: 'text/markdown' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${artifact.type}.md`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            style={{
                              fontSize: '0.58rem', color: '#4a6080', background: 'none',
                              border: '1px solid #1e2d45', borderRadius: '4px',
                              padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'monospace',
                            }}
                          >
                            ⬇ download
                          </button>
                          <span style={{ fontSize: '0.6rem', color: '#4a5568' }}>▼</span>
                        </summary>
                        <div style={{
                          padding: '1rem', borderTop: '1px solid #1e2d45',
                          fontFamily: "-apple-system, 'Segoe UI', sans-serif",
                          fontSize: '0.78rem', lineHeight: 1.7, color: '#c4d4e8',
                          whiteSpace: 'pre-wrap',
                        }}>
                          {artifact.content}
                        </div>
                      </details>
                    ))}

                    {/* Download all button */}
                    <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                      <button
                        onClick={() => {
                          result.forge!.artifacts.forEach((artifact) => {
                            const blob = new Blob([artifact.content], { type: 'text/markdown' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `${artifact.type}.md`;
                            a.click();
                            URL.revokeObjectURL(url);
                          });
                        }}
                        style={{
                          fontSize: '0.72rem', fontWeight: 700, color: '#eab308',
                          background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)',
                          borderRadius: '6px', padding: '0.5rem 1.2rem', cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        ⬇ Download All Artifacts
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', paddingTop: '2rem' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.8rem' }}>🔨</div>
                    <div style={{ fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 700, marginBottom: '0.5rem' }}>
                      The Forge
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#8896ab', lineHeight: 1.6, maxWidth: '400px', margin: '0 auto 1.2rem' }}>
                      Review the presentations, scores, and synthesis above. When you&apos;re ready, forge the winning solution into build-ready artifacts.
                    </div>
                    {forging && (
                      <div style={{ marginBottom: '1.5rem', textAlign: 'left', display: 'inline-block' }}>
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, letterSpacing: '2px', color: '#8896ab', marginBottom: '0.6rem' }}>
                          FORGING ARTIFACTS
                        </div>
                        {[
                          { type: 'roadmap', label: 'Roadmap' },
                          { type: 'task_graph', label: 'Task Graph' },
                          { type: 'repo_blueprint', label: 'Repo Blueprint' },
                          { type: 'api_contracts', label: 'API Contracts' },
                          { type: 'risk_register', label: 'Risk Register' },
                          { type: 'decision_log', label: 'Decision Log' },
                        ].map(({ type, label }) => {
                          const status = forgeProgress?.[type] ?? 'queued';
                          return (
                            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
                              <span style={{ fontSize: '0.75rem', color: status === 'done' ? '#22c55e' : status === 'generating' ? '#eab308' : status === 'error' ? '#ef4444' : '#4a5568', flexShrink: 0, width: '1rem', textAlign: 'center' }}>
                                {status === 'done' ? '✓' : status === 'generating' ? '⟳' : status === 'error' ? '✗' : '○'}
                              </span>
                              <span style={{ fontSize: '0.7rem', color: status === 'queued' ? '#4a5568' : '#e2e8f0', flex: 1 }}>{label}</span>
                              <span style={{ fontSize: '0.62rem', color: status === 'done' ? '#22c55e' : status === 'generating' ? '#eab308' : status === 'error' ? '#ef4444' : '#2d4060' }}>
                                {status === 'done' ? 'done' : status === 'generating' ? 'generating…' : status === 'error' ? 'error' : 'queued'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <button
                      disabled={forging}
                      onClick={async () => {
                        setForging(true);
                        setForgeError(null);
                        try {
                          const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
                          const res = await fetch(`${apiBase}/competitions/${competitionId}/forge`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                          });
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            setForgeError(data.error ?? `Forge request failed (${res.status})`);
                            setForging(false);
                            return;
                          }
                          // Poll for completion
                          let attempts = 0;
                          forgePollRef.current = setInterval(async () => {
                            attempts++;
                            try {
                              // Poll progress (best-effort, don't fail if 404)
                              const progRes = await fetch(`${apiBase}/competitions/${competitionId}/forge/progress`);
                              if (progRes.ok) {
                                const { progress } = await progRes.json();
                                setForgeProgress(progress);
                              }

                              // Poll for completion
                              const pollRes = await fetch(`${apiBase}/competitions/${competitionId}/forge`);
                              if (pollRes.ok) {
                                const data = await pollRes.json();
                                if (data.status === 'complete' && data.forge) {
                                  clearInterval(forgePollRef.current!); forgePollRef.current = null;
                                  setForgeProgress(null);
                                  onForgeComplete?.(data.forge);
                                  setActiveTab('forge');
                                  setForging(false);
                                }
                              } else if (pollRes.status === 404) {
                                clearInterval(forgePollRef.current!); forgePollRef.current = null;
                                setForgeProgress(null);
                                setForgeError('Forge failed server-side. Check the API server logs for details.');
                                setForging(false);
                              }
                            } catch { /* network error, keep polling */ }
                            if (attempts >= 60) {
                              clearInterval(forgePollRef.current!); forgePollRef.current = null;
                              setForgeProgress(null);
                              setForgeError('Forge timed out after 3 minutes.');
                              setForging(false);
                            }
                          }, 3000);
                        } catch (err) {
                          setForgeError('Network error — is the API server running?');
                          setForging(false);
                        }
                      }}
                      style={{
                        fontSize: '0.78rem', fontWeight: 800, color: forging ? '#eab308' : '#0a0e17',
                        background: forging
                          ? 'rgba(234,179,8,0.1)'
                          : 'linear-gradient(135deg, #eab308, #f59e0b)',
                        border: forging ? '1px solid rgba(234,179,8,0.4)' : 'none',
                        borderRadius: '8px',
                        padding: '0.65rem 2rem', cursor: forging ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', letterSpacing: '0.5px',
                        transition: 'all 0.15s',
                        animation: forging ? 'judgingPulse 2s ease-in-out infinite' : 'none',
                      }}
                    >
                      {forging ? '🔨 Forging… (~30s)' : 'Forge This Solution'}
                    </button>
                    {forgeError && (
                      <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: '0.8rem', maxWidth: '400px', margin: '0.8rem auto 0', lineHeight: 1.5 }}>
                        {forgeError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}

// ─── State banner ─────────────────────────────────────────────────────────────

const STATE_BANNERS: Partial<Record<CompetitionState | 'PAUSED', {
  icon: string; label: string; sub: string;
  bg: string; border: string; color: string; animate?: string;
}>> = {
  JUDGING:     { icon: '⚖️', label: 'JUDGING IN PROGRESS',    sub: 'AI judge is evaluating both submissions…',        bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.3)',  color: '#eab308', animate: 'judgingPulse 2s ease-in-out infinite' },
  PAUSED:      { icon: '⏸',  label: 'COMPETITION PAUSED',     sub: 'Resume when ready — clock is frozen.',             bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6' },
  COLLECTING:  { icon: '📦', label: 'COLLECTING DELIVERABLES', sub: 'Gathering files from each agent workspace…',       bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.3)', color: '#a855f7', animate: 'judgingPulse 2s ease-in-out infinite' },
  PRESENTING:  { icon: '🎤', label: 'GENERATING PRESENTATIONS', sub: 'Translating deliverables into human-readable summaries…', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6', animate: 'judgingPulse 2s ease-in-out infinite' },
  SYNTHESIZING:{ icon: '🔮', label: 'SYNTHESIZING',            sub: 'Merging the best elements from both submissions…', bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.3)', color: '#a855f7', animate: 'judgingPulse 2s ease-in-out infinite' },
  FORGING:     { icon: '🔨', label: 'FORGING',                 sub: 'Generating build-ready artifacts from the winning solution…', bg: 'rgba(234,179,8,0.10)', border: 'rgba(234,179,8,0.3)', color: '#eab308', animate: 'judgingPulse 2s ease-in-out infinite' },
  FAILED:      { icon: '💥', label: 'COMPETITION FAILED',      sub: 'An error occurred during the competition.',        bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',  color: '#ef4444' },
  CANCELLED:   { icon: '🚫', label: 'COMPETITION CANCELLED',   sub: 'This competition was stopped early.',              bg: 'rgba(136,150,171,0.08)',border: 'rgba(136,150,171,0.2)',color: '#8896ab' },
};

function StateBanner({ state, isPaused }: { state: CompetitionState; isPaused: boolean }) {
  const key = isPaused ? 'PAUSED' : state;
  const cfg = STATE_BANNERS[key as keyof typeof STATE_BANNERS];
  if (!cfg) return null;

  return (
    <div style={{
      background: `linear-gradient(90deg, transparent 0%, ${cfg.bg} 30%, ${cfg.bg} 70%, transparent 100%)`,
      borderBottom: `1px solid ${cfg.border}`,
      padding: '0.5rem 1.4rem',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem',
      animation: cfg.animate ?? 'none',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: '1rem' }}>{cfg.icon}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: cfg.color, letterSpacing: '2px' }}>
        {cfg.label}
      </span>
      <span style={{ fontSize: '0.67rem', color: '#8896ab', fontStyle: 'italic' }}>
        {cfg.sub}
      </span>
    </div>
  );
}

// ─── Commentary bar ───────────────────────────────────────────────────────────

function CommentaryBar({ events }: { events: ArenaEvent[] }) {
  const latest = [...events].reverse().find((e) => e.type === 'COMMENTARY');
  if (!latest) return null;
  const payload = latest.payload as Record<string, unknown>;
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) return null;

  return (
    <div style={{
      borderBottom: '1px solid rgba(234,179,8,0.2)',
      background: 'rgba(234,179,8,0.06)',
      padding: '0.4rem 1.4rem',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
      flexShrink: 0,
    }}>
      <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>🎙️</span>
      <span style={{
        fontSize: '0.78rem', fontWeight: 700, color: '#eab308',
        letterSpacing: '0.5px', flexShrink: 0,
        background: 'rgba(234,179,8,0.12)', padding: '0.1rem 0.45rem',
        borderRadius: '4px',
      }}>
        COMMENTARY
      </span>
      <span style={{
        fontSize: '0.82rem', color: '#d4a017', fontStyle: 'italic',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {text}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitionPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();

  const [state, setState] = useState<CompetitionState>('PENDING');
  const [teams, setTeams] = useState<Team[]>([]);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefTitle, setBriefTitle] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [teamEvents, setTeamEvents] = useState<Map<string, ArenaEvent[]>>(new Map());
  const [broadcastEvents, setBroadcastEvents] = useState<ArenaEvent[]>([]);
  // Accurate per-team event type counts (never trimmed, unlike the display buffer)
  const eventCountsRef = useRef<Map<string, Record<string, number>>>(new Map());
  const [result, setResult] = useState<CompetitionResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [connected, setConnected] = useState(false);
  const [sseError, setSseError] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [competitionStartTime, setCompetitionStartTime] = useState<number | null>(null);
  const [rematchLoading, setRematchLoading] = useState(false);
  const [copyLabel, setCopyLabel] = useState<'🔗 Copy Link' | '✓ Copied'>('🔗 Copy Link');

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
      .then((data: { teams?: Team[]; brief?: Brief; startedAt?: string; state?: CompetitionState; result?: Record<string, unknown> | null } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief) { setBrief(data.brief); setBriefTitle(data.brief.title ?? ''); }
        if (data.startedAt) setCompetitionStartTime(new Date(data.startedAt).getTime());
        // Hydrate state + result for already-completed competitions (WS won't replay forge events)
        if (data.state) setState(data.state);
        if (data.result) {
          // DB result has `scorecards` + `winnerId`; frontend expects `teams` + `winnerId`
          const raw = data.result;
          const scorecards = (raw.scorecards ?? []) as Array<{ teamId: string; finalScore: number; rank?: number; judgeResults?: Array<{ scores?: Array<{ criterionId: string; score: number; maxScore?: number; commentary?: string }> }> }>;
          const normalized: CompetitionResult = {
            winnerId: (raw.winnerId as string) ?? null,
            teams: scorecards.map((sc) => ({
              teamId: sc.teamId,
              totalScore: sc.finalScore,
              criteriaScores: sc.judgeResults?.[0]?.scores?.map(s => ({
                criterionId: s.criterionId, score: s.score, maxScore: s.maxScore ?? 10, commentary: s.commentary ?? '',
              })) ?? [],
              rank: sc.rank,
            })),
            summary: raw.summary as string | undefined,
            synthesis: raw.synthesis as SynthesisResult | null | undefined,
            presentations: raw.presentations as TeamPresentation[] | undefined,
            forge: raw.forge as ForgeOutput | null | undefined,
            deliverables: raw.deliverables as TeamDeliverable[] | undefined,
          };
          setResult(normalized);
          setScoreDrawerHeight(SCORE_DRAWER_EXPANDED);
        }
      })
      .catch(() => { /* non-critical */ });
  }, [id]);

  // Update browser tab title when brief loads
  useEffect(() => {
    if (brief?.title) {
      document.title = `${brief.title} — Arena`;
    }
    return () => { document.title = 'Agent Arena'; };
  }, [brief?.title]);

  // Elapsed timer — counts from competition start time, freezes when paused or post-run
  useEffect(() => {
    const postRun = state === 'COMPLETE' || state === 'FORGE_COMPLETE' || state === 'FAILED' || state === 'CANCELLED'
      || state === 'COLLECTING' || state === 'JUDGING' || state === 'SYNTHESIZING' || state === 'FORGING';
    if (isPaused || postRun) return;
    const base = competitionStartTime ?? Date.now();
    const iv = setInterval(() => setElapsed(Date.now() - base), 500);
    return () => clearInterval(iv);
  }, [state, competitionStartTime, isPaused]);

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
      // Track accurate counts (never trimmed)
      if (teamId && teamId !== '') {
        const counts = eventCountsRef.current.get(teamId) ?? {};
        counts[ev.type] = (counts[ev.type] ?? 0) + 1;
        eventCountsRef.current.set(teamId, counts);
      }

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
        if (updated.length > 600) {
          // Keep all important events (TOOL_CALL, FILE_CREATE, ERROR); trim only REASONING
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
            const s = ev.state as string;
            if (s === 'RUNNING') { setState('RUNNING'); setIsPaused(false); }
            else if (s === 'JUDGING' || s === 'COLLECTING' || s === 'SYNTHESIZING') setState(s as CompetitionState);
            else if (s === 'PAUSED') setIsPaused(true);
            else if (s === 'FAILED' || s === 'CANCELLED') {
              setState(s as CompetitionState);
              intentionalClose = true;
              ws.close();
            }
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
    if (action === 'cancel') setState('CANCELLED');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopyLabel('✓ Copied');
      setTimeout(() => setCopyLabel('🔗 Copy Link'), 2000);
    }).catch(() => { /* clipboard not available */ });
  };

  const handleRematch = async () => {
    if (!brief || teams.length === 0 || rematchLoading) return;
    setRematchLoading(true);
    try {
      const res = await fetch('/api/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief,
          teams,
          options: { skipSandbox: true, skipSynthesis: false },
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { competitionId?: string; id?: string };
      const newId = data.competitionId ?? data.id;
      if (newId) router.push(`/competitions/${newId}`);
    } finally {
      setRematchLoading(false);
    }
  };

  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : Array.from(teamEvents.keys()).map((tid) => ({ id: tid, model: tid }));

  // Collect FILE_CREATE events from the event stream, grouped by team
  const fileEventsByTeam: TeamFileEvents[] = useMemo(() => orderedTeams.map((team) => {
    const events = teamEvents.get(team.id) ?? [];
    const files = events
      .filter((ev) => ev.type === 'FILE_CREATE')
      .map((ev) => {
        const p = ev.payload as Record<string, unknown> | null;
        const path = String(p?.path ?? p?.text ?? '');
        const content = String(p?.content ?? '');
        return { path, content };
      })
      .filter((f) => f.path !== '');
    return { teamId: team.id, files };
  }), [orderedTeams, teamEvents]);

  const numTeams = Math.max(orderedTeams.length, 1);
  const stateBadge = getStateStyle(state ?? 'PENDING');
  const isRunning = state === 'RUNNING';
  const isComplete = state === 'COMPLETE' || state === 'FORGE_COMPLETE';
  const isTerminal = state === 'COMPLETE' || state === 'FORGE_COMPLETE' || state === 'FAILED' || state === 'CANCELLED';

  const totalEvents = Array.from(teamEvents.values()).reduce(
    (sum, evs) => sum + evs.length, 0,
  ) + broadcastEvents.length;

  return (
    <>
      <style suppressHydrationWarning>{GLOBAL_STYLES}</style>
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
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#e2e8f0' }}>
                {briefTitle}
              </span>
            )}
            <span style={{
              fontSize: '0.75rem', fontWeight: 800, padding: '0.2rem 0.65rem',
              borderRadius: '4px', letterSpacing: '1.5px',
              background: stateBadge.bg, color: stateBadge.color,
              border: `1px solid ${stateBadge.color}33`,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
            }}>
              {isRunning && <StatusDot color={stateBadge.color} pulsing={true} />}
              {isComplete && <span>✅</span>}
              {state === 'FAILED' && <span>💥</span>}
              {state === 'CANCELLED' && <span>🚫</span>}
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

          <button onClick={() => setBriefOpen(o => !o)} style={{
            fontSize: '0.70rem', color: briefOpen ? '#f97316' : '#8896ab',
            background: briefOpen ? 'rgba(249,115,22,0.1)' : 'transparent',
            border: `1px solid ${briefOpen ? 'rgba(249,115,22,0.4)' : '#1e2d45'}`,
            borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
            letterSpacing: '0.5px', fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.35rem',
            transition: 'all 0.15s ease',
          }}>
            📋 BRIEF
          </button>

          {brief && (
            <button
              onClick={() => downloadYaml(`brief-${id}.yml`, briefToYaml(brief))}
              className="text-xs border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 px-2 py-1 rounded"
              style={{ fontSize: '0.70rem', flexShrink: 0, cursor: 'pointer', fontFamily: 'inherit' }}
              title="Download brief as YAML"
            >
              ⬇ Brief
            </button>
          )}

          <button
            onClick={handleCopyLink}
            style={{
              fontSize: '0.70rem', color: copyLabel === '✓ Copied' ? '#22c55e' : '#8896ab',
              background: copyLabel === '✓ Copied' ? 'rgba(34,197,94,0.1)' : 'transparent',
              border: `1px solid ${copyLabel === '✓ Copied' ? 'rgba(34,197,94,0.4)' : '#1e2d45'}`,
              borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
              letterSpacing: '0.5px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              transition: 'all 0.15s ease', fontFamily: 'inherit',
            }}
            title="Copy link to this competition"
          >
            {copyLabel}
          </button>

          {isTerminal && brief && teams.length > 0 && (
            <button
              onClick={handleRematch}
              disabled={rematchLoading}
              style={{
                fontSize: '0.70rem', color: rematchLoading ? '#4a5568' : '#f97316',
                background: rematchLoading ? 'transparent' : 'rgba(249,115,22,0.08)',
                border: `1px solid ${rematchLoading ? '#1e2d45' : 'rgba(249,115,22,0.35)'}`,
                borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
                letterSpacing: '0.5px', fontWeight: 600, cursor: rematchLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                transition: 'all 0.15s ease', fontFamily: 'inherit',
              }}
              title="Start a new competition with the same brief and models"
            >
              {rematchLoading
                ? <><ActivitySpinner color="#f97316" active={true} /> REMATCH</>
                : '⟳ REMATCH'}
            </button>
          )}

          {isComplete && (
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
          )}

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

        {/* ── Brief panel ──────────────────────────────────────────────────── */}
        {briefOpen && brief && (
          <div style={{
            background: '#0d1520', borderBottom: '1px solid #1e2d45',
            padding: '1.2rem 1.6rem', flexShrink: 0,
            maxHeight: '380px', overflowY: 'auto',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem',
          }}>
            {/* Left col: problem + agents */}
            <div>
              <div style={{ fontSize: '0.65rem', color: '#4a5568', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                PROBLEM
              </div>
              <div style={{ fontSize: '0.82rem', color: '#c4cdd9', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>
                {brief.problem}
              </div>

              {(brief.constraints?.length ?? 0) > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#4a5568', letterSpacing: '1.5px', marginBottom: '0.4rem' }}>
                    CONSTRAINTS
                  </div>
                  {brief.constraints!.map((c, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#8896ab', paddingLeft: '0.6rem', borderLeft: '2px solid #1e2d45', marginBottom: '0.25rem' }}>
                      {c}
                    </div>
                  ))}
                </div>
              )}

              {(brief.deliverables?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#4a5568', letterSpacing: '1.5px', marginBottom: '0.4rem' }}>
                    DELIVERABLES
                  </div>
                  {brief.deliverables!.map((d, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#8896ab', paddingLeft: '0.6rem', borderLeft: '2px solid #1e2d45', marginBottom: '0.25rem' }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right col: teams + rubric + rematch */}
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.65rem', color: '#4a5568', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                  AGENTS
                </div>
                {teams.map((t, i) => {
                  const color = getModelColor(t.model);
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color, background: `${color}18`, border: `1px solid ${color}44`, borderRadius: '4px', padding: '0.1rem 0.45rem', letterSpacing: '0.5px' }}>
                        {getModelName(t.model).toUpperCase()}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#8896ab' }}>{t.model}</span>
                    </div>
                  );
                })}
              </div>

              {brief.rubric?.criteria && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#4a5568', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                    RUBRIC
                  </div>
                  {brief.rubric.criteria.map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#8896ab' }}>{c.id}</span>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.65rem', color: '#4a5568' }}>{Math.round(c.weight * 100)}%</span>
                        <span style={{ fontSize: '0.72rem', color: '#c4cdd9', fontWeight: 700 }}>/{c.maxScore}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {brief.timeLimitMs && (
                <div style={{ fontSize: '0.72rem', color: '#4a5568', marginBottom: '1rem' }}>
                  ⏱ {Math.round(brief.timeLimitMs / 60000)} min time limit
                  {brief.format && <span style={{ marginLeft: '0.75rem' }}>📐 {brief.format}</span>}
                </div>
              )}

              <a
                href={`/competitions/new?from=${id}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  fontSize: '0.72rem', fontWeight: 800, letterSpacing: '1px',
                  color: '#f97316', background: 'rgba(249,115,22,0.1)',
                  border: '1px solid rgba(249,115,22,0.35)', borderRadius: '6px',
                  padding: '0.4rem 0.9rem', textDecoration: 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                ⚔️ REMATCH
              </a>
            </div>
          </div>
        )}

        {/* ── State banner ─────────────────────────────────────────────────── */}
        <StateBanner state={state} isPaused={isPaused} />

        {/* ── Commentary bar ───────────────────────────────────────────────── */}
        <CommentaryBar events={broadcastEvents} />

        {/* ── Lanes ────────────────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${numTeams}, 1fr)`,
          overflow: 'hidden', flex: 1, minHeight: 0,
        }}>
          {orderedTeams.map((team, i) => {
            // Broadcast events (TIME_UP, TIME_WARNING) are shown in the StateBanner,
            // not injected into each lane to avoid duplicate rows.
            const events = (teamEvents.get(team.id) ?? [])
              .slice()
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

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
                isPaused={isPaused}
                competitionStartTime={competitionStartTime}
                eventCounts={eventCountsRef.current.get(team.id)}
                teamIndex={i}
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
            competitionId={id}
            result={result}
            teams={orderedTeams}
            height={scoreDrawerHeight}
            onToggle={() => setScoreDrawerHeight((h) =>
              h > SCORE_DRAWER_COLLAPSED ? SCORE_DRAWER_COLLAPSED : SCORE_DRAWER_EXPANDED
            )}
            fileEventsByTeam={fileEventsByTeam}
            onForgeComplete={(forge) => setResult(prev => prev ? { ...prev, forge } : prev)}
          />
        )}
      </div>
    </>
  );
}
