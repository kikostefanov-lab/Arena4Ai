'use client';

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatElapsed, resolveTeamLabel } from '../../../lib/format';
import { MODEL_BADGE_COLORS as TOKEN_BADGE_COLORS, LANE_COLORS, getModelColor, getStateStyle, hexToRgb } from '../../../lib/design-tokens';
import { briefToYaml, downloadYaml } from '../../../lib/brief-yaml';
import { EventRow, classifyEvent } from '../../../lib/EventRow';
import type { ForgeRun, ForgeSource } from '@arena/shared';

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
interface ForgeArtifact { type: string; title: string; content: string; generatedAt: string; universal?: boolean; }
interface ForgeOutput { forgeModel: string; artifacts: ForgeArtifact[]; generatedAt: string; domain?: string; selectedTypes?: string[]; }
interface CompetitionResult { winnerId: string | null; teams: TeamResult[]; summary?: string; synthesis?: SynthesisResult | null; deliverables?: TeamDeliverable[]; presentations?: TeamPresentation[]; forge?: ForgeRun[] | null; }

type CompetitionState = 'PENDING' | 'RUNNING' | 'COLLECTING' | 'PRESENTING' | 'JUDGING' | 'SYNTHESIZING' | 'COMPLETE' | 'FORGING' | 'FORGE_COMPLETE' | 'ERROR' | 'FAILED' | 'CANCELLED';

// ─── Constants ────────────────────────────────────────────────────────────────

const HIST_COLORS: Record<string, string> = {
  TOOL_CALL:   '#0080ff',
  FILE_CREATE: '#00f0ff',
  FILE_MODIFY: '#0066ff',
  REASONING:   '#0066ff',
  ERROR:       '#ef4444',
};

// LANE_COLORS imported from design-tokens above

const MODEL_BADGE_COLORS = TOKEN_BADGE_COLORS;

const ARTIFACT_EMOJI: Record<string, string> = {
  // Universal
  executive_summary:      '⭐',
  next_steps:             '🎯',
  tool_recommendations:   '🔧',
  // Software
  roadmap:                '🗺️',
  task_graph:             '📊',
  repo_blueprint:         '🏗️',
  api_contracts:          '📡',
  risk_register:          '⚠️',
  decision_log:           '📋',
  // Research
  evaluation_matrix:      '📐',
  vendor_scorecard:       '🏆',
  decision_framework:     '🧭',
  // Creative
  content_outline:        '✍️',
  presentation_structure: '🎨',
  messaging_guide:        '📣',
  // Security
  threat_model:           '🛡️',
  attack_surface:         '🎯',
  remediation_plan:       '🔒',
  // Business
  business_case:          '💼',
  go_to_market:           '🚀',
  stakeholder_map:        '🗺️',
  // Ideation
  concept_canvas:         '💡',
  mvp_definition:         '🏁',
  hypothesis_backlog:     '🧪',
};

// ─── Global CSS ──────────────────────────────────────────────────────────────

const GLOBAL_STYLES = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes pulseGlow {
  0%, 100% { box-shadow: 0 0 4px rgba(0,240,255,0.3); }
  50% { box-shadow: 0 0 12px rgba(0,240,255,0.6); }
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
  0%, 100% { border-color: rgba(0,240,255,0.2); }
  50% { border-color: rgba(0,240,255,0.5); }
}

@keyframes celebrationFlash {
  0% { background: rgba(0,240,255,0.15); }
  50% { background: rgba(0,240,255,0.05); }
  100% { background: rgba(0,240,255,0); }
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

@keyframes winnerFlash {
  0%   { box-shadow: 0 0 0 0 rgba(0,240,255,0); }
  30%  { box-shadow: 0 0 40px 12px rgba(0,240,255,0.6); }
  70%  { box-shadow: 0 0 40px 12px rgba(0,240,255,0.4); }
  100% { box-shadow: 0 0 0 0 rgba(0,240,255,0); }
}

@keyframes winnerBanner {
  0%   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
  75%  { opacity: 1; transform: translateX(-50%) translateY(0); }
  100% { opacity: 0; transform: translateX(-50%) translateY(-8px); }
}

@media (max-width: 700px) {
  .arena-tab-bar {
    overflow-x: auto !important;
    white-space: nowrap !important;
  }
  .arena-tab-bar::-webkit-scrollbar { height: 3px; }
  .arena-tab-bar::-webkit-scrollbar-thumb { background: #0a2235; border-radius: 2px; }
}

.arena-scrollbar::-webkit-scrollbar { width: 5px; }
.arena-scrollbar::-webkit-scrollbar-track { background: transparent; }
.arena-scrollbar::-webkit-scrollbar-thumb { background: #0a2235; border-radius: 3px; }
.arena-scrollbar::-webkit-scrollbar-thumb:hover { background: #0e3050; }

.arena-event-row { animation: slideIn 0.2s ease-out; }
.arena-score-card { animation: slideInScore 0.4s ease-out both; }
.arena-winner-card { animation: glow 2s ease-in-out infinite; }
.arena-progress-bar { animation: progressReveal 0.8s ease-out both; }
.arena-running-border { animation: borderGlow 2s ease-in-out infinite; }
.arena-celebration { animation: celebrationFlash 1.5s ease-out; }

.resize-handle {
  flex-shrink: 0;
  height: 5px;
  background: #0a2235;
  cursor: ns-resize;
  user-select: none;
  transition: background 0.15s;
  position: relative;
}
.resize-handle:hover, .resize-handle.dragging {
  background: rgba(0,240,255,0.5);
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
    bg: 'rgba(74,143,168,0.12)', fg: '#4a8fa8', border: 'rgba(74,143,168,0.3)',
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
      overflow: 'hidden', gap: '1px', background: 'rgba(10,34,53,0.5)',
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
        <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#4a8fa8', letterSpacing: '3px', animation: 'pulse 2s ease-in-out infinite' }}>
          BATTLE STATION INITIALIZING
        </div>
      </div>

      {/* Progress */}
      <div style={{ width: '78%', maxWidth: '320px', zIndex: 1 }}>
        <div style={{ height: '6px', background: 'rgba(10,34,53,0.8)', borderRadius: '3px', overflow: 'hidden', marginBottom: '0.65rem' }}>
          <div style={{
            height: '100%', width: `${progress}%`, borderRadius: '3px',
            background: `linear-gradient(90deg, ${color}55, ${color})`,
            boxShadow: `0 0 10px ${color}80`,
            transition: 'width 0.9s ease-out',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#4a8fa8', animation: 'msgFade 1.6s ease-in-out infinite' }}>
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
      borderLeft: borderLeft ? '1px solid #0a2235' : 'none',
      background: '#000408',
    }}>
      {/* Header */}
      <div style={{
        padding: '0.85rem 1.2rem',
        background: 'linear-gradient(180deg, #020b14 0%, #010810 100%)',
        borderBottom: `3px solid ${isRunning ? color : '#0a2235'}`,
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
            {String.fromCharCode(65 + teamIndex)}
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
            fontSize: '0.78rem', color: '#1e4a5a', fontWeight: 700,
            fontFamily: 'monospace', background: 'rgba(10,34,53,0.4)',
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
            <p style={{ color: '#0e3050', fontSize: '0.88rem', fontStyle: 'italic' }}>
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
          borderTop: '1px solid rgba(10,34,53,0.6)',
          background: '#010810', flexShrink: 0, flexWrap: 'wrap',
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
          background: 'rgba(0,4,8,0.65)',
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
            <li key={i} style={{ marginBottom: '0.2rem', color: '#d8f0fa' }}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
    if (numberedItems.length > 0) {
      nodes.push(
        <ol key={`ol-${key}`} style={{ margin: '0.3rem 0 0.6rem 1.4rem', padding: 0 }}>
          {numberedItems.map((item, i) => (
            <li key={i} style={{ marginBottom: '0.2rem', color: '#d8f0fa' }}>{renderInline(item)}</li>
          ))}
        </ol>
      );
      numberedItems = [];
    }
  };

  const flushCode = (key: string) => {
    if (codeLines.length > 0) {
      nodes.push(
        <div key={`code-${key}`} style={{ margin: '0.6rem 0', borderRadius: '6px', overflow: 'hidden', border: '1px solid #0a2235' }}>
          {codeLang && (
            <div style={{ background: '#010810', padding: '0.2rem 0.7rem', fontSize: '0.55rem', color: '#4a6080', fontFamily: 'monospace', letterSpacing: '0.05em', borderBottom: '1px solid #0a2235' }}>
              {codeLang}
            </div>
          )}
          <pre style={{ margin: 0, padding: '0.75rem', background: '#000408', overflowX: 'auto', fontSize: '0.7rem', lineHeight: 1.55, color: '#a8d8a8', fontFamily: "'SF Mono','Fira Code','Cascadia Code',monospace" }}>
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
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i} style={{ color: '#c8eef8' }}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`')) return <code key={i} style={{ fontFamily: 'monospace', fontSize: '0.68rem', background: '#010810', color: '#7dd3a8', padding: '0.1rem 0.3rem', borderRadius: '3px', border: '1px solid #0a2235' }}>{part.slice(1, -1)}</code>;
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
      nodes.push(<h2 key={idx} style={{ fontSize: '0.9rem', fontWeight: 800, color: '#00f0ff', margin: '1.2rem 0 0.5rem', letterSpacing: '0.5px' }}>{h1Match[1]}</h2>);
    } else if (h2Match) {
      flushList(`list-${idx}`);
      nodes.push(<h3 key={idx} style={{ fontSize: '0.78rem', fontWeight: 800, color: '#c8eef8', letterSpacing: '1px', textTransform: 'uppercase', margin: '1rem 0 0.35rem', borderBottom: '1px solid #0a2235', paddingBottom: '0.3rem' }}>{h2Match[1]}</h3>);
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
      if (trimmed) nodes.push(<p key={idx} style={{ margin: '0.2rem 0', color: '#d8f0fa', lineHeight: 1.65 }}>{renderInline(trimmed)}</p>);
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
  onMaximize,
  maximized,
  fileEventsByTeam,
  comp,
}: {
  competitionId: string;
  result: CompetitionResult;
  teams: Team[];
  height: number;
  onToggle: () => void;
  onMaximize: () => void;
  maximized: boolean;
  fileEventsByTeam?: TeamFileEvents[];
  comp?: { state: string } | null;
}) {
  const [activeTab, setActiveTab] = useState<'scores' | 'presentations' | 'files' | 'synthesis' | 'forge'>(
    result.forge && result.forge.length > 0 ? 'forge' : 'scores'
  );
  const [activeFileIdx, setActiveFileIdx] = useState<Record<string, number>>({});
  const [expandedFile, setExpandedFile] = useState<{ teamId: string; path: string } | null>(null);
  const [fileModalContent, setFileModalContent] = useState<{ path: string; content: string } | null>(null);
  const [presentationModal, setPresentationModal] = useState<TeamPresentation | null>(null);
  // Layout redesign state
  const [selectedCriterionId, setSelectedCriterionId] = useState<string | null>(null);
  const [selectedSynthCriterionId, setSelectedSynthCriterionId] = useState<string | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<{ teamId: string; path: string } | null>(null);
  const [filePreviewHeight, setFilePreviewHeight] = useState(180);
  const isDraggingFilePreview = useRef(false);
  const dragFilePreviewStartY = useRef(0);
  const dragFilePreviewStartH = useRef(0);
  const isExpanded = height > SCORE_DRAWER_COLLAPSED;

  const winnerLabel = result.winnerId
    ? resolveLabel(teams, result.winnerId, result.winnerId)
    : null;

  const teamDisplays = result.teams.map((tr, i) => ({
    result: tr,
    label: resolveLabel(teams, tr.teamId, `Team ${i + 1}`),
    color: LANE_COLORS[i] ?? '#4a8fa8',
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

  const hasForge = result.forge != null && result.forge.length > 0;
  const [synthRunning, setSynthRunning] = useState(false);
  const [synthError, setSynthError] = useState<string | null>(null);

  // E1: Score animation
  const [scoreProgress, setScoreProgress] = useState(0);
  useEffect(() => {
    if (!result.teams?.length) return;
    setScoreProgress(0);
    const start = performance.now();
    const duration = 1200;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      setScoreProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [result.teams]);

  // E2: Winner flash banner
  const hasAnnouncedWinner = useRef(false);
  const [showWinnerBanner, setShowWinnerBanner] = useState(false);
  useEffect(() => {
    if (
      !hasAnnouncedWinner.current &&
      (comp?.state === 'COMPLETE' || comp?.state === 'SCORED') &&
      result.winnerId
    ) {
      hasAnnouncedWinner.current = true;
      setShowWinnerBanner(true);
      const t = setTimeout(() => setShowWinnerBanner(false), 4000);
      return () => clearTimeout(t);
    }
  }, [comp?.state, result.winnerId]);

  // E3: Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const tabMap: Record<string, 'scores' | 'presentations' | 'files' | 'synthesis' | 'forge'> = {
        '1': 'scores',
        '2': 'presentations',
        '3': 'files',
        '4': 'synthesis',
        '5': 'forge',
      };
      if (tabMap[e.key]) {
        setActiveTab(tabMap[e.key]);
      }
      if (e.key === 'Escape') {
        setFileModalContent(null);
        setPresentationModal(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // File preview drag mechanic
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isDraggingFilePreview.current) return;
      const delta = dragFilePreviewStartY.current - e.clientY;
      const newH = Math.max(52, Math.min(420, dragFilePreviewStartH.current + delta));
      setFilePreviewHeight(newH);
    };
    const handleUp = () => { isDraggingFilePreview.current = false; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Forge stacked-runs state
  const [forgeRuns, setForgeRuns] = useState<ForgeRun[]>(result.forge ?? []);
  const [forgeRunning, setForgeRunning] = useState(false);
  const [forgeSource, setForgeSource] = useState<ForgeSource>('winner');
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [activeForgeRunId, setActiveForgeRunId] = useState<string | null>(
    result.forge && result.forge.length > 0 ? result.forge[result.forge.length - 1].id : null
  );

  // winner/loser for source picker
  const winnerId = result.winnerId;
  const winnerTeam = teams.find((t) => t.id === winnerId);
  const loserTeam = teams.find((t) => t.id !== winnerId);

  async function triggerForge() {
    setForgeRunning(true);
    setForgeError(null);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/forge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: forgeSource }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        // 409 "already in progress" means forge IS running — keep forgeRunning=true
        if (res.status === 409 && body.error?.toLowerCase().includes('in progress')) {
          return; // polling will detect completion
        }
        setForgeError(body.error ?? 'Forge failed to start');
        setForgeRunning(false);
      }
      // 202 success — keep forgeRunning=true; polling below will clear it when done
    } catch {
      setForgeError('Network error');
      setForgeRunning(false);
    }
  }

  // Poll for new forge runs while forgeRunning OR comp is in FORGING state
  const forgePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const shouldPoll = forgeRunning || comp?.state === 'FORGING';
    if (!shouldPoll) {
      if (forgePollRef.current) { clearInterval(forgePollRef.current); forgePollRef.current = null; }
      return;
    }
    if (forgePollRef.current) return;
    forgePollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/competitions/${competitionId}/forge`);
        if (!res.ok) return;
        const data = await res.json() as { status?: string; runs?: ForgeRun[] };
        if (Array.isArray(data.runs)) {
          setForgeRuns(data.runs);
          setActiveForgeRunId((prev) => prev ?? (data.runs!.length > 0 ? data.runs![data.runs!.length - 1].id : null));
        }
        // Clear forgeRunning once the server confirms forge is no longer running
        if (data.status && data.status !== 'forging') {
          setForgeRunning(false);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (forgePollRef.current) { clearInterval(forgePollRef.current); forgePollRef.current = null; } };
  }, [comp?.state, forgeRunning, competitionId]);

  const tabStyle = (tab: 'scores' | 'presentations' | 'files' | 'synthesis' | 'forge'): React.CSSProperties => ({
    fontSize: '0.62rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
    padding: '0.65rem 1rem',
    color: activeTab === tab ? '#c8eef8' : '#1e4a5a',
    background: 'none', border: 'none', cursor: 'pointer',
    borderBottom: activeTab === tab ? '2px solid #00f0ff' : '2px solid transparent',
    transition: 'all 0.15s', fontFamily: 'inherit',
  });

  function downloadPresentation(pres: TeamPresentation) {
    const lines = [
      `# Presentation — ${pres.model}`,
      '',
      `## Approach`,
      pres.approach,
      '',
      `## Key Insight`,
      pres.keyInsight,
      '',
      `## Deliverable Summary`,
      pres.deliverableSummary,
      '',
      `## Criteria Findings`,
      ...(pres.criterionFindings ?? []).flatMap((f) => [
        `### ${f.criterionId}`,
        f.finding,
        f.strength ? `**Strength:** ${f.strength}` : '',
        f.gap ? `**Gap:** ${f.gap}` : '',
        '',
      ]),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `presentation-${pres.model.replace(':', '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function runSynthesis() {
    setSynthRunning(true);
    setSynthError(null);
    try {
      const res = await fetch(`/api/competitions/${competitionId}/synthesis`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setSynthError(body.error ?? 'Synthesis failed');
      }
      // Result will appear via polling (existing result polling loop or re-fetch)
    } catch {
      setSynthError('Network error — could not start synthesis');
    } finally {
      setSynthRunning(false);
    }
  }

  return (
    <div className="arena-celebration" style={{
      borderTop: '2px solid rgba(0,240,255,0.4)',
      background: 'rgba(0,4,8,0.98)',
      ...(maximized
        ? { flex: 1, minHeight: 0, flexShrink: 1 }
        : { flexShrink: 0, height: `${height}px` }),
      overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      transition: 'none',
    }}>
      {/* Header strip */}
      <div style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0 1.4rem', height: `${SCORE_DRAWER_COLLAPSED}px`, minHeight: `${SCORE_DRAWER_COLLAPSED}px`,
        flexShrink: 0,
        borderBottom: isExpanded ? '1px solid #0a2235' : 'none',
      }}>
        <button
          onClick={onToggle}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            color: '#c8eef8', textAlign: 'left', flex: 1, minWidth: 0, padding: 0,
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
            color: '#1e4a5a', fontSize: '0.72rem', flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: '0.3px',
          }}>
            {scoreSummary}
          </span>
          <span style={{
            color: '#4a8fa8', fontSize: '0.72rem', flexShrink: 0,
            background: 'rgba(10,34,53,0.4)', padding: '0.25rem 0.6rem', borderRadius: '4px',
          }}>
            {isExpanded ? '▲ hide' : '▼ details'}
          </span>
        </button>
        <button
          onClick={onMaximize}
          title={maximized ? 'Restore split view' : 'Maximize results panel'}
          style={{
            flexShrink: 0, background: 'none', border: '1px solid #0a2235',
            color: '#4a8fa8', fontSize: '0.75rem', cursor: 'pointer',
            padding: '0.25rem 0.55rem', borderRadius: '4px', fontFamily: 'inherit',
            transition: 'all 0.15s', lineHeight: 1,
          }}
        >
          {maximized ? '⤡' : '⤢'}
        </button>
      </div>

      {/* Expanded body */}
      {isExpanded && (
        <>
          {/* Tab strip */}
          <div
            className="arena-tab-bar"
            style={{
              background: '#000408',
              borderBottom: '1px solid #0a2235',
              padding: '0 1.25rem',
              display: 'flex', gap: 0,
              flexShrink: 0,
            }}
          >
            <button style={tabStyle('scores')} onClick={() => setActiveTab('scores')}>SCORES</button>
            {hasPresentations && (
              <button style={tabStyle('presentations')} onClick={() => setActiveTab('presentations')}>PRESENTATIONS</button>
            )}
            <button style={tabStyle('files')} onClick={() => setActiveTab('files')}>
              FILES{totalFileCount > 0 ? ` (${totalFileCount})` : ''}
            </button>
            <button style={tabStyle('synthesis')} onClick={() => setActiveTab('synthesis')}>SYNTHESIS</button>
            <button style={tabStyle('forge')} onClick={() => setActiveTab('forge')}>
              FORGE{forgeRuns.length > 0 ? ` (${forgeRuns.length})` : ''}
            </button>
          </div>
          {/* E3: Keyboard hint */}
          <div style={{
            textAlign: 'right', fontSize: '0.52rem', color: '#3d7d94',
            padding: '0.2rem 1.25rem 0',
            letterSpacing: '0.5px', flexShrink: 0,
          }}>
            [1–5] switch tabs · [Esc] close modal
          </div>

          {/* Tab content */}
          <div className="arena-scrollbar" style={{ overflowY: 'auto', flex: 1, padding: 0 }}>

            {/* SCORES TAB */}
            {activeTab === 'scores' && (
              <div style={{ padding: '0' }}>
                {/* Total score header row */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `200px repeat(${teamDisplays.length}, 1fr) 120px`,
                  background: '#020b14',
                  borderBottom: '2px solid #0e3050',
                  padding: '0.5rem 1rem',
                  position: 'sticky', top: 0, zIndex: 2,
                }}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', display: 'flex', alignItems: 'center' }}>
                    CRITERION
                  </div>
                  {teamDisplays.map(({ result: tr, label, color, isWinner }) => (
                    <div key={tr.teamId} style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', marginBottom: '0.2rem' }}>
                        {isWinner && <span style={{ fontSize: '0.8rem' }}>🏆</span>}
                        <ModelBadge model={label.split(':')[0]} />
                      </div>
                      <div style={{ fontSize: '0.65rem', color, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 900, color: isWinner ? '#eab308' : '#c8eef8', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                        {Math.round(tr.totalScore * 100 * scoreProgress)}%
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    WINNER
                  </div>
                </div>

                {/* Criterion rows */}
                {(() => {
                  const criteria = teamDisplays[0]?.result.criteriaScores ?? [];
                  return criteria.map((cs) => {
                    const isOpen = selectedCriterionId === cs.criterionId;
                    const scoresForCrit = teamDisplays.map((td) => ({
                      ...td,
                      cs: td.result.criteriaScores.find(c => c.criterionId === cs.criterionId),
                    }));
                    const winnerForCrit = scoresForCrit.reduce((best, cur) =>
                      (cur.cs?.score ?? 0) > (best.cs?.score ?? 0) ? cur : best
                    );
                    return (
                      <div key={cs.criterionId}>
                        {/* Criterion row */}
                        <div
                          onClick={() => setSelectedCriterionId(isOpen ? null : cs.criterionId)}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: `200px repeat(${teamDisplays.length}, 1fr) 120px`,
                            padding: '0.55rem 1rem',
                            borderBottom: '1px solid rgba(10,34,53,0.5)',
                            cursor: 'pointer',
                            background: isOpen ? 'rgba(0,240,255,0.05)' : 'transparent',
                            transition: 'background 0.1s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ fontSize: '0.62rem', color: isOpen ? '#00f0ff' : '#3d7d94', flexShrink: 0 }}>
                              {isOpen ? '▼' : '▶'}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: isOpen ? '#7cc6db' : '#4a8fa8', fontWeight: isOpen ? 700 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {cs.criterionId}
                            </span>
                          </div>
                          {scoresForCrit.map(({ result: tr, color, isWinner, cs: crit }) => {
                            const maxScore = crit?.maxScore ?? 10;
                            const pct = maxScore > 0 && crit ? (crit.score / maxScore) * 100 : 0;
                            return (
                              <div key={tr.teamId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                <div style={{ width: '50px', height: '4px', background: '#0a2235', borderRadius: '2px', overflow: 'hidden' }}>
                                  <div
                                    className="arena-progress-bar"
                                    style={{ height: '100%', width: `${pct * scoreProgress}%`, background: isWinner ? '#eab308' : color, borderRadius: '2px' }}
                                  />
                                </div>
                                <span style={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: 'monospace', color: isWinner ? '#eab308' : '#c8eef8', flexShrink: 0 }}>
                                  {crit ? Math.round((crit.score / maxScore) * 100 * scoreProgress) : 0}%
                                </span>
                              </div>
                            );
                          })}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: '3px',
                              letterSpacing: '0.5px', color: winnerForCrit.color,
                              background: `rgba(${hexToRgb(winnerForCrit.color)},0.12)`,
                              border: `1px solid rgba(${hexToRgb(winnerForCrit.color)},0.3)`,
                            }}>
                              {winnerForCrit.label.split(':')[0].toUpperCase()}
                            </span>
                          </div>
                        </div>

                        {/* Expandable commentary row */}
                        {isOpen && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: `repeat(${teamDisplays.length}, 1fr)`,
                            gap: 0,
                            background: '#020b14',
                            borderBottom: '1px solid #0a2235',
                          }}>
                            {scoresForCrit.map(({ result: tr, label, color, cs: crit }, colIdx) => (
                              <div
                                key={tr.teamId}
                                style={{
                                  padding: '0.75rem 1rem',
                                  borderRight: colIdx < teamDisplays.length - 1 ? '1px solid #0a2235' : 'none',
                                  borderLeft: `2px solid rgba(${hexToRgb(color)},0.4)`,
                                }}
                              >
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color, letterSpacing: '0.5px', marginBottom: '0.35rem' }}>
                                  {label}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#4a8fa8', lineHeight: 1.6, fontStyle: 'italic' }}>
                                  {crit?.commentary || <span style={{ color: '#1e4a5a' }}>No commentary</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}

                {result.summary && (
                  <div style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: '#4a8fa8', lineHeight: 1.7, borderTop: '1px solid #0a2235' }}>
                    {result.summary}
                  </div>
                )}
              </div>
            )}

            {/* PRESENTATIONS TAB — human-readable summaries of each team's work */}
            {activeTab === 'presentations' && hasPresentations && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                {/* Column grid — one column per team */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${result.presentations!.length}, 1fr)`,
                  flex: 1, minHeight: 0,
                }}>
                  {result.presentations!.map((pres, presIdx) => {
                    const label = resolveLabel(teams, pres.teamId, pres.teamId);
                    const color = LANE_COLORS[presIdx] ?? '#4a8fa8';
                    const rgb = hexToRgb(color);
                    const isWinner = pres.teamId === result.winnerId;

                    return (
                      <div
                        key={pres.teamId}
                        className="arena-scrollbar"
                        style={{
                          borderRight: presIdx < result.presentations!.length - 1 ? '1px solid #0a2235' : 'none',
                          overflowY: 'auto',
                          display: 'flex', flexDirection: 'column',
                        }}
                      >
                        {/* Sticky column header */}
                        <div style={{
                          position: 'sticky', top: 0, zIndex: 2,
                          background: `rgba(${rgb},0.08)`,
                          borderBottom: `1px solid rgba(${rgb},0.2)`,
                          padding: '0.6rem 1rem',
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          flexShrink: 0,
                        }}>
                          {isWinner && <span style={{ fontSize: '0.85rem' }}>🏆</span>}
                          <span style={{ fontSize: '0.72rem', fontWeight: 800, color: isWinner ? '#eab308' : color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>
                            {label}
                          </span>
                          <span style={{ fontSize: '0.6rem', color: '#1e4a5a', fontStyle: 'italic' }}>({pres.model})</span>
                          <button
                            onClick={() => setPresentationModal(pres)}
                            style={{ fontSize: '0.58rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#7cc6db', cursor: 'pointer', fontFamily: 'monospace' }}
                          >⤢</button>
                          <button
                            onClick={() => downloadPresentation(pres)}
                            style={{ fontSize: '0.58rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.3)', color: '#00f0ff', cursor: 'pointer', fontFamily: 'monospace' }}
                          >↓ MD</button>
                        </div>

                        {/* Approach */}
                        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(10,34,53,0.4)' }}>
                          <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Approach</div>
                          <div style={{ fontSize: '0.75rem', color: '#7cc6db', lineHeight: 1.6 }}>{pres.approach}</div>
                        </div>

                        {/* Key insight */}
                        <div style={{ padding: '0.65rem 1rem', borderBottom: '1px solid rgba(10,34,53,0.4)', background: 'rgba(0,240,255,0.03)' }}>
                          <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#00f0ff', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Key Insight</div>
                          <div style={{ fontSize: '0.72rem', color: '#c8eef8', lineHeight: 1.6, fontStyle: 'italic' }}>{pres.keyInsight}</div>
                        </div>

                        {/* Criterion findings — click each to expand */}
                        {pres.criterionFindings.map((cf) => {
                          const cfKey = `${pres.teamId}:${cf.criterionId}`;
                          const isOpen = selectedCriterionId === cfKey;
                          return (
                            <div
                              key={cf.criterionId}
                              onClick={() => setSelectedCriterionId(isOpen ? null : cfKey)}
                              style={{
                                padding: '0.5rem 1rem',
                                borderBottom: '1px solid rgba(10,34,53,0.35)',
                                cursor: 'pointer',
                                background: isOpen ? 'rgba(0,240,255,0.04)' : 'transparent',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                <span style={{ fontSize: '0.58rem', color: isOpen ? '#00f0ff' : '#3d7d94' }}>{isOpen ? '▼' : '▶'}</span>
                                <code style={{ fontSize: '0.6rem', color: '#4a6080', background: '#000408', padding: '0.1rem 0.35rem', borderRadius: '3px', border: '1px solid #0a2235' }}>{cf.criterionId}</code>
                              </div>
                              {isOpen && (
                                <div style={{ marginTop: '0.4rem', paddingLeft: '0.9rem' }}>
                                  <div style={{ fontSize: '0.72rem', color: '#7cc6db', lineHeight: 1.6, marginBottom: '0.3rem' }}>{cf.finding}</div>
                                  {cf.strength && (
                                    <div style={{ fontSize: '0.65rem', color: '#00f0ff', marginBottom: '0.15rem' }}>
                                      <span style={{ fontWeight: 700 }}>+</span> {cf.strength}
                                    </div>
                                  )}
                                  {cf.gap && (
                                    <div style={{ fontSize: '0.65rem', color: '#ef444488' }}>
                                      <span style={{ fontWeight: 700 }}>−</span> {cf.gap}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* Deliverable summary */}
                        <div style={{ padding: '0.65rem 1rem', marginTop: 'auto' }}>
                          <div style={{ fontSize: '0.58rem', fontWeight: 800, color: '#3d7d94', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Deliverables</div>
                          <div style={{ fontSize: '0.68rem', color: '#4a8fa8', lineHeight: 1.6 }}>{pres.deliverableSummary}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {activeTab === 'presentations' && !hasPresentations && (
              <div style={{ padding: '3rem', textAlign: 'center', color: '#1e4a5a', fontSize: '0.8rem', fontStyle: 'italic' }}>
                Presentations not available for this competition.
              </div>
            )}

            {/* FILES TAB */}
            {activeTab === 'files' && (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

                {/* ── Primary: deliverable files ── */}
                {hasFiles && (
                  <>
                    {/* Column grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${result.deliverables!.length}, 1fr)`,
                      flex: 1, minHeight: 0, overflow: 'hidden',
                    }}>
                      {result.deliverables!.map((td, tdIdx) => {
                        const label = resolveLabel(teams, td.teamId, td.teamId);
                        const color = LANE_COLORS[tdIdx] ?? '#4a8fa8';
                        const rgb = hexToRgb(color);
                        return (
                          <div
                            key={td.teamId}
                            className="arena-scrollbar"
                            style={{
                              borderRight: tdIdx < result.deliverables!.length - 1 ? '1px solid #0a2235' : 'none',
                              overflowY: 'auto', display: 'flex', flexDirection: 'column',
                            }}
                          >
                            {/* Sticky column header */}
                            <div style={{
                              position: 'sticky', top: 0, zIndex: 2,
                              background: `rgba(${rgb},0.08)`,
                              borderBottom: `1px solid rgba(${rgb},0.2)`,
                              padding: '0.55rem 0.85rem',
                              display: 'flex', alignItems: 'center', gap: '0.5rem',
                              flexShrink: 0,
                            }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>
                                {label}
                              </span>
                              <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>{td.files.length} files</span>
                              <a
                                href={`/api/competitions/${competitionId}/deliverables/${td.teamId}/download`}
                                download
                                style={{
                                  fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.5rem',
                                  borderRadius: '4px', background: 'rgba(0,240,255,0.08)',
                                  border: '1px solid rgba(0,240,255,0.3)', color: '#00f0ff',
                                  textDecoration: 'none', letterSpacing: '0.5px',
                                }}
                              >
                                📦 ZIP
                              </a>
                            </div>

                            {td.files.length === 0 && (
                              <div style={{ padding: '0.75rem 0.85rem', fontSize: '0.72rem', color: '#1e4a5a', fontStyle: 'italic' }}>
                                No files submitted
                              </div>
                            )}

                            {td.files.map((file) => {
                              const isSelected = selectedFileKey?.teamId === td.teamId && selectedFileKey?.path === file.path;
                              return (
                                <div
                                  key={file.path}
                                  onClick={() => setSelectedFileKey(isSelected ? null : { teamId: td.teamId, path: file.path })}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.4rem 0.85rem',
                                    borderBottom: '1px solid rgba(10,34,53,0.4)',
                                    cursor: 'pointer',
                                    background: isSelected ? 'rgba(0,240,255,0.07)' : 'transparent',
                                    borderLeft: isSelected ? `2px solid #00f0ff` : '2px solid transparent',
                                  }}
                                >
                                  <span style={{ fontSize: '0.7rem', flexShrink: 0 }}>📄</span>
                                  <span style={{ fontSize: '0.72rem', color: isSelected ? '#e4f8ff' : '#7cc6db', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {file.path}
                                  </span>
                                  <span style={{ fontSize: '0.6rem', color: '#1e4a5a', flexShrink: 0 }}>
                                    {(file.content.length / 1024).toFixed(1)} KB
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>

                    {/* File preview panel — only shown when a file is selected */}
                    {selectedFileKey && (() => {
                      const teamDel = result.deliverables!.find(td => td.teamId === selectedFileKey.teamId);
                      const file = teamDel?.files.find(f => f.path === selectedFileKey.path);
                      if (!file) return null;
                      const teamIdx = result.deliverables!.findIndex(td => td.teamId === selectedFileKey.teamId);
                      const color = LANE_COLORS[teamIdx] ?? '#4a8fa8';
                      const rgb = hexToRgb(color);
                      const label = resolveLabel(teams, selectedFileKey.teamId, selectedFileKey.teamId);
                      return (
                        <>
                          {/* Resize handle */}
                          <div
                            style={{
                              flexShrink: 0, height: '5px', background: '#0a2235',
                              cursor: 'ns-resize', position: 'relative', transition: 'background 0.15s',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(0,240,255,0.5)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#0a2235'; }}
                            onMouseDown={(e) => {
                              isDraggingFilePreview.current = true;
                              dragFilePreviewStartY.current = e.clientY;
                              dragFilePreviewStartH.current = filePreviewHeight;
                              e.preventDefault();
                            }}
                          >
                            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '40px', height: '3px', borderRadius: '2px', background: 'rgba(255,255,255,0.12)' }} />
                          </div>

                          {/* Preview panel */}
                          <div style={{
                            flexShrink: 0, height: `${filePreviewHeight}px`,
                            borderTop: '2px solid rgba(0,240,255,0.3)',
                            background: '#020b14', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                          }}>
                            {/* Preview header */}
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: '0.6rem',
                              padding: '0.4rem 0.85rem', borderBottom: '1px solid #0a2235',
                              background: '#010810', flexShrink: 0,
                            }}>
                              <span style={{ fontSize: '0.7rem' }}>📄</span>
                              <span style={{ fontSize: '0.72rem', color: '#00f0ff', fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {file.path}
                              </span>
                              <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0.15rem 0.45rem', borderRadius: '3px', background: `rgba(${rgb},0.12)`, color, flexShrink: 0 }}>
                                {label}
                              </span>
                              <span style={{ fontSize: '0.6rem', color: '#3d7d94', flexShrink: 0 }}>
                                {(file.content.length / 1024).toFixed(1)} KB
                              </span>
                              <a
                                href={`/api/competitions/${competitionId}/deliverables/${selectedFileKey.teamId}/download`}
                                download
                                style={{ fontSize: '0.6rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#4a8fa8', textDecoration: 'none' }}
                              >
                                ↓
                              </a>
                              <button
                                onClick={() => setFileModalContent({ path: file.path, content: file.content })}
                                style={{ fontSize: '0.6rem', padding: '0.15rem 0.45rem', borderRadius: '3px', background: 'transparent', border: '1px solid #0a2235', color: '#4a8fa8', cursor: 'pointer', fontFamily: 'monospace' }}
                              >
                                ⤢ Full
                              </button>
                            </div>

                            {/* Scrollable file content */}
                            <div
                              className="arena-scrollbar"
                              style={{
                                flex: 1, overflowY: 'auto', padding: '0.65rem 1rem',
                                fontFamily: "'SF Mono', 'Fira Code', monospace",
                                fontSize: '0.7rem', color: '#7cc6db', lineHeight: 1.6,
                                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                              }}
                            >
                              {file.content}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}

                {/* ── Fallback: event-captured files ── */}
                {!hasFiles && (
                  <>
                    {!fileEventsByTeam || fileEventsByTeam.every((t) => t.files.length === 0) ? (
                      <div style={{ padding: '3rem', textAlign: 'center', color: '#1e4a5a', fontSize: '0.78rem', fontStyle: 'italic' }}>
                        No files recorded for this competition.
                      </div>
                    ) : (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${Math.min(fileEventsByTeam.length, 3)}, 1fr)`,
                        flex: 1, minHeight: 0, overflow: 'hidden',
                      }}>
                        {fileEventsByTeam.map((teamFiles, tdIdx) => {
                          const label = resolveLabel(teams, teamFiles.teamId, teamFiles.teamId);
                          const color = LANE_COLORS[tdIdx] ?? '#4a8fa8';
                          const rgb = hexToRgb(color);
                          return (
                            <div key={teamFiles.teamId} className="arena-scrollbar" style={{ borderRight: tdIdx < fileEventsByTeam.length - 1 ? '1px solid #0a2235' : 'none', overflowY: 'auto' }}>
                              <div style={{ position: 'sticky', top: 0, zIndex: 2, background: `rgba(${rgb},0.08)`, borderBottom: `1px solid rgba(${rgb},0.2)`, padding: '0.55rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontSize: '0.7rem', fontWeight: 800, color, letterSpacing: '1px', textTransform: 'uppercase', flex: 1 }}>{label}</span>
                                <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>{teamFiles.files.length} files</span>
                              </div>
                              {teamFiles.files.length === 0 ? (
                                <div style={{ padding: '0.75rem', fontSize: '0.72rem', color: '#1e4a5a', fontStyle: 'italic' }}>No files recorded</div>
                              ) : (
                                teamFiles.files.map((f, fIdx) => (
                                  <div key={fIdx} style={{ borderBottom: fIdx < teamFiles.files.length - 1 ? '1px solid #0a2235' : 'none' }}>
                                    <div style={{ padding: '0.3rem 0.85rem', background: '#000408', fontSize: '0.68rem', color: '#4a8fa8', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{ color: '#00f0ff' }}>📄</span>
                                      <span>{f.path}</span>
                                    </div>
                                    <pre style={{ fontSize: '0.72rem', color: f.content ? '#d8f0fa' : '#1e4a5a', whiteSpace: 'pre-wrap', fontFamily: "'SF Mono', 'Fira Code', monospace", lineHeight: 1.6, margin: 0, padding: '0.65rem 1rem', background: '#010810', overflowX: 'auto', fontStyle: f.content ? 'normal' : 'italic' }}>
                                      {f.content ? (f.content.length > 3000 ? `${f.content.slice(0, 3000)}\n\n… (truncated)` : f.content) : '(no content captured)'}
                                    </pre>
                                  </div>
                                ))
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* SYNTHESIS TAB */}
            {activeTab === 'synthesis' && (
              <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                {result.synthesis ? (
                  <>
                    {/* Header — what synthesis is */}
                    <div style={{ marginBottom: '1.2rem', padding: '0.8rem 1rem', background: 'rgba(0,240,255,0.06)', border: '1px solid rgba(0,240,255,0.2)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>🔬</span>
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#00f0ff', letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI Synthesis</div>
                        <div style={{ fontSize: '0.65rem', color: '#4a8fa8', marginTop: '0.1rem' }}>The best elements from all submissions merged into a single hybrid solution</div>
                      </div>
                    </div>

                    {/* Overall thesis */}
                    {result.synthesis.overallRationale && (
                      <div style={{
                        marginBottom: '1.2rem', padding: '0.85rem 1rem',
                        background: 'rgba(0,240,255,0.06)', border: '1px solid rgba(0,240,255,0.2)',
                        borderRadius: '8px',
                      }}>
                        <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#00f0ff', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                          Synthesis Thesis
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#c8eef8', lineHeight: 1.7 }}>
                          {result.synthesis.overallRationale}
                        </div>
                      </div>
                    )}

                    {/* Per-criterion breakdown */}
                    {(result.synthesis.perCriterion?.length ?? 0) > 0 && (
                      <div style={{ marginBottom: '1.4rem', background: '#010810', border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ padding: '0.5rem 0.9rem', background: '#000408', borderBottom: '1px solid #0a2235', fontSize: '0.6rem', fontWeight: 800, color: '#4a6080', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                          Criterion-by-criterion verdict
                        </div>
                        <div style={{ padding: '0.4rem 0' }}>
                          {(result.synthesis.perCriterion ?? []).map((entry, i) => {
                            const winnerTeam = teams.find(t => t.id === entry.teamId);
                            const teamColor = winnerTeam ? getModelColor(winnerTeam.model) : '#4a8fa8';
                            const winnerLabel = resolveLabel(teams, entry.teamId, entry.teamId);
                            return (
                              <div key={entry.criterionId} style={{
                                padding: '0.7rem 0.9rem',
                                borderBottom: i < (result.synthesis?.perCriterion?.length ?? 1) - 1 ? '1px solid rgba(10,34,53,0.6)' : 'none',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                                  <code style={{ fontSize: '0.62rem', color: '#4a6080', background: '#000408', padding: '0.15rem 0.4rem', borderRadius: '3px', border: '1px solid #0a2235', whiteSpace: 'nowrap' }}>{entry.criterionId}</code>
                                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: teamColor }}>{winnerLabel} wins</span>
                                </div>

                                {/* Winning approach */}
                                {entry.winningApproach && (
                                  <div style={{ fontSize: '0.72rem', color: '#d8f0fa', lineHeight: 1.6, marginBottom: '0.3rem' }}>
                                    <span style={{ color: '#00f0ff', fontWeight: 700, marginRight: '0.3rem' }}>Selected:</span>
                                    {entry.winningApproach}
                                  </div>
                                )}

                                {/* Losing approach */}
                                {entry.losingApproach && (
                                  <div style={{ fontSize: '0.68rem', color: '#4a8fa8', lineHeight: 1.5, marginBottom: '0.3rem' }}>
                                    <span style={{ color: '#1e4a5a', fontWeight: 700, marginRight: '0.3rem' }}>Alternative:</span>
                                    {entry.losingApproach}
                                  </div>
                                )}

                                {/* Rationale */}
                                <div style={{ fontSize: '0.68rem', color: '#4a8fa8', fontStyle: 'italic', lineHeight: 1.5 }}>
                                  {entry.rationale}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Synthesized solution */}
                    <details style={{ background: '#000408', border: '1px solid #0a2235', borderRadius: '8px', overflow: 'hidden', marginBottom: '0.8rem' }}>
                      <summary style={{
                        padding: '0.5rem 0.9rem', background: '#010810',
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
                            style={{ fontSize: '0.58rem', color: '#4a6080', background: 'none', border: '1px solid #0a2235', borderRadius: '4px', padding: '0.15rem 0.5rem', cursor: 'pointer', fontFamily: 'monospace' }}
                          >
                            📋 copy
                          </button>
                          <span style={{ fontSize: '0.6rem', color: '#1e4a5a' }}>▼</span>
                        </div>
                      </summary>
                      <div style={{ padding: '1rem', borderTop: '1px solid #0a2235', fontFamily: "-apple-system, 'Segoe UI', sans-serif", fontSize: '0.78rem', lineHeight: 1.7, color: '#d8f0fa' }}>
                        {renderedSynthesis}
                      </div>
                    </details>
                  </>
                ) : (
                  <div style={{
                    textAlign: 'center', padding: '4rem 2rem',
                    background: '#050f1e', border: '1px solid #0a2235', borderRadius: '8px',
                  }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🔮</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#e4f8ff', marginBottom: '0.5rem' }}>
                      Synthesize a Hybrid Solution
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#7cc6db', maxWidth: '400px', margin: '0 auto 1.5rem', lineHeight: 1.7 }}>
                      Ask AI to merge the best elements from all teams into a single unified deliverable,
                      with per-criterion attribution showing what came from whom.
                    </div>
                    {synthError && (
                      <div style={{ fontSize: '0.68rem', color: '#ef4444', marginBottom: '1rem' }}>{synthError}</div>
                    )}
                    <button
                      onClick={runSynthesis}
                      disabled={synthRunning}
                      style={{
                        fontSize: '0.72rem', fontWeight: 800, padding: '0.6rem 1.5rem',
                        borderRadius: '6px', background: 'rgba(0,240,255,0.12)',
                        border: '1px solid rgba(0,240,255,0.4)', color: '#00f0ff',
                        cursor: synthRunning ? 'not-allowed' : 'pointer',
                        fontFamily: 'monospace', letterSpacing: '1.5px', textTransform: 'uppercase',
                        opacity: synthRunning ? 0.6 : 1,
                      }}
                    >
                      {synthRunning ? '🔮 Running…' : '🔮 Run Synthesis'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* FORGE TAB — source picker + stacked runs */}
            {activeTab === 'forge' && (
              <div style={{ maxWidth: '760px', margin: '0 auto' }}>
                {/* Source picker */}
                <div style={{
                  background: '#050f1e', border: '1px dashed #0a2235', borderRadius: '8px',
                  padding: '1.5rem', textAlign: 'center', marginBottom: '1rem',
                }}>
                  <div style={{ fontSize: '0.62rem', color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.85rem' }}>
                    ⚒ Forge a new set of artifacts from
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {([
                      { value: 'winner' as ForgeSource, label: `🏆 Winner (${winnerTeam?.model ?? '?'})`, disabled: false },
                      { value: 'loser' as ForgeSource, label: `📋 Loser (${loserTeam?.model ?? '?'})`, disabled: false },
                      { value: 'synthesis' as ForgeSource, label: '🔮 Synthesis', disabled: !result.synthesis },
                    ] as const).map(({ value, label, disabled }) => (
                      <button
                        key={value}
                        disabled={disabled}
                        onClick={() => setForgeSource(value)}
                        style={{
                          padding: '0.5rem 1rem', borderRadius: '6px',
                          border: `1.5px solid ${forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.6)' : '#00f0ff') : '#0a2235'}`,
                          background: forgeSource === value ? (value === 'winner' ? 'rgba(255,102,0,0.1)' : 'rgba(0,240,255,0.08)') : '#050f1e',
                          color: disabled ? '#1e4a5a' : forgeSource === value ? (value === 'winner' ? '#ff6600' : '#00f0ff') : '#7cc6db',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          fontSize: '0.68rem', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.5px',
                        }}
                      >
                        {label}
                        {disabled && ' (run synthesis first)'}
                      </button>
                    ))}
                  </div>
                  {forgeError && <div style={{ fontSize: '0.65rem', color: '#ef4444', marginBottom: '0.75rem' }}>{forgeError}</div>}
                  <button
                    onClick={triggerForge}
                    disabled={forgeRunning || comp?.state === 'FORGING'}
                    style={{
                      fontSize: '0.72rem', fontWeight: 800, padding: '0.55rem 1.4rem',
                      borderRadius: '6px', background: 'rgba(0,240,255,0.12)',
                      border: '1px solid rgba(0,240,255,0.4)', color: '#00f0ff',
                      cursor: forgeRunning ? 'not-allowed' : 'pointer',
                      fontFamily: 'monospace', letterSpacing: '1.5px', textTransform: 'uppercase',
                      opacity: forgeRunning ? 0.6 : 1,
                    }}
                  >
                    {forgeRunning || comp?.state === 'FORGING' ? '⚒ Forging…' : '⚒ Forge This'}
                  </button>
                </div>

                {/* Stacked runs list */}
                {forgeRuns.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                      Previous forge runs
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                      {[...forgeRuns].reverse().map((run, idx) => {
                        const sourceLabel = run.source === 'winner' ? '🏆 Winner' : run.source === 'loser' ? '📋 Loser' : '🔮 Synthesis';
                        const runNum = forgeRuns.length - idx;
                        const isActive = activeForgeRunId === run.id;
                        return (
                          <div
                            key={run.id}
                            style={{
                              background: '#050f1e',
                              border: `1px solid ${isActive ? '#0e3050' : '#0a2235'}`,
                              borderRadius: '8px', padding: '0.9rem',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                              <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#e4f8ff' }}>
                                {sourceLabel} — Run #{runNum}
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.58rem', color: '#3d7d94' }}>
                                  {run.artifacts.length} artifacts
                                </span>
                                <a
                                  href={`/api/competitions/${competitionId}/forge/${run.id}/download`}
                                  download
                                  style={{
                                    fontSize: '0.6rem', padding: '0.18rem 0.5rem', borderRadius: '4px',
                                    background: 'transparent', border: '1px solid #0a2235', color: '#7cc6db',
                                    textDecoration: 'none', fontFamily: 'monospace', fontWeight: 700,
                                  }}
                                >
                                  ↓ ZIP
                                </a>
                                <button
                                  onClick={() => setActiveForgeRunId(isActive ? null : run.id)}
                                  style={{
                                    fontSize: '0.6rem', padding: '0.18rem 0.5rem', borderRadius: '4px',
                                    background: isActive ? 'rgba(0,240,255,0.1)' : 'transparent',
                                    border: `1px solid ${isActive ? 'rgba(0,240,255,0.4)' : '#0a2235'}`,
                                    color: isActive ? '#00f0ff' : '#7cc6db',
                                    cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700,
                                  }}
                                >
                                  {isActive ? 'Hide' : 'View'}
                                </button>
                              </div>
                            </div>
                            {/* Artifact chips */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: isActive ? '0.75rem' : 0 }}>
                              {run.artifacts.map((a) => (
                                <span key={a.type} style={{
                                  fontSize: '0.58rem', padding: '0.12rem 0.4rem', borderRadius: '3px', fontWeight: 700, letterSpacing: '0.5px',
                                  background: a.universal ? 'rgba(0,212,255,0.1)' : 'rgba(0,102,255,0.1)',
                                  color: a.universal ? '#00d4ff' : '#0066ff',
                                }}>
                                  {a.title}
                                </span>
                              ))}
                            </div>
                            {/* Expanded artifact view */}
                            {isActive && run.artifacts.map((artifact) => (
                              <div key={artifact.type} style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid #0a2235' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#00f0ff', marginBottom: '0.4rem', letterSpacing: '0.5px' }}>
                                  {artifact.title}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: '#7cc6db', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                                  {artifact.content}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </>
      )}

      {/* E2: Winner announcement banner */}
      {showWinnerBanner && winnerLabel && (
        <div style={{
          position: 'fixed', top: '1.5rem', left: '50%',
          zIndex: 9999,
          background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.5)',
          borderRadius: '8px', padding: '0.75rem 2rem',
          color: '#00f0ff', fontSize: '0.85rem', fontWeight: 700,
          letterSpacing: '2px', textTransform: 'uppercase',
          animation: 'winnerBanner 4s ease forwards',
          backdropFilter: 'blur(8px)',
          pointerEvents: 'none',
        }}>
          🏆 {winnerLabel} wins
        </div>
      )}

      {/* Presentation modal */}
      {presentationModal && (
        <div
          onClick={() => setPresentationModal(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,4,8,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
              width: 'min(680px, 92vw)', maxHeight: '82vh',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: '0.9rem 1.2rem', borderBottom: '1px solid #0a2235',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#e4f8ff' }}>
                {presentationModal.model}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={() => downloadPresentation(presentationModal)}
                  style={{
                    fontSize: '0.6rem', fontWeight: 700, padding: '0.2rem 0.55rem',
                    borderRadius: '4px', background: 'rgba(0,240,255,0.08)',
                    border: '1px solid rgba(0,240,255,0.35)', color: '#00f0ff',
                    cursor: 'pointer', fontFamily: 'monospace',
                  }}
                >
                  ↓ Download
                </button>
                <button
                  onClick={() => setPresentationModal(null)}
                  style={{ background: 'none', border: 'none', color: '#3d7d94', cursor: 'pointer', fontSize: '1rem' }}
                >
                  ✕
                </button>
              </div>
            </div>
            {/* Modal body */}
            <div style={{ padding: '1.2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
              {[
                { label: 'APPROACH', content: presentationModal.approach },
                { label: 'KEY INSIGHT', content: presentationModal.keyInsight },
                { label: 'DELIVERABLE SUMMARY', content: presentationModal.deliverableSummary },
              ].map(({ label, content }) => (
                <div key={label}>
                  <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', marginBottom: '0.35rem' }}>{label}</div>
                  <div style={{ fontSize: '0.78rem', color: '#e4f8ff', lineHeight: 1.7 }}>{content}</div>
                </div>
              ))}
              {(presentationModal.criterionFindings ?? []).length > 0 && (
                <div>
                  <div style={{ fontSize: '0.58rem', color: '#3d7d94', letterSpacing: '1.5px', marginBottom: '0.6rem' }}>CRITERIA FINDINGS</div>
                  {presentationModal.criterionFindings.map((f) => (
                    <div key={f.criterionId} style={{ marginBottom: '0.85rem', paddingLeft: '0.7rem', borderLeft: '2px solid #0a2235' }}>
                      <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#00f0ff', marginBottom: '0.25rem' }}>{f.criterionId}</div>
                      <div style={{ fontSize: '0.72rem', color: '#e4f8ff', lineHeight: 1.6, marginBottom: '0.2rem' }}>{f.finding}</div>
                      {f.strength && <div style={{ fontSize: '0.65rem', color: '#7cc6db' }}>Strength: {f.strength}</div>}
                      {f.gap && <div style={{ fontSize: '0.65rem', color: '#7cc6db' }}>Gap: {f.gap}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full-file modal */}
      {fileModalContent && (
        <div
          onClick={() => setFileModalContent(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,4,8,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#050f1e', border: '1px solid #0a2235', borderRadius: '10px',
              width: 'min(760px, 92vw)', maxHeight: '82vh',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{
              padding: '0.85rem 1.1rem', borderBottom: '1px solid #0a2235',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#e4f8ff', fontFamily: 'monospace' }}>
                {fileModalContent.path}
              </span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  onClick={() => navigator.clipboard.writeText(fileModalContent.content)}
                  style={{
                    fontSize: '0.6rem', padding: '0.2rem 0.55rem', borderRadius: '4px',
                    background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.3)',
                    color: '#00f0ff', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700,
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setFileModalContent(null)}
                  style={{ background: 'none', border: 'none', color: '#3d7d94', cursor: 'pointer', fontSize: '1rem' }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div style={{
              padding: '0.85rem 1.1rem', overflowY: 'auto', flex: 1,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: '0.68rem', color: '#7cc6db', lineHeight: 1.7,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {fileModalContent.content}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── State banner ─────────────────────────────────────────────────────────────

const STATE_BANNERS: Partial<Record<CompetitionState | 'PAUSED', {
  icon: string; label: string; sub: string;
  bg: string; border: string; color: string; animate?: string;
}>> = {
  JUDGING:     { icon: '⚖️', label: 'JUDGING IN PROGRESS',    sub: 'AI judge is evaluating all submissions…',        bg: 'rgba(234,179,8,0.10)',  border: 'rgba(234,179,8,0.3)',  color: '#eab308', animate: 'judgingPulse 2s ease-in-out infinite' },
  PAUSED:      { icon: '⏸',  label: 'COMPETITION PAUSED',     sub: 'Resume when ready — clock is frozen.',             bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6' },
  COLLECTING:  { icon: '📦', label: 'COLLECTING DELIVERABLES', sub: 'Gathering files from each agent workspace…',       bg: 'rgba(0,240,255,0.10)', border: 'rgba(0,240,255,0.3)', color: '#00f0ff', animate: 'judgingPulse 2s ease-in-out infinite' },
  PRESENTING:  { icon: '🎤', label: 'GENERATING PRESENTATIONS', sub: 'Translating deliverables into human-readable summaries…', bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.3)', color: '#3b82f6', animate: 'judgingPulse 2s ease-in-out infinite' },
  FORGING:     { icon: '🔨', label: 'FORGING',                 sub: 'Generating build-ready artifacts from the winning solution…', bg: 'rgba(234,179,8,0.10)', border: 'rgba(234,179,8,0.3)', color: '#eab308', animate: 'judgingPulse 2s ease-in-out infinite' },
  FAILED:      { icon: '💥', label: 'COMPETITION FAILED',      sub: 'An error occurred during the competition.',        bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.3)',  color: '#ef4444' },
  CANCELLED:   { icon: '🚫', label: 'COMPETITION CANCELLED',   sub: 'This competition was stopped early.',              bg: 'rgba(136,150,171,0.08)',border: 'rgba(136,150,171,0.2)',color: '#4a8fa8' },
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
      <span style={{ fontSize: '0.67rem', color: '#4a8fa8', fontStyle: 'italic' }}>
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
  const [notes, setNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const notesSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browser notification state
  const notifyOnComplete = useRef(false);
  const [notifyActive, setNotifyActive] = useState(false);
  const [notifyDenied, setNotifyDenied] = useState(false);
  const hasNotifiedRef = useRef(false);

  // E4: Mobile layout
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 700);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Resizable score drawer
  const [scoreDrawerHeight, setScoreDrawerHeight] = useState(SCORE_DRAWER_COLLAPSED);
  const [bottomMaximized, setBottomMaximized] = useState(false);
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
      .then((data: { teams?: Team[]; brief?: Brief; startedAt?: string; state?: CompetitionState; result?: Record<string, unknown> | null; notes?: string | null } | null) => {
        if (!data) return;
        if (Array.isArray(data.teams)) setTeams(data.teams);
        if (data.brief) { setBrief(data.brief); setBriefTitle(data.brief.title ?? ''); }
        if (data.startedAt) setCompetitionStartTime(new Date(data.startedAt).getTime());
        // Hydrate state + result for already-completed competitions (WS won't replay forge events)
        if (data.state) setState(data.state);
        if (data.notes) setNotes(data.notes);
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
            forge: Array.isArray(raw.forge) ? raw.forge as ForgeRun[] : null,
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
      document.title = 'Arena4Ai';
    }
    return () => { document.title = 'Arena4Ai'; };
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
          options: { skipSandbox: true },
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

  const handleNotesSave = (value: string) => {
    if (notesSaveRef.current) clearTimeout(notesSaveRef.current);
    notesSaveRef.current = setTimeout(async () => {
      setNotesSaving(true);
      try {
        await fetch(`/api/competitions/${id}/notes`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: value }),
        });
      } finally {
        setNotesSaving(false);
      }
    }, 800);
  };

  // Notification toggle handler
  const handleNotifyToggle = async () => {
    if (notifyActive) {
      // Turn off
      notifyOnComplete.current = false;
      setNotifyActive(false);
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'denied') {
      setNotifyDenied(true);
      return;
    }
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      if (perm === 'denied') {
        setNotifyDenied(true);
        return;
      }
      if (perm !== 'granted') return;
    }
    notifyOnComplete.current = true;
    setNotifyActive(true);
    setNotifyDenied(false);
  };

  const orderedTeams: Team[] = teams.length > 0
    ? teams
    : Array.from(teamEvents.keys()).map((tid) => ({ id: tid, model: tid }));

  // Fire notification when competition reaches a terminal state
  useEffect(() => {
    if (!notifyOnComplete.current) return;
    if (hasNotifiedRef.current) return;
    if (state !== 'COMPLETE' && state !== 'FORGE_COMPLETE') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    hasNotifiedRef.current = true;
    const winnerLabel = result?.winnerId
      ? resolveLabel(orderedTeams, result.winnerId, result.winnerId)
      : null;
    const body = winnerLabel
      ? `${briefTitle || 'Competition'} — ${winnerLabel} wins!`
      : `${briefTitle || 'Competition'} — complete!`;

    new Notification('Arena4Ai', { body, icon: '/icon.svg' });
    notifyOnComplete.current = false;
    setNotifyActive(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, result, briefTitle]);

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
          background: '#000408',
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          color: '#c8eef8',
          border: isRunning ? '1px solid rgba(0,240,255,0.2)' : '1px solid transparent',
          transition: 'border-color 0.5s ease',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: '0.85rem',
          padding: isMobile ? '0.5rem 0.75rem' : '0.7rem 1.4rem',
          borderBottom: '1px solid #0a2235',
          background: 'linear-gradient(180deg, rgba(2,8,20,0.98) 0%, rgba(0,4,8,0.98) 100%)',
          flexShrink: 0, flexWrap: isMobile ? 'wrap' : 'nowrap',
          overflow: 'hidden',
        }}>
          <a href="/" style={{
            fontSize: '0.75rem', color: '#00f0ff', fontWeight: 800,
            letterSpacing: '2.5px', textDecoration: 'none', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: '0.4rem',
          }}>
            <span style={{ fontSize: '0.9rem' }}>🎮</span>
            ARENA
          </a>

          <span style={{ color: '#0a2235', fontSize: '1.1rem' }}>│</span>

          <div style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center',
            gap: '0.8rem', flexWrap: 'wrap',
          }}>
            {briefTitle && (
              <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#c8eef8' }}>
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
              <span style={{ fontSize: '0.65rem', color: '#00f0ff', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <StatusDot color="#00f0ff" pulsing={false} />
                live
              </span>
            )}
            {sseError && (
              <span style={{ fontSize: '0.70rem', color: '#ef4444' }}>{sseError}</span>
            )}
            {totalEvents > 0 && (
              <span style={{
                fontSize: '0.65rem', color: '#1e4a5a',
                background: 'rgba(10,34,53,0.4)',
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
                : <button onClick={() => sendControl('resume')} style={ctrlBtn('#00f0ff', 'rgba(0,240,255,0.1)')}>RESUME</button>
              }
              <button onClick={() => sendControl('cancel')} style={ctrlBtn('#ef4444', 'rgba(239,68,68,0.1)')}>CANCEL</button>
            </div>
          )}

          <button onClick={() => setBriefOpen(o => !o)} style={{
            fontSize: '0.70rem', color: briefOpen ? '#00f0ff' : '#4a8fa8',
            background: briefOpen ? 'rgba(0,240,255,0.1)' : 'transparent',
            border: `1px solid ${briefOpen ? 'rgba(0,240,255,0.4)' : '#0a2235'}`,
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
              fontSize: '0.70rem', color: copyLabel === '✓ Copied' ? '#00f0ff' : '#4a8fa8',
              background: copyLabel === '✓ Copied' ? 'rgba(0,240,255,0.1)' : 'transparent',
              border: `1px solid ${copyLabel === '✓ Copied' ? 'rgba(0,240,255,0.4)' : '#0a2235'}`,
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
                fontSize: '0.70rem', color: rematchLoading ? '#1e4a5a' : '#00f0ff',
                background: rematchLoading ? 'transparent' : 'rgba(0,240,255,0.08)',
                border: `1px solid ${rematchLoading ? '#0a2235' : 'rgba(0,240,255,0.35)'}`,
                borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
                letterSpacing: '0.5px', fontWeight: 600, cursor: rematchLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                transition: 'all 0.15s ease', fontFamily: 'inherit',
              }}
              title="Start a new competition with the same brief and models"
            >
              {rematchLoading
                ? <><ActivitySpinner color="#00f0ff" active={true} /> REMATCH</>
                : '⟳ REMATCH'}
            </button>
          )}

          {isComplete && (
            <a href={`/competitions/${id}/replay`} style={{
              fontSize: '0.70rem', color: '#4a8fa8', textDecoration: 'none',
              border: '1px solid #0a2235', borderRadius: '6px',
              padding: '0.35rem 0.75rem', flexShrink: 0,
              letterSpacing: '0.5px', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              transition: 'all 0.15s ease',
            }}>
              ▶ REPLAY
            </a>
          )}

          {/* Spectate link — always shown */}
          <a
            href={`/competitions/${id}/spectate`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.70rem', color: '#4a8fa8', textDecoration: 'none',
              border: '1px solid #0a2235', borderRadius: '6px',
              padding: '0.35rem 0.75rem', flexShrink: 0,
              letterSpacing: '0.5px', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              transition: 'all 0.15s ease',
            }}
            title="Open fullscreen spectator view"
          >
            ⤢ Spectate
          </a>

          {/* Notification toggle — shown when competition is in progress */}
          {!isTerminal && !notifyDenied && (
            <button
              onClick={handleNotifyToggle}
              style={{
                fontSize: '0.70rem',
                color: notifyActive ? '#00f0ff' : '#4a8fa8',
                background: notifyActive ? 'rgba(0,240,255,0.08)' : 'transparent',
                border: `1px solid ${notifyActive ? 'rgba(0,240,255,0.35)' : '#0a2235'}`,
                borderRadius: '6px', padding: '0.35rem 0.75rem', flexShrink: 0,
                letterSpacing: '0.5px', fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.35rem',
                transition: 'all 0.15s ease', fontFamily: 'inherit',
              }}
              title={notifyActive ? 'Click to cancel notification' : 'Notify me when this competition finishes'}
            >
              {notifyActive ? '🔕 Notifying…' : '🔔 Notify'}
            </button>
          )}
          {notifyDenied && (
            <span style={{
              fontSize: '0.62rem', color: '#ef4444', flexShrink: 0,
              padding: '0.35rem 0',
            }}>
              Notifications blocked
            </span>
          )}

          <div style={{
            fontFamily: 'monospace',
            color: isRunning ? '#00f0ff' : '#4a8fa8',
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
            background: '#010810', borderBottom: '1px solid #0a2235',
            padding: '1.2rem 1.6rem', flexShrink: 0,
            maxHeight: '380px', overflowY: 'auto',
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem',
          }}>
            {/* Left col: problem + agents */}
            <div>
              <div style={{ fontSize: '0.65rem', color: '#1e4a5a', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                PROBLEM
              </div>
              <div style={{ fontSize: '0.82rem', color: '#d8f0fa', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: '1rem' }}>
                {brief.problem}
              </div>

              {(brief.constraints?.length ?? 0) > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#1e4a5a', letterSpacing: '1.5px', marginBottom: '0.4rem' }}>
                    CONSTRAINTS
                  </div>
                  {brief.constraints!.map((c, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#4a8fa8', paddingLeft: '0.6rem', borderLeft: '2px solid #0a2235', marginBottom: '0.25rem' }}>
                      {c}
                    </div>
                  ))}
                </div>
              )}

              {(brief.deliverables?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: '#1e4a5a', letterSpacing: '1.5px', marginBottom: '0.4rem' }}>
                    DELIVERABLES
                  </div>
                  {brief.deliverables!.map((d, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#4a8fa8', paddingLeft: '0.6rem', borderLeft: '2px solid #0a2235', marginBottom: '0.25rem' }}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right col: teams + rubric + rematch */}
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.65rem', color: '#1e4a5a', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                  AGENTS
                </div>
                {teams.map((t, i) => {
                  const color = getModelColor(t.model);
                  return (
                    <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color, background: `${color}18`, border: `1px solid ${color}44`, borderRadius: '4px', padding: '0.1rem 0.45rem', letterSpacing: '0.5px' }}>
                        {getModelName(t.model).toUpperCase()}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#4a8fa8' }}>{t.model}</span>
                    </div>
                  );
                })}
              </div>

              {brief.rubric?.criteria && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.65rem', color: '#1e4a5a', letterSpacing: '1.5px', marginBottom: '0.5rem' }}>
                    RUBRIC
                  </div>
                  {brief.rubric.criteria.map((c) => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#4a8fa8' }}>{c.id}</span>
                      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.65rem', color: '#1e4a5a' }}>{Math.round(c.weight * 100)}%</span>
                        <span style={{ fontSize: '0.72rem', color: '#d8f0fa', fontWeight: 700 }}>/{c.maxScore}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {brief.timeLimitMs && (
                <div style={{ fontSize: '0.72rem', color: '#1e4a5a', marginBottom: '1rem' }}>
                  ⏱ {Math.round(brief.timeLimitMs / 60000)} min time limit
                  {brief.format && <span style={{ marginLeft: '0.75rem' }}>📐 {brief.format}</span>}
                </div>
              )}

              <a
                href={`/competitions/new?from=${id}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  fontSize: '0.72rem', fontWeight: 800, letterSpacing: '1px',
                  color: '#00f0ff', background: 'rgba(0,240,255,0.1)',
                  border: '1px solid rgba(0,240,255,0.35)', borderRadius: '6px',
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
          gridTemplateColumns: isMobile ? '1fr' : `repeat(${numTeams}, 1fr)`,
          overflow: isMobile ? 'auto' : 'hidden',
          flex: bottomMaximized ? 0 : 1, height: bottomMaximized ? 0 : undefined, minHeight: 0,
        }}>
          {orderedTeams.map((team, i) => {
            // Broadcast events (TIME_UP, TIME_WARNING) are shown in the StateBanner,
            // not injected into each lane to avoid duplicate rows.
            const events = (teamEvents.get(team.id) ?? [])
              .slice()
              .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            const color = LANE_COLORS[i] ?? '#4a8fa8';

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
              color: '#0e3050', fontSize: '0.82rem', gap: '0.75rem',
            }}>
              <ActivitySpinner color="#3b82f6" active={true} />
              <span>Waiting for competition data...</span>
            </div>
          )}
        </div>

        {/* ── Resize handle (only visible when there are results and not maximized) ── */}
        {result && !bottomMaximized && (
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
            onMaximize={() => {
              setBottomMaximized((m) => {
                if (!m) setScoreDrawerHeight(SCORE_DRAWER_EXPANDED);
                return !m;
              });
            }}
            maximized={bottomMaximized}
            fileEventsByTeam={fileEventsByTeam}
            comp={{ state }}
          />
        )}

        {/* ── Notes section ────────────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0, borderTop: '1px solid #0a2235',
          background: '#010810', padding: '0.6rem 1.4rem',
          display: bottomMaximized ? 'none' : 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <span style={{ fontSize: '0.55rem', color: '#3d7d94', letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>
            NOTES
          </span>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              handleNotesSave(e.target.value);
            }}
            placeholder="Add notes about this competition... (e.g. 'tried 5min limit', 'persona experiment')"
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: '#7cc6db', fontSize: '0.68rem', fontFamily: 'inherit',
              resize: 'none', outline: 'none', lineHeight: 1.5,
              fontStyle: notes ? 'italic' : 'normal',
            }}
          />
          {notesSaving && (
            <span style={{ fontSize: '0.52rem', color: '#3d7d94', flexShrink: 0, letterSpacing: '1px' }}>
              saving...
            </span>
          )}
        </div>
      </div>
    </>
  );
}
