import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_BLUE, BG_DARK, ORBITRON, TEXT_PRIMARY, TEXT_MUTED } from '../../tokens';

export const SizzleOutro: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const isPortrait = height > width;

  const logoIn = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const logoOp = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const taglineOp = interpolate(frame, [35, 55], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ctaOp = interpolate(frame, [70, 95], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Subtle fade to black at end
  const exit = interpolate(frame, [130, 150], [1, 0.2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const logoSize    = Math.min(width, height) * (isPortrait ? 0.095 : 0.075);
  const taglineSize = Math.min(width, height) * (isPortrait ? 0.035 : 0.028);
  const ctaSize     = Math.min(width, height) * (isPortrait ? 0.026 : 0.021);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at center, rgba(0,240,255,0.12) 0%, transparent 55%)`,
      }} />

      <AbsoluteFill style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: '1.2em',
        padding: '6%',
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: logoSize,
          fontWeight: 900,
          letterSpacing: '0.05em',
          lineHeight: 1,
          transform: `scale(${logoIn})`,
          opacity: logoOp,
          background: `linear-gradient(135deg, ${TEXT_PRIMARY} 0%, ${ACCENT_CYAN} 50%, ${ACCENT_BLUE} 100%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          filter: `drop-shadow(0 0 30px rgba(0, 240, 255, 0.6))`,
        }}>
          ARENA<span style={{ color: ACCENT_CYAN, WebkitTextFillColor: ACCENT_CYAN }}>4</span>AI
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: taglineSize,
          fontWeight: 700,
          letterSpacing: '0.2em',
          color: TEXT_PRIMARY,
          textShadow: `0 0 20px ${ACCENT_CYAN}`,
          opacity: taglineOp,
          textTransform: 'uppercase',
          textAlign: 'center',
        }}>
          May the best model win.
        </div>

        <div style={{
          opacity: ctaOp,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6em',
          alignItems: 'center',
          marginTop: '1em',
        }}>
          <div style={{
            fontFamily: ORBITRON,
            fontSize: ctaSize,
            fontWeight: 800,
            letterSpacing: '0.4em',
            color: ACCENT_CYAN,
            padding: '0.7em 1.6em',
            border: `1px solid ${ACCENT_CYAN}88`,
            background: `${ACCENT_CYAN}15`,
            textShadow: `0 0 12px ${ACCENT_CYAN}`,
            boxShadow: `0 0 40px ${ACCENT_CYAN}33`,
            textTransform: 'uppercase',
          }}>
            arena4.ai
          </div>
          <div style={{
            fontFamily: ORBITRON,
            fontSize: ctaSize * 0.7,
            fontWeight: 700,
            letterSpacing: '0.3em',
            color: TEXT_MUTED,
            textTransform: 'uppercase',
          }}>
            Open source · self-hosted · no API key
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
