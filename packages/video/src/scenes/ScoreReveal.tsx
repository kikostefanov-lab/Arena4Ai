import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ScoreBar } from '../components/ScoreBar';
import { ACCENT_CYAN, ORBITRON, BG_DARK } from '../tokens';

interface ScoreRevealProps {
  data: Pick<ReelData, 'teams' | 'criteria'>;
}

export const ScoreReveal: React.FC<ScoreRevealProps> = ({ data }) => {
  const frame = useCurrentFrame();

  const [teamA, teamB] = data.teams;
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Header */}
      <div style={{ opacity: titleOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ◆ SCORES
        </div>
        {/* Team labels */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingLeft: 132 }}>
          <div style={{ fontSize: 22, color: teamA.color, fontWeight: 700, width: 'calc(50% - 60px)' }}>
            {teamA.model.toUpperCase()}
          </div>
          <div style={{ fontSize: 22, color: teamB.color, fontWeight: 700, width: 'calc(50% - 60px)' }}>
            {teamB.model.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Criterion bars — each bar starts animating 40 frames apart */}
      {data.criteria.map((criterion, i) => {
        const aScore = teamA.criteriaScores.find(s => s.name === criterion);
        const bScore = teamB.criteriaScores.find(s => s.name === criterion);

        return (
          <ScoreBar
            key={criterion}
            label={criterion}
            teamA={{ score: aScore?.score ?? 0, color: teamA.color, label: teamA.model.toUpperCase() }}
            teamB={{ score: bScore?.score ?? 0, color: teamB.color, label: teamB.model.toUpperCase() }}
            startFrame={15 + i * 40}
            commentary={aScore?.commentary}
          />
        );
      })}
    </div>
  );
};
