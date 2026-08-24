import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, BG_DARK, BG_CARD, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, ACCENT_ORANGE } from '../../tokens';
import { ARENA_CRITERIA, ARENA_SOURCE_TITLE } from '../arena-data';


export const TheBrief: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  // Fade in the real brief screengrab in the corner
  const shotOpacity = interpolate(frame, [10, 40], [0, 0.55], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Brief card materializes
  const cardOpacity = interpolate(frame, [20, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cardY = interpolate(frame, [20, 50], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Criteria rows animate in staggered
  const rowDelay = 55;
  // Exit
  const exit = interpolate(frame, [188, 210], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const kickerSize = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);
  const titleSize = Math.min(width, height) * (isPortrait ? 0.045 : 0.035);
  const rowSize   = Math.min(width, height) * (isPortrait ? 0.028 : 0.022);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      {/* Real product screengrab — dimmed backdrop */}
      <AbsoluteFill style={{ opacity: shotOpacity, filter: 'blur(2px) saturate(1.1)' }}>
        <Img
          src={staticFile('sizzle-assets/03-brief-builder.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      {/* Dark gradient overlay for readability */}
      <AbsoluteFill style={{
        background: `linear-gradient(135deg, rgba(0,4,8,0.75) 0%, rgba(5,15,30,0.90) 100%)`,
      }} />

      <AbsoluteFill style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: '6%',
      }}>
        <div style={{
          background: BG_CARD,
          border: `1px solid ${ACCENT_CYAN}44`,
          borderRadius: 12,
          padding: isPortrait ? '6% 6%' : '4% 5%',
          maxWidth: isPortrait ? '88%' : '70%',
          boxShadow: `0 0 60px rgba(0,240,255,0.15), inset 0 0 40px rgba(0,240,255,0.03)`,
          opacity: cardOpacity,
          transform: `translateY(${cardY}px)`,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Accent line at top */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 2,
            background: `linear-gradient(90deg, transparent, ${ACCENT_CYAN} 30%, ${ACCENT_ORANGE} 70%, transparent)`,
            opacity: 0.7,
          }} />

          <div style={{
            fontFamily: ORBITRON,
            fontSize: kickerSize,
            fontWeight: 800,
            letterSpacing: '0.4em',
            color: ACCENT_CYAN,
            textTransform: 'uppercase',
            marginBottom: '0.8em',
          }}>
            ◆ Brief
          </div>

          <div style={{
            fontFamily: ORBITRON,
            fontSize: titleSize,
            fontWeight: 800,
            color: TEXT_PRIMARY,
            lineHeight: 1.1,
            letterSpacing: '0.01em',
            marginBottom: '1.2em',
          }}>
            {ARENA_SOURCE_TITLE}
          </div>

          {/* Criteria rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6em' }}>
            {ARENA_CRITERIA.map((c, i) => {
              const start = rowDelay + i * 12;
              const op = interpolate(frame, [start, start + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              const x = interpolate(frame, [start, start + 14], [-30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              return (
                <div key={c} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75em',
                  fontFamily: ORBITRON,
                  fontSize: rowSize,
                  fontWeight: 700,
                  color: TEXT_MUTED,
                  opacity: op,
                  transform: `translateX(${x}px)`,
                  letterSpacing: '0.05em',
                }}>
                  <span style={{
                    display: 'inline-block',
                    width: '0.8em', height: '0.8em',
                    borderRadius: '50%',
                    background: ACCENT_CYAN,
                    boxShadow: `0 0 12px ${ACCENT_CYAN}`,
                  }} />
                  {c}
                </div>
              );
            })}
          </div>

          <div style={{
            marginTop: '1.4em',
            fontFamily: ORBITRON,
            fontSize: kickerSize * 1.1,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: TEXT_MUTED,
            opacity: interpolate(frame, [130, 160], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          }}>
            Your brief. Your criteria. Not a toy benchmark.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
