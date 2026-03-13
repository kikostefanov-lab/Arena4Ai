'use client';
import { getModelColor, MODEL_BADGE_COLORS, MONOSPACE_FONT, BODY_FONT } from '../lib/design-tokens';
import type { AgentProfile } from '@arena/shared';

interface AgentCardProps {
  profile: AgentProfile;
  onEdit?: (profile: AgentProfile) => void;
  onFork?: (profile: AgentProfile) => void;
  onRetire?: (profile: AgentProfile) => void;
}

export function AgentCard({ profile, onEdit, onFork, onRetire }: AgentCardProps) {
  const modelColor = getModelColor(profile.provider);
  const badgeColors = MODEL_BADGE_COLORS[profile.provider] ?? { bg: 'rgba(74,143,168,0.15)', fg: '#4a8fa8', border: 'rgba(74,143,168,0.3)' };
  const isSystem = profile.createdBy === 'system';
  const statsLabel = profile.statsTotal > 0
    ? `${profile.statsWins}W / ${profile.statsLosses}L · ${profile.statsAvgScore !== undefined ? profile.statsAvgScore.toFixed(2) : '—'} avg`
    : '— no battles yet';

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
          {profile.avatar ?? '🤖'}
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
            {profile.name}
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
              {profile.provider}
            </span>
            {/* Fork badge */}
            {profile.forkedFromId && (
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

      {/* Description */}
      {profile.description && (
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
          {profile.description}
        </p>
      )}

      {/* Tags */}
      {profile.tags && profile.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {profile.tags.map(tag => (
            <span key={tag} style={{
              fontSize: '0.52rem',
              color: '#3d7d94',
              background: 'rgba(0,128,255,0.07)',
              border: '1px solid rgba(0,128,255,0.15)',
              borderRadius: '3px',
              padding: '0.05rem 0.35rem',
              fontFamily: MONOSPACE_FONT,
            }}>
              {tag}
            </span>
          ))}
        </div>
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

      {/* Actions (non-system only) */}
      {!isSystem && (onEdit || onFork || onRetire) && (
        <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid rgba(0,240,255,0.06)', paddingTop: '0.5rem' }}>
          {onEdit && (
            <button onClick={() => onEdit(profile)} style={{
              fontSize: '0.58rem', color: '#7cc6db', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT,
            }}>✏️ Edit</button>
          )}
          {onRetire && (
            <button onClick={() => onRetire(profile)} style={{
              fontSize: '0.58rem', color: '#ef4444', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT,
            }}>🗑 Retire</button>
          )}
        </div>
      )}
      {/* Fork available for all profiles */}
      {onFork && (
        <button onClick={() => onFork(profile)} style={{
          position: 'absolute', top: '0.7rem', right: '0.7rem',
          fontSize: '0.58rem', color: '#3d7d94', background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: MONOSPACE_FONT,
        }}>⑂ Fork</button>
      )}
    </div>
  );
}
