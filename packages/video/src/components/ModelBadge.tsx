import { ORBITRON } from '../tokens';
import { hexToRgb } from '../utils';

interface ModelBadgeProps {
  model: string;    // e.g. "claude"
  persona: string;  // e.g. "architect"
  color: string;    // hex
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: { model: 28, persona: 18, padding: '6px 14px', gap: 4 },
  md: { model: 42, persona: 24, padding: '10px 20px', gap: 6 },
  lg: { model: 60, persona: 28, padding: '14px 28px', gap: 8 },
};

export const ModelBadge: React.FC<ModelBadgeProps> = ({ model, persona, color, size = 'md' }) => {
  const s = SIZE_MAP[size];

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: s.padding,
      background: `rgba(${hexToRgb(color)}, 0.12)`,
      border: `1.5px solid rgba(${hexToRgb(color)}, 0.5)`,
      borderRadius: 8,
      gap: s.gap,
    }}>
      <div style={{
        fontFamily: ORBITRON,
        fontSize: s.model,
        fontWeight: 900,
        color,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        textShadow: `0 0 20px rgba(${hexToRgb(color)}, 0.6)`,
      }}>
        {model.toUpperCase()}
      </div>
      <div style={{
        fontFamily: ORBITRON,
        fontSize: s.persona,
        fontWeight: 400,
        color: `rgba(${hexToRgb(color)}, 0.7)`,
        letterSpacing: '4px',
        textTransform: 'uppercase',
      }}>
        :{persona}
      </div>
    </div>
  );
};
