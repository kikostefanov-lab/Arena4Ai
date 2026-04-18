import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, BG_DARK, ORBITRON, TEXT_PRIMARY, TEXT_MUTED } from '../../tokens';

const PILLARS = [
  { glyph: '◆', title: 'REAL WORK', sub: 'Your brief. Not toy benchmarks.',     accent: ACCENT_CYAN   },
  { glyph: '●', title: 'LIVE',      sub: 'Every tool call. Every file write.', accent: ACCENT_ORANGE },
  { glyph: '▸', title: 'FORGED',    sub: 'The winner becomes your project.',    accent: ACCENT_CYAN   },
];

export const ThreePillars: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const isPortrait = height > width;

  const exit = interpolate(frame, [165, 180], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const glyphSize   = Math.min(width, height) * (isPortrait ? 0.1 : 0.07);
  const titleSize   = Math.min(width, height) * (isPortrait ? 0.055 : 0.04);
  const subSize     = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: isPortrait ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isPortrait ? '4%' : '6%',
        padding: '6%',
      }}>
        {PILLARS.map((p, i) => {
          const start = i * 35;
          const popIn = spring({ frame: Math.max(0, frame - start), fps, config: { damping: 14, stiffness: 130 } });
          const op = interpolate(frame, [start, start + 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={p.title} style={{
              textAlign: 'center',
              opacity: op,
              transform: `scale(${popIn})`,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: '0.4em',
            }}>
              <div style={{
                fontFamily: ORBITRON,
                fontSize: glyphSize,
                color: p.accent,
                textShadow: `0 0 30px ${p.accent}`,
                lineHeight: 1,
              }}>{p.glyph}</div>
              <div style={{
                fontFamily: ORBITRON,
                fontSize: titleSize,
                fontWeight: 900,
                letterSpacing: '0.1em',
                color: p.accent,
                textShadow: `0 0 20px ${p.accent}`,
              }}>{p.title}</div>
              <div style={{
                fontFamily: ORBITRON,
                fontSize: subSize,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: TEXT_MUTED,
                maxWidth: '14em',
                lineHeight: 1.4,
              }}>{p.sub}</div>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
