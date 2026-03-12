import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_PRIMARY, TEXT_MUTED, TEXT_DIM, BG_DARK, ORBITRON } from '../tokens';

interface TheBriefProps {
  data: Pick<ReelData, 'briefTitle' | 'briefDescription' | 'criteria'>;
}

export const TheBrief: React.FC<TheBriefProps> = ({ data }) => {
  const frame = useCurrentFrame();

  // Kicker fades in
  const kickerOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  // Title fades in at frame 10
  const titleOpacity = interpolate(frame, [10, 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Description at frame 20
  const descOpacity = interpolate(frame, [20, 35], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Each criterion fades in staggered (every 15 frames starting at frame 35)
  const criteriaOpacities = data.criteria.map((_, i) =>
    interpolate(frame, [35 + i * 15, 50 + i * 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Kicker */}
      <div style={{
        fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px',
        textTransform: 'uppercase', marginBottom: 20, opacity: kickerOpacity,
        fontFamily: ORBITRON,
      }}>
        ◆ THE CHALLENGE
      </div>

      {/* Title */}
      <div style={{
        fontFamily: ORBITRON,
        fontSize: 56,
        fontWeight: 900,
        color: TEXT_PRIMARY,
        lineHeight: 1.2,
        marginBottom: 24,
        opacity: titleOpacity,
        background: `linear-gradient(135deg, #c8eef8, ${ACCENT_CYAN}, #0080ff)`,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}>
        {data.briefTitle}
      </div>

      {/* Description */}
      <div style={{
        fontSize: 28, color: TEXT_MUTED, lineHeight: 1.6,
        marginBottom: 48, opacity: descOpacity,
      }}>
        {data.briefDescription}
      </div>

      {/* Criteria */}
      <div>
        <div style={{ fontSize: 20, color: TEXT_DIM, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: 16, fontFamily: ORBITRON }}>
          JUDGED ON
        </div>
        {data.criteria.map((criterion, i) => (
          <div key={criterion} style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '12px 20px', marginBottom: 10,
            background: `rgba(0,240,255,0.06)`,
            borderLeft: `3px solid ${ACCENT_CYAN}`,
            borderRadius: '0 6px 6px 0',
            opacity: criteriaOpacities[i],
          }}>
            <div style={{ fontSize: 22, color: ACCENT_CYAN }}>◆</div>
            <div style={{ fontSize: 26, color: TEXT_PRIMARY }}>{criterion}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
