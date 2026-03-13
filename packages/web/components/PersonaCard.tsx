'use client';
import {
  MONOSPACE_FONT,
  BODY_FONT,
  TEXT_PRIMARY,
  TEXT_MUTED,
  TEXT_DIM,
  ACCENT_CYAN,
} from '../lib/design-tokens';
import type { Persona } from '@arena/shared';

interface PersonaCardProps {
  persona: Persona;
  onEdit: (persona: Persona) => void;
  onRetire: (id: string) => void;
}

export function PersonaCard({ persona, onEdit, onRetire }: PersonaCardProps) {
  const isSystem = persona.createdBy === 'system';
  const canRetire = persona.agentCount === 0;
  const retireTooltip = !canRetire
    ? `${persona.agentCount} agent${persona.agentCount === 1 ? '' : 's'} use this persona — retire them first`
    : undefined;

  return (
    <div style={{
      background: 'rgba(0,8,16,0.7)',
      border: `1px solid rgba(0,240,255,0.12)`,
      borderRadius: '10px',
      padding: '1.1rem',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.7rem',
      position: 'relative',
      transition: 'border-color 0.15s',
    }}>
      {/* System badge (top-right) */}
      {isSystem && (
        <span style={{
          position: 'absolute',
          top: '0.65rem',
          right: '0.65rem',
          fontSize: '0.50rem',
          color: TEXT_DIM,
          fontFamily: MONOSPACE_FONT,
          background: 'rgba(61,125,148,0.1)',
          padding: '0.05rem 0.3rem',
          borderRadius: '3px',
          border: '1px solid rgba(61,125,148,0.2)',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}>SYSTEM</span>
      )}

      {/* Header: avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Avatar circle */}
        <div style={{
          width: '2.8rem',
          height: '2.8rem',
          borderRadius: '50%',
          background: 'rgba(0,240,255,0.08)',
          border: `1.5px solid rgba(0,240,255,0.25)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.4rem',
          flexShrink: 0,
        }}>
          {persona.avatar ?? '🧠'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: MONOSPACE_FONT,
            fontSize: '0.78rem',
            fontWeight: 800,
            color: TEXT_PRIMARY,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {persona.name}
          </div>
          {/* Agent count */}
          <div style={{
            fontSize: '0.58rem',
            color: TEXT_DIM,
            fontFamily: MONOSPACE_FONT,
            marginTop: '0.15rem',
          }}>
            used by {persona.agentCount} agent{persona.agentCount === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {/* Description */}
      {persona.description && (
        <p style={{
          color: TEXT_MUTED,
          fontSize: '0.62rem',
          fontFamily: BODY_FONT,
          lineHeight: 1.5,
          margin: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {persona.description}
        </p>
      )}

      {/* Tags */}
      {persona.tags && persona.tags.length > 0 && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {persona.tags.map(tag => (
            <span key={tag} style={{
              fontSize: '0.52rem',
              color: TEXT_DIM,
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

      {/* Divider */}
      <div style={{ borderTop: '1px solid rgba(0,240,255,0.06)', marginTop: '0.1rem' }} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {isSystem ? (
          /* System personas: view-only expand button */
          <button
            onClick={() => onEdit(persona)}
            style={{
              fontSize: '0.58rem',
              color: ACCENT_CYAN,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontFamily: MONOSPACE_FONT,
            }}
          >
            ↗ View
          </button>
        ) : (
          <>
            <button
              onClick={() => onEdit(persona)}
              style={{
                fontSize: '0.58rem',
                color: TEXT_MUTED,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontFamily: MONOSPACE_FONT,
              }}
            >
              ✏️ Edit
            </button>
            <span style={{ color: 'rgba(0,240,255,0.12)', fontSize: '0.58rem' }}>|</span>
            <span title={retireTooltip} style={{ display: 'inline-block' }}>
              <button
                onClick={() => canRetire && onRetire(persona.id)}
                disabled={!canRetire}
                style={{
                  fontSize: '0.58rem',
                  color: canRetire ? '#ef4444' : '#3d4a55',
                  background: 'none',
                  border: 'none',
                  cursor: canRetire ? 'pointer' : 'not-allowed',
                  padding: 0,
                  fontFamily: MONOSPACE_FONT,
                  opacity: canRetire ? 1 : 0.45,
                }}
              >
                🗑 Retire
              </button>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
