import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_PRIMARY, TEXT_MUTED, TEXT_DIM, BG_DARK, ORBITRON } from '../tokens';
import { hexToRgb } from '../utils';

interface TheBriefProps {
  data: Pick<ReelData, 'briefTitle' | 'briefDescription' | 'criteria'>;
}

function truncate(text: string, max = 130): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return text.slice(0, cut > 0 ? cut : max) + '…';
}

const ICONS = ['◆', '◈', '◇', '⬡', '▸', '⬟'];

export const TheBrief: React.FC<TheBriefProps> = ({ data }) => {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' });
  const titleOpacity  = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const titleY        = interpolate(frame, [8, 22], [16, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const descOpacity   = interpolate(frame, [18, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const criteriaOpacities = data.criteria.map((_, i) =>
    interpolate(frame, [32 + i * 12, 46 + i * 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );
  const criteriaX = data.criteria.map((_, i) =>
    interpolate(frame, [32 + i * 12, 46 + i * 12], [-24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  const shortDesc = truncate(data.briefDescription);

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Kicker */}
      <div style={{
        fontFamily: ORBITRON,
        fontSize: 20, color: ACCENT_CYAN, letterSpacing: '6px',
        textTransform: 'uppercase', marginBottom: 16, opacity: kickerOpacity,
      }}>
        ◆ THE CHALLENGE
      </div>

      {/* Title */}
      <div style={{
        fontFamily: ORBITRON,
        fontSize: 52, fontWeight: 900,
        lineHeight: 1.15, marginBottom: 20,
        opacity: titleOpacity,
        transform: `translateY(${titleY}px)`,
        background: `linear-gradient(135deg, #c8eef8, ${ACCENT_CYAN}, #0080ff)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {data.briefTitle}
      </div>

      {/* Truncated description */}
      <div style={{
        fontSize: 26, color: TEXT_MUTED, lineHeight: 1.55,
        marginBottom: 36, opacity: descOpacity,
      }}>
        {shortDesc}
      </div>

      {/* JUDGED ON label */}
      <div style={{
        fontFamily: ORBITRON, fontSize: 18, color: TEXT_DIM,
        letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 20,
      }}>
        JUDGED ON
      </div>

      {/* Criteria — punchy animated rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {data.criteria.map((criterion, i) => (
          <div key={criterion} style={{
            display: 'flex', alignItems: 'center', gap: 18,
            opacity: criteriaOpacities[i],
            transform: `translateX(${criteriaX[i]}px)`,
          }}>
            <div style={{
              width: 4, height: 36, borderRadius: 2,
              background: ACCENT_CYAN,
              boxShadow: `0 0 10px rgba(${hexToRgb(ACCENT_CYAN)}, 0.7)`,
              flexShrink: 0,
            }} />
            <div style={{ fontSize: 24, color: ACCENT_CYAN, flexShrink: 0, width: 30 }}>
              {ICONS[i % ICONS.length]}
            </div>
            <div style={{
              fontFamily: ORBITRON, fontSize: 24, fontWeight: 600,
              color: TEXT_PRIMARY, letterSpacing: '1px',
            }}>
              {criterion}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
