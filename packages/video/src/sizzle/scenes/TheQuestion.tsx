import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, BG_DARK, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, getModelColor } from '../../tokens';

const MODEL_CHIPS = [
  { label: 'CLAUDE', color: getModelColor('claude') },
  { label: 'CODEX',  color: getModelColor('codex') }, // name the CLI we spawn, not a model number that rots
  { label: 'GEMINI', color: getModelColor('gemini') },
];

export const TheQuestion: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const isPortrait = height > width;

  // Big headline types in via spring
  const headlineIn = spring({ frame, fps, config: { damping: 14, stiffness: 90 } });
  const headlineOpacity = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Sub typography appears second
  const subOpacity = interpolate(frame, [28, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Chips stagger in
  const chipOffsets = [36, 48, 60];

  // Exit
  const exit = interpolate(frame, [138, 150], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const headlineSize = Math.min(width, height) * (isPortrait ? 0.08 : 0.07);
  const subSize      = Math.min(width, height) * (isPortrait ? 0.028 : 0.022);
  const chipSize     = Math.min(width, height) * (isPortrait ? 0.032 : 0.026);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      <AbsoluteFill style={{
        justifyContent: 'center',
        alignItems: 'center',
        padding: '4% 6%',
        gap: '3%',
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: headlineSize,
          fontWeight: 900,
          letterSpacing: '0.02em',
          lineHeight: 1,
          textAlign: 'center',
          color: TEXT_PRIMARY,
          transform: `scale(${0.85 + 0.15 * headlineIn})`,
          opacity: headlineOpacity,
          textShadow: `0 0 30px rgba(0,240,255,0.4)`,
        }}>
          WHICH MODEL<br/>
          <span style={{ color: ACCENT_CYAN }}>ACTUALLY WINS?</span>
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: subSize,
          fontWeight: 700,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: TEXT_MUTED,
          opacity: subOpacity,
        }}>
          On your real problem.
        </div>

        {/* Model chips */}
        <div style={{
          display: 'flex',
          gap: isPortrait ? '4%' : '3%',
          marginTop: '4%',
          flexDirection: isPortrait ? 'column' : 'row',
          alignItems: 'center',
        }}>
          {MODEL_CHIPS.map((chip, i) => {
            const chipIn = spring({ frame: frame - chipOffsets[i], fps, config: { damping: 12, stiffness: 120 } });
            const chipOp = interpolate(frame, [chipOffsets[i], chipOffsets[i] + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            return (
              <div key={chip.label} style={{
                fontFamily: ORBITRON,
                fontSize: chipSize,
                fontWeight: 800,
                letterSpacing: '0.3em',
                padding: '0.6em 1.4em',
                border: `2px solid ${chip.color}`,
                background: `${chip.color}22`,
                color: chip.color,
                textShadow: `0 0 20px ${chip.color}`,
                boxShadow: `0 0 40px ${chip.color}66, inset 0 0 20px ${chip.color}22`,
                transform: `scale(${chipIn})`,
                opacity: chipOp,
                borderRadius: 6,
              }}>
                {chip.label}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
