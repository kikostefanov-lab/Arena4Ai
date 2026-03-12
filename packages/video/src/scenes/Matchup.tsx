import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { ModelBadge } from '../components/ModelBadge';
import { TronGrid } from '../components/TronGrid';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON } from '../tokens';

interface MatchupProps {
  data: Pick<ReelData, 'teams' | 'briefTitle'>;
}

export const Matchup: React.FC<MatchupProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const [teamA, teamB] = data.teams;

  // Left team slides in from left
  const leftProgress = spring({ frame, fps, config: { damping: 200, stiffness: 80 } });
  const leftX = interpolate(leftProgress, [0, 1], [-300, 0]);

  // Right team slides in from right
  const rightProgress = spring({ frame: Math.max(0, frame - 8), fps, config: { damping: 200, stiffness: 80 } });
  const rightX = interpolate(rightProgress, [0, 1], [300, 0]);

  // VS pulses in at frame 20
  const vsProgress = spring({ frame: Math.max(0, frame - 20), fps, config: { damping: 300, stiffness: 150 } });
  const vsScale   = interpolate(vsProgress, [0, 1], [0, 1]);
  const vsOpacity = interpolate(vsProgress, [0, 1], [0, 1]);

  // Brief title fades in at frame 50
  const titleOpacity = interpolate(frame, [50, 70], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 48 }}>
      <TronGrid opacity={0.5} />

      {/* Team matchup row */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 40 }}>
        <div style={{ transform: `translateX(${leftX}px)` }}>
          <ModelBadge model={teamA.model} persona={teamA.persona} color={teamA.color} size="lg" />
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: 64,
          fontWeight: 900,
          color: ACCENT_CYAN,
          textShadow: `0 0 30px rgba(0,240,255,0.8)`,
          transform: `scale(${vsScale})`,
          opacity: vsOpacity,
          minWidth: 80,
          textAlign: 'center',
        }}>
          VS
        </div>

        <div style={{ transform: `translateX(${rightX}px)` }}>
          <ModelBadge model={teamB.model} persona={teamB.persona} color={teamB.color} size="lg" />
        </div>
      </div>

      {/* Brief title */}
      <div style={{
        position: 'relative', zIndex: 1,
        fontFamily: ORBITRON,
        fontSize: 32,
        color: TEXT_DIM,
        letterSpacing: '3px',
        textAlign: 'center',
        opacity: titleOpacity,
        paddingLeft: 60,
        paddingRight: 60,
      }}>
        {data.briefTitle.toUpperCase()}
      </div>
    </div>
  );
};
