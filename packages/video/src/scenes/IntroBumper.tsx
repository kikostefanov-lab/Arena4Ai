import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, ORBITRON, TEXT_MUTED } from '../tokens';

export const IntroBumper: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo fades + scales in over first 20 frames
  const logoProgress = spring({ frame, fps, config: { damping: 200, stiffness: 120 } });
  const logoOpacity = interpolate(logoProgress, [0, 1], [0, 1]);
  const logoScale  = interpolate(logoProgress, [0, 1], [0.7, 1]);

  // "COMPETITION RECAP" fades in at frame 20
  const textProgress = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 200, stiffness: 100 } });
  const textOpacity = interpolate(textProgress, [0, 1], [0, 1]);
  const textY       = interpolate(textProgress, [0, 1], [20, 0]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <TronGrid />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {/* ARENA4AI logo */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 96,
          fontWeight: 900,
          letterSpacing: '8px',
          opacity: logoOpacity,
          transform: `scale(${logoScale})`,
        }}>
          <span style={{ color: ACCENT_CYAN }}>ARENA</span>
          <span style={{ color: ACCENT_ORANGE }}>4</span>
          <span style={{ color: ACCENT_CYAN }}>AI</span>
        </div>

        {/* Divider line */}
        <div style={{
          width: interpolate(logoProgress, [0, 1], [0, 300]),
          height: 1,
          background: ACCENT_CYAN,
          margin: '20px auto',
          opacity: 0.5,
          boxShadow: `0 0 8px ${ACCENT_CYAN}`,
        }} />

        {/* COMPETITION RECAP label */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 36,
          fontWeight: 400,
          letterSpacing: '12px',
          color: TEXT_MUTED,
          textTransform: 'uppercase',
          opacity: textOpacity,
          transform: `translateY(${textY}px)`,
        }}>
          COMPETITION RECAP
        </div>
      </div>
    </div>
  );
};
