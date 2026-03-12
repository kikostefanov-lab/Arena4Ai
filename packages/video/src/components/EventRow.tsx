import { TEXT_PRIMARY, MONO } from '../tokens';
import { hexToRgb } from '../utils';

interface EventRowProps {
  moment: {
    relativeMs: number;
    teamId: string;
    label: string;
    type: 'FILE_CREATE' | 'TOOL_CALL' | 'ERROR';
  };
  teamColor: string;
  teamLabel: string;
  opacity?: number;
}

const TYPE_ICONS: Record<string, string> = {
  FILE_CREATE: '📄',
  TOOL_CALL:   '⚡',
  ERROR:       '⚠',
};

function formatRelativeTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, '0')}s`;
}

export const EventRow: React.FC<EventRowProps> = ({ moment, teamColor, teamLabel, opacity = 1 }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 20px',
    background: `rgba(${hexToRgb(teamColor)}, 0.08)`,
    borderLeft: `3px solid ${teamColor}`,
    borderRadius: '0 8px 8px 0',
    marginBottom: 12,
    opacity,
  }}>
    <div style={{ fontSize: 20, width: 28, flexShrink: 0 }}>
      {TYPE_ICONS[moment.type] ?? '◆'}
    </div>
    <div style={{ fontSize: 20, color: teamColor, width: 80, flexShrink: 0, fontFamily: MONO }}>
      {formatRelativeTime(moment.relativeMs)}
    </div>
    <div style={{ fontSize: 20, color: teamColor, fontWeight: 700, width: 160, flexShrink: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
      {teamLabel}
    </div>
    <div style={{ fontSize: 22, color: TEXT_PRIMARY, flex: 1, fontFamily: MONO }}>
      {moment.label}
    </div>
  </div>
);
