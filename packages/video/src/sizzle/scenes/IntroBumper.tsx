import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_BLUE, BG_DARK, ORBITRON, TEXT_PRIMARY } from '../../tokens';

export const IntroBumper: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // Logotype materializes from scanlines
  const logoScale = spring({ frame, fps, config: { damping: 18, stiffness: 110 } });
  const logoOpacity = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const kickerOpacity = interpolate(frame, [18, 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Scanline sweep across the logo
  const sweepX = interpolate(frame, [0, 60], [-1, 1]);

  // Exit fade on last 8 frames
  const exit = interpolate(frame, [82, 90], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const logoSize = Math.min(width, height) * 0.14;
  const kickerSize = Math.min(width, height) * 0.022;

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      {/* Radial glow behind logo */}
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at center, rgba(0,240,255,0.15) 0%, transparent 50%)`,
        opacity: logoOpacity * 0.8,
      }} />

      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: kickerSize,
          fontWeight: 800,
          letterSpacing: '8px',
          color: ACCENT_CYAN,
          textTransform: 'uppercase',
          marginBottom: '1.2em',
          opacity: kickerOpacity,
          textShadow: `0 0 20px ${ACCENT_CYAN}`,
        }}>
          ◆ Arena4Ai presents
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: logoSize,
          fontWeight: 900,
          letterSpacing: '0.05em',
          lineHeight: 1,
          transform: `scale(${logoScale})`,
          opacity: logoOpacity,
          position: 'relative',
          overflow: 'hidden',
          background: `linear-gradient(135deg, ${TEXT_PRIMARY} 0%, ${ACCENT_CYAN} 50%, ${ACCENT_BLUE} 100%)`,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: `0 0 40px ${ACCENT_CYAN}`,
          filter: `drop-shadow(0 0 30px rgba(0, 240, 255, 0.6))`,
        }}>
          ARENA<span style={{ color: ACCENT_CYAN, WebkitTextFillColor: ACCENT_CYAN }}>4</span>AI
        </div>
      </AbsoluteFill>

      {/* Scanline sweep overlay */}
      <AbsoluteFill style={{
        background: `linear-gradient(90deg, transparent 40%, rgba(0,240,255,0.25) 50%, transparent 60%)`,
        transform: `translateX(${sweepX * 100}%)`,
        mixBlendMode: 'screen',
      }} />
    </AbsoluteFill>
  );
};
