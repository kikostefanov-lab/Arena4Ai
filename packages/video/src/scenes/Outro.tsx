import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { TronGrid } from '../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, TEXT_DIM, TEXT_MUTED, ORBITRON } from '../tokens';

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const opacity  = interpolate(progress, [0, 1], [0, 1]);
  const scale    = interpolate(progress, [0, 1], [0.85, 1]);

  const subtitleOpacity = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
      <TronGrid />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', opacity, transform: `scale(${scale})` }}>
        {/* Logo */}
        <div style={{ fontFamily: ORBITRON, fontSize: 80, fontWeight: 900, letterSpacing: '6px' }}>
          <span style={{ color: ACCENT_CYAN }}>ARENA</span>
          <span style={{ color: ACCENT_ORANGE }}>4</span>
          <span style={{ color: ACCENT_CYAN }}>AI</span>
        </div>

        <div style={{ width: 200, height: 1, background: ACCENT_CYAN, margin: '16px auto', opacity: 0.4 }} />

        {/* URL */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 28, color: TEXT_DIM,
          letterSpacing: '4px', marginBottom: 20,
          opacity: subtitleOpacity,
        }}>
          arena4.ai
        </div>

        {/* CTA */}
        <div style={{
          fontSize: 24, color: TEXT_MUTED,
          letterSpacing: '2px',
          opacity: subtitleOpacity,
        }}>
          Watch more battles →
        </div>
      </div>
    </div>
  );
};
