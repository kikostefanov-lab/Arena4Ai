import { useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';
import { TEXT_DIM } from '../tokens';
import { hexToRgb } from '../utils';

interface ScoreBarProps {
  label: string;
  teamA: { score: number; color: string; label: string };
  teamB: { score: number; color: string; label: string };
  /** Frame at which the animation starts (relative to the scene, not composition) */
  startFrame: number;
  /** Optional commentary text shown below */
  commentary?: string;
}

export const ScoreBar: React.FC<ScoreBarProps> = ({ label, teamA, teamB, startFrame, commentary }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: Math.max(0, frame - startFrame),
    fps,
    config: { damping: 200, stiffness: 100, mass: 0.5 },
  });

  const scoreA = interpolate(progress, [0, 1], [0, teamA.score]);
  const scoreB = interpolate(progress, [0, 1], [0, teamB.score]);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 22, color: TEXT_DIM, letterSpacing: '2px', marginBottom: 8, textTransform: 'uppercase' }}>
        {label}
      </div>

      {/* Team A bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div style={{ width: 120, fontSize: 20, color: teamA.color, textAlign: 'right', flexShrink: 0 }}>
          {teamA.label}
        </div>
        <div style={{ flex: 1, height: 16, background: `rgba(255,255,255,0.06)`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            width: `${scoreA * 100}%`,
            height: '100%',
            background: teamA.color,
            borderRadius: 8,
            boxShadow: `0 0 12px rgba(${hexToRgb(teamA.color)}, 0.5)`,
            transition: 'none',
          }} />
        </div>
        <div style={{ width: 60, fontSize: 22, color: teamA.color, fontWeight: 700, flexShrink: 0 }}>
          {Math.round(scoreA * 100)}%
        </div>
      </div>

      {/* Team B bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: commentary ? 10 : 0 }}>
        <div style={{ width: 120, fontSize: 20, color: teamB.color, textAlign: 'right', flexShrink: 0 }}>
          {teamB.label}
        </div>
        <div style={{ flex: 1, height: 16, background: `rgba(255,255,255,0.06)`, borderRadius: 8, overflow: 'hidden' }}>
          <div style={{
            width: `${scoreB * 100}%`,
            height: '100%',
            background: teamB.color,
            borderRadius: 8,
            boxShadow: `0 0 12px rgba(${hexToRgb(teamB.color)}, 0.5)`,
            transition: 'none',
          }} />
        </div>
        <div style={{ width: 60, fontSize: 22, color: teamB.color, fontWeight: 700, flexShrink: 0 }}>
          {Math.round(scoreB * 100)}%
        </div>
      </div>

      {commentary && (
        <div style={{ fontSize: 18, color: TEXT_DIM, fontStyle: 'italic', paddingLeft: 132, lineHeight: 1.5 }}>
          {commentary}
        </div>
      )}
    </div>
  );
};
