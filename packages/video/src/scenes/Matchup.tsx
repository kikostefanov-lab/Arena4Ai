import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { ModelBadge } from '../components/ModelBadge';
import { TronGrid } from '../components/TronGrid';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON } from '../tokens';

interface MatchupProps {
  data: Pick<ReelData, 'teams' | 'briefTitle'>;
}

// Each team gets a unique swoop direction based on its position
function swoopTransform(index: number, total: number, progress: number): string {
  if (total === 1) return '';
  const mid = (total - 1) / 2;
  if (index < mid) {
    // left-side teams fly in from the left
    return `translateX(${interpolate(progress, [0, 1], [-500, 0])}px)`;
  }
  if (index > mid) {
    // right-side teams fly in from the right
    return `translateX(${interpolate(progress, [0, 1], [500, 0])}px)`;
  }
  // exact middle (odd count) drops from top
  return `translateY(${interpolate(progress, [0, 1], [-300, 0])}px)`;
}

export const Matchup: React.FC<MatchupProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const total = data.teams.length;

  // Each team springs in with a per-team stagger
  const teamProgress = data.teams.map((_, i) =>
    spring({ frame: Math.max(0, frame - i * 8), fps, config: { damping: 200, stiffness: 80 } })
  );

  // VS pulses in after all teams have arrived
  const vsDelay = total * 8 + 10;
  const vsProgress = spring({ frame: Math.max(0, frame - vsDelay), fps, config: { damping: 300, stiffness: 150 } });
  const vsScale   = interpolate(vsProgress, [0, 1], [0, 1]);
  const vsOpacity = interpolate(vsProgress, [0, 1], [0, 1]);

  // Brief title fades in after VS
  const titleStart = vsDelay + 15;
  const titleOpacity = interpolate(frame, [titleStart, titleStart + 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  const badgeSize = total <= 2 ? 'lg' : total === 3 ? 'md' : 'sm';
  const vsFontSize = total <= 2 ? 64 : 40;

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 48,
    }}>
      <TronGrid opacity={0.5} />

      {/* Teams row with VS between each */}
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexWrap: 'nowrap',
      }}>
        {data.teams.map((team, i) => {
          const prog = teamProgress[i];
          const opacity = interpolate(prog, [0, 1], [0, 1]);
          const transform = swoopTransform(i, total, prog);

          return (
            <div key={team.teamId} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ transform, opacity, margin: '0 16px' }}>
                <ModelBadge
                  model={team.model}
                  persona={team.persona}
                  color={team.color}
                  size={badgeSize}
                />
              </div>

              {i < total - 1 && (
                <div style={{
                  fontFamily: ORBITRON,
                  fontSize: vsFontSize,
                  fontWeight: 900,
                  color: ACCENT_CYAN,
                  textShadow: `0 0 30px rgba(0,240,255,0.8)`,
                  transform: `scale(${vsScale})`,
                  opacity: vsOpacity,
                  minWidth: vsFontSize + 16,
                  textAlign: 'center',
                }}>
                  VS
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Brief title */}
      <div style={{
        position: 'relative', zIndex: 1,
        fontFamily: ORBITRON,
        fontSize: total <= 2 ? 32 : 26,
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
