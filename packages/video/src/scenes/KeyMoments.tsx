import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { EventRow } from '../components/EventRow';
import { ACCENT_CYAN, TEXT_DIM, ORBITRON, BG_DARK } from '../tokens';

interface KeyMomentsProps {
  data: Pick<ReelData, 'keyMoments' | 'teams'>;
}

export const KeyMoments: React.FC<KeyMomentsProps> = ({ data }) => {
  const frame = useCurrentFrame();

  // Title fades in
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // Each moment fades in staggered (every 25 frames starting at frame 20)
  const momentOpacities = data.keyMoments.map((_, i) =>
    interpolate(frame, [20 + i * 25, 40 + i * 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  // Build team color lookup
  const teamColorMap = Object.fromEntries(data.teams.map(t => [t.teamId, t.color]));
  const teamLabelMap = Object.fromEntries(data.teams.map(t => [t.teamId, t.model.toUpperCase()]));

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Section header */}
      <div style={{ opacity: titleOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ◆ KEY MOMENTS
        </div>
        <div style={{ fontSize: 24, color: TEXT_DIM }}>
          How the battle unfolded
        </div>
      </div>

      {/* Moment rows */}
      {data.keyMoments.map((moment, i) => (
        <EventRow
          key={i}
          moment={moment}
          teamColor={teamColorMap[moment.teamId] ?? '#4a8fa8'}
          teamLabel={teamLabelMap[moment.teamId] ?? moment.teamId}
          opacity={momentOpacities[i]}
        />
      ))}
    </div>
  );
};
