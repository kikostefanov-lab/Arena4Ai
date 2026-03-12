import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { TronGrid } from '../components/TronGrid';
import { ORBITRON, TEXT_MUTED, TEXT_DIM, TEXT_PRIMARY, ACCENT_CYAN } from '../tokens';
import { hexToRgb } from '../utils';

interface WinnerProps {
  data: Pick<ReelData, 'teams' | 'winnerId' | 'synthesisQuote'>;
}

// Radiating spokes burst outward from center
const RadiatingLines: React.FC<{ color: string; intensity: number }> = ({ color, intensity }) => {
  const N = 12;
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 0 }}>
      {Array.from({ length: N }).map((_, i) => {
        const angle = (i / N) * 360;
        const len = interpolate(intensity, [0, 1], [0, 900]);
        const opacity = interpolate(intensity, [0, 0.3, 1], [0, 0.6, 0.15]);
        return (
          <div key={i} style={{
            position: 'absolute',
            width: 2,
            height: len,
            background: `linear-gradient(to bottom, rgba(${hexToRgb(color)}, 0.8), transparent)`,
            transformOrigin: 'top center',
            transform: `rotate(${angle}deg)`,
            opacity,
            borderRadius: 1,
          }} />
        );
      })}
    </div>
  );
};

// Circular score ring drawn as a conic-gradient disc
const ScoreRing: React.FC<{ score: number; color: string; progress: number; size: number }> = ({ score, color, progress, size }) => {
  const filled = progress * score;
  const deg = Math.round(filled * 360);
  const r = hexToRgb(color);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: `conic-gradient(rgba(${r},1) ${deg}deg, rgba(${r},0.12) ${deg}deg)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 40px rgba(${r}, 0.4)`,
      position: 'relative',
    }}>
      {/* Inner fill */}
      <div style={{
        width: size - 20, height: size - 20, borderRadius: '50%',
        background: '#000408',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ fontFamily: ORBITRON, fontSize: size * 0.22, fontWeight: 900, color }}>
          {Math.round(progress * score * 100)}%
        </div>
      </div>
    </div>
  );
};

export const Winner: React.FC<WinnerProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const winner = data.teams.find(t => t.teamId === data.winnerId) ?? data.teams[0];
  const color = winner.color;

  // Spokes burst in from 0
  const spokeProgress = spring({ frame, fps, config: { damping: 150, stiffness: 60 } });
  const spokeIntensity = interpolate(spokeProgress, [0, 1], [0, 1]);

  // Name springs in
  const nameProgress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const nameScale   = interpolate(nameProgress, [0, 1], [0.4, 1]);
  const nameOpacity = interpolate(nameProgress, [0, 1], [0, 1]);

  // Pulsing glow
  const glowIntensity = interpolate(frame, [0, 20, 45, 70, 90], [0, 1, 0.6, 1, 0.7], { extrapolateRight: 'clamp' });
  const glow = `0 0 ${60 * glowIntensity}px rgba(${hexToRgb(color)}, ${0.9 * glowIntensity}), 0 0 ${120 * glowIntensity}px rgba(${hexToRgb(color)}, ${0.4 * glowIntensity})`;

  // Score ring springs in at frame 18
  const ringProgress = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 200, stiffness: 70 } });

  // Criteria rows fade in staggered starting at frame 35
  const topCriteria = [...winner.criteriaScores]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const criteriaOpacities = topCriteria.map((_, i) =>
    interpolate(frame, [35 + i * 10, 50 + i * 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  // Synthesis quote fades at frame 60
  const quoteOpacity = interpolate(frame, [60, 78], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <TronGrid opacity={0.25} />
      <RadiatingLines color={color} intensity={spokeIntensity} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', width: '100%', padding: '0 60px', boxSizing: 'border-box' }}>
        {/* ◆ WINNER ◆ */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 26, letterSpacing: '12px',
          color: TEXT_DIM, textTransform: 'uppercase', marginBottom: 20,
          opacity: nameOpacity,
        }}>
          ◆ WINNER ◆
        </div>

        {/* Model name */}
        <div style={{
          fontFamily: ORBITRON,
          fontSize: 96, fontWeight: 900,
          color,
          textShadow: glow,
          letterSpacing: '4px',
          textTransform: 'uppercase',
          transform: `scale(${nameScale})`,
          opacity: nameOpacity,
          lineHeight: 1,
          marginBottom: 8,
        }}>
          {winner.model.toUpperCase()}
        </div>

        {/* Persona */}
        <div style={{
          fontFamily: ORBITRON, fontSize: 28, color: `rgba(${hexToRgb(color)}, 0.7)`,
          letterSpacing: '6px', textTransform: 'uppercase', marginBottom: 32,
          opacity: nameOpacity,
        }}>
          :{winner.persona}
        </div>

        {/* Score ring + top criteria side by side */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40, marginBottom: 32 }}>
          <ScoreRing score={winner.score} color={color} progress={ringProgress} size={160} />

          {/* Top 3 criteria */}
          {topCriteria.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'left' }}>
              {topCriteria.map((cs, i) => (
                <div key={cs.name} style={{ opacity: criteriaOpacities[i], display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 3, height: 28, background: color, borderRadius: 2, boxShadow: `0 0 8px rgba(${hexToRgb(color)}, 0.6)` }} />
                  <div>
                    <div style={{ fontFamily: ORBITRON, fontSize: 13, color: `rgba(${hexToRgb(color)}, 0.7)`, letterSpacing: '1px', textTransform: 'uppercase' }}>
                      {cs.name}
                    </div>
                    <div style={{ fontFamily: ORBITRON, fontSize: 20, fontWeight: 700, color: TEXT_PRIMARY }}>
                      {Math.round(cs.score * 100)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Synthesis quote */}
        {data.synthesisQuote && (
          <div style={{
            fontSize: 22, color: TEXT_MUTED, fontStyle: 'italic',
            lineHeight: 1.6, maxWidth: 820, margin: '0 auto',
            opacity: quoteOpacity,
          }}>
            "{data.synthesisQuote}"
          </div>
        )}
      </div>
    </div>
  );
};
