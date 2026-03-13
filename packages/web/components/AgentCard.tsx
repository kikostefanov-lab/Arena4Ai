'use client';
import { getModelColor, MODEL_BADGE_COLORS, MONOSPACE_FONT, BODY_FONT } from '../lib/design-tokens';
import type { Agent } from '@arena/shared';

interface AgentCardProps {
  agent: Agent;
  onEdit: (agent: Agent) => void;
  onFork: (agent: Agent) => void;
  onRetire: (id: string) => void;
}

export function AgentCard({ agent, onEdit, onFork, onRetire }: AgentCardProps) {
  const modelColor = getModelColor(agent.provider);
  const badgeColors = MODEL_BADGE_COLORS[agent.provider] ?? { bg: 'rgba(74,143,168,0.15)', fg: '#4a8fa8', border: 'rgba(74,143,168,0.3)' };
  const isSystem = agent.createdBy === 'system';

  const statsLabel = agent.statsTotal > 0
    ? `${agent.statsWins}W · ${agent.statsLosses}L · avg ${agent.statsAvgScore != null ? agent.statsAvgScore.toFixed(2) : '—'}`
    : '— no battles yet';

  const personaAvatar = agent.persona?.avatar ?? '🤖';
  const personaName = agent.persona?.name ?? null;

  return (
    <div style={{
      background: 'rgba(0,8,16,0.7)',
      border: '1px solid rgba(0,240,255,0.12)',
      borderRadius: '10px',
      padding: '1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.7rem',
      position: 'relative',
      transition: 'border-color 0.15s',
    }}>
      {/* Header: avatar + name + provider badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
        {/* Avatar circle */}
        <div style={{
          width: '2.4rem',
          height: '2.4rem',
          borderRadius: '50%',
          background: `${modelColor}22`,
          border: `1.5px solid ${modelColor}66`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.1rem',
          flexShrink: 0,
        }}>
          {personaAvatar}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: MONOSPACE_FONT,
            fontSize: '0.75rem',
            fontWeight: 800,
            color: '#c8eef8',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {agent.name}
          </div>
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginTop: '0.15rem', flexWrap: 'wrap' }}>
            {/* Provider badge */}
            <span style={{
              fontSize: '0.55rem',
              fontWeight: 800,
              padding: '0.08rem 0.35rem',
              borderRadius: '3px',
              background: badgeColors.bg,
              color: badgeColors.fg,
              border: `1px solid ${badgeColors.border}`,
              fontFamily: MONOSPACE_FONT,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
            }}>
              {agent.provider}
            </span>
            {/* Fork badge */}
            {agent.forkedFromId && (
              <span style={{ fontSize: '0.55rem', color: '#4a8fa8', fontFamily: MONOSPACE_FONT }}>⑂ fork</span>
            )}
            {/* System badge */}
            {isSystem && (
              <span style={{
                fontSize: '0.52rem',
                color: '#3d7d94',
                fontFamily: MONOSPACE_FONT,
                background: 'rgba(61,125,148,0.1)',
                padding: '0.05rem 0.3rem',
                borderRadius: '3px',
                border: '1px solid rgba(61,125,148,0.2)',
              }}>SYSTEM</span>
            )}
          </div>
        </div>
      </div>

      {/* Persona info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span style={{ fontSize: '0.7rem' }}>{personaAvatar}</span>
        <span style={{
          fontSize: '0.6rem',
          fontFamily: BODY_FONT,
          color: personaName ? '#7cc6db' : '#3d7d94',
          fontStyle: personaName ? 'normal' : 'italic',
        }}>
          {personaName ?? 'No persona'}
        </span>
      </div>

      {/* Persona description */}
      {agent.persona?.description && (
        <p style={{
          color: '#7cc6db',
          fontSize: '0.62rem',
          fontFamily: BODY_FONT,
          lineHeight: 1.5,
          margin: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {agent.persona.description}
        </p>
      )}

      {/* Stats */}
      <div style={{
        fontSize: '0.58rem',
        color: '#3d7d94',
        fontFamily: MONOSPACE_FONT,
        borderTop: '1px solid rgba(0,240,255,0.06)',
        paddingTop: '0.5rem',
      }}>
        {statsLabel}
      </div>

      {/* Actions */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        borderTop: '1px solid rgba(0,240,255,0.06)',
        paddingTop: '0.5rem',
        alignItems: 'center',
      }}>
        {/* Fork — available for all agents */}
        <button onClick={() => onFork(agent)} style={{
          fontSize: '0.58rem', color: '#4a8fa8', background: 'none', border: 'none',
          cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT,
        }}>⑂ Fork</button>

        {/* Edit + Retire — user agents only */}
        {!isSystem && (
          <>
            <button onClick={() => onEdit(agent)} style={{
              fontSize: '0.58rem', color: '#7cc6db', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT,
            }}>✏️ Edit</button>
            <button
              onClick={() => { if (window.confirm(`Retire "${agent.name}"? This cannot be undone.`)) onRetire(agent.id); }}
              style={{
                fontSize: '0.58rem', color: '#ef4444', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT,
                marginLeft: 'auto',
              }}
            >🗑 Retire</button>
          </>
        )}
      </div>
    </div>
  );
}
