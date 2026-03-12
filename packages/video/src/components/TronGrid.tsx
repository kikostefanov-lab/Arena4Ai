import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { ACCENT_CYAN, BG_DARK } from '../tokens';

interface TronGridProps {
  opacity?: number;  // 0–1, default 1
}

export const TronGrid: React.FC<TronGridProps> = ({ opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Slow horizontal scan line sweeping downward
  const scanY = interpolate(frame, [0, 300], [0, height], { extrapolateRight: 'wrap' });

  return (
    <div style={{
      position: 'absolute', inset: 0,
      backgroundColor: BG_DARK,
      opacity,
      overflow: 'hidden',
    }}>
      {/* Grid lines — SVG for crisp rendering */}
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      >
        <defs>
          <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke={ACCENT_CYAN}
              strokeWidth="0.5"
              strokeOpacity="0.12"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        {/* Sweep line */}
        <rect
          x={0}
          y={scanY}
          width={width}
          height={2}
          fill={ACCENT_CYAN}
          opacity={0.06}
        />
      </svg>

      {/* Radial glow at center */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(ellipse 80% 50% at 50% 50%, rgba(0,240,255,0.05) 0%, transparent 70%)`,
      }} />
    </div>
  );
};
