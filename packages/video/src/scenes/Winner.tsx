import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { TronGrid } from '../components/TronGrid';
import { ORBITRON, TEXT_MUTED, TEXT_DIM } from '../tokens';
import { hexToRgb } from '../utils';

interface WinnerProps {
  data: Pick<ReelData, 'teams' | 'winnerId' | 'synthesisQuote'>;
}

export const Winner: React.FC<WinnerProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const winner = data.teams.find(t => t.teamId === data.winnerId) ?? data.teams[0];

  // Winner name springs in
  const nameProgress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const nameScale   = interpolate(nameProgress, [0, 1], [0.5, 1]);
  const nameOpacity = interpolate(nameProgress, [0, 1], [0, 1]);

  // Glow pulses: 0→1→0 over full scene
  const glowIntensity = interpolate(frame, [0, 30, 60, 90], [0, 1, 0.7, 1], { extrapolateRight: 'clamp' });

  // Score fades in at frame 30
  const scoreOpacity = interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Synthesis quote fades at frame 50
  const quoteOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const glowColor = winner.color;
  const glow = `0 0 ${40 * glowIntensity}px rgba(${hexToRgb(glowColor)}, ${0.8 * glowIntensity})`;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <TronGrid opacity={0.4} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        {/* WINNER label */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 28, letterSpacing: '10px',
          color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 16,
          opacity: nameOpacity,
        }}>
          ◆ WINNER ◆
        </div>

        {/* Winner model name */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 120,
          fontWeight: 900,
          color: glowColor,
          textShadow: glow,
          letterSpacing: '4px',
          textTransform: 'uppercase',
          transform: `scale(${nameScale})`,
          opacity: nameOpacity,
        }}>
          {winner.model.toUpperCase()}
        </div>

        {/* Persona + score */}
        <div style={{ opacity: scoreOpacity, marginTop: 16 }}>
          <div style={{ fontSize: 32, color: TEXT_MUTED, letterSpacing: '4px' }}>
            :{winner.persona} · {Math.round(winner.score * 100)}%
          </div>
        </div>

        {/* Synthesis quote */}
        {data.synthesisQuote && (
          <div style={{
            fontSize: 24, color: TEXT_DIM, fontStyle: 'italic',
            maxWidth: 800, lineHeight: 1.6, marginTop: 32,
            opacity: quoteOpacity, textAlign: 'center', paddingLeft: 40, paddingRight: 40,
          }}>
            "{data.synthesisQuote}"
          </div>
        )}
      </div>
    </div>
  );
};
