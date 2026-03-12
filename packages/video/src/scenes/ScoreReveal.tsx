import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_PRIMARY, TEXT_MUTED, TEXT_DIM, BG_DARK, ORBITRON } from '../tokens';
import { hexToRgb } from '../utils';

interface ScoreRevealProps {
  data: Pick<ReelData, 'teams' | 'criteria'>;
}

// Render one criterion row with score bars for all N teams
const CriterionRow: React.FC<{
  criterion: string;
  teams: ReelData['teams'];
  revealProgress: number; // 0–1 spring
  rowOpacity: number;
}> = ({ criterion, teams, revealProgress, rowOpacity }) => (
  <div style={{
    padding: '18px 24px',
    background: 'rgba(0,240,255,0.04)',
    borderRadius: 10,
    border: '1px solid rgba(0,240,255,0.12)',
    opacity: rowOpacity,
  }}>
    {/* Criterion name */}
    <div style={{
      fontFamily: ORBITRON, fontSize: 17, fontWeight: 600,
      color: TEXT_MUTED, letterSpacing: '1px',
      marginBottom: 12, textTransform: 'uppercase',
    }}>
      {criterion}
    </div>

    {/* Score bar per team */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {teams.map(team => {
        const cs = team.criteriaScores.find(s => s.name === criterion);
        const score = cs?.score ?? 0;
        const filled = revealProgress * score;
        const pct = Math.round(score * 100);

        return (
          <div key={team.teamId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Team label */}
            <div style={{
              fontFamily: ORBITRON, fontSize: 14, fontWeight: 700,
              color: team.color, width: 140, flexShrink: 0,
              textTransform: 'uppercase', letterSpacing: '1px',
            }}>
              {team.model}
            </div>
            {/* Bar track */}
            <div style={{
              flex: 1, height: 16, borderRadius: 8,
              background: `rgba(${hexToRgb(team.color)}, 0.12)`,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0,
                width: `${filled * 100}%`,
                background: team.color,
                borderRadius: 8,
                boxShadow: `0 0 10px rgba(${hexToRgb(team.color)}, 0.5)`,
              }} />
            </div>
            {/* Score pct */}
            <div style={{
              fontFamily: ORBITRON, fontSize: 17, fontWeight: 700,
              color: team.color, width: 52, textAlign: 'right', flexShrink: 0,
            }}>
              {Math.round(revealProgress * pct)}%
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

export const ScoreReveal: React.FC<ScoreRevealProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const SCENE_FRAMES = 330;

  // Score bars animate in per-criterion, staggered
  const criterionProgress = data.criteria.map((_, i) =>
    spring({ frame: Math.max(0, frame - (20 + i * 32)), fps, config: { damping: 200, stiffness: 80 } })
  );
  const criterionOpacity = data.criteria.map((_, i) =>
    interpolate(frame, [20 + i * 32, 36 + i * 32], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  );

  // Total score row springs in near end
  const totalDelay = 20 + data.criteria.length * 32 + 10;
  const totalProgress = spring({ frame: Math.max(0, frame - totalDelay), fps, config: { damping: 200, stiffness: 80 } });
  const totalOpacity = interpolate(frame, [totalDelay, totalDelay + 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Ken Burns: start slightly zoomed in at top, slowly pan down and zoom out
  // Content height estimate: header(80) + N_criteria*(120) + total(80) + padding
  const contentH = 80 + data.criteria.length * 140 + 100;
  const screenH = 1920;
  const overflow = Math.max(0, contentH - screenH);

  // Pan from 0 to -overflow over the scene, ease in/out
  const panProgress = interpolate(frame, [0, SCENE_FRAMES], [0, 1], { extrapolateRight: 'clamp' });
  const panY = interpolate(panProgress, [0, 0.15, 0.85, 1], [0, 0, -overflow, -overflow]);
  const scale = interpolate(frame, [0, SCENE_FRAMES * 0.5, SCENE_FRAMES], [1.06, 1.04, 1.0]);

  const headerOpacity = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Ken Burns wrapper */}
      <div style={{
        width: '100%',
        transform: `translateY(${panY}px) scale(${scale})`,
        transformOrigin: 'top center',
        padding: '60px 60px 80px',
        boxSizing: 'border-box',
      }}>
        {/* Header */}
        <div style={{ opacity: headerOpacity, marginBottom: 32 }}>
          <div style={{ fontFamily: ORBITRON, fontSize: 20, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', marginBottom: 10 }}>
            ◆ SCORES
          </div>
          {/* Team legend */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {data.teams.map(team => (
              <div key={team.teamId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: team.color, boxShadow: `0 0 8px ${team.color}` }} />
                <span style={{ fontFamily: ORBITRON, fontSize: 16, color: team.color, letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {team.model}:{team.persona}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Criterion rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {data.criteria.map((criterion, i) => (
            <CriterionRow
              key={criterion}
              criterion={criterion}
              teams={data.teams}
              revealProgress={criterionProgress[i]}
              rowOpacity={criterionOpacity[i]}
            />
          ))}
        </div>

        {/* Total scores row */}
        <div style={{
          marginTop: 24,
          padding: '22px 24px',
          background: 'rgba(0,240,255,0.08)',
          borderRadius: 10,
          border: `1.5px solid rgba(0,240,255,0.3)`,
          opacity: totalOpacity,
        }}>
          <div style={{
            fontFamily: ORBITRON, fontSize: 19, fontWeight: 900,
            color: ACCENT_CYAN, letterSpacing: '4px',
            textTransform: 'uppercase', marginBottom: 14,
          }}>
            FINAL SCORES
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {[...data.teams]
              .sort((a, b) => b.score - a.score)
              .map((team, rank) => (
                <div key={team.teamId} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 20px',
                  background: `rgba(${hexToRgb(team.color)}, 0.1)`,
                  border: `1px solid rgba(${hexToRgb(team.color)}, 0.35)`,
                  borderRadius: 8,
                }}>
                  <div style={{ fontFamily: ORBITRON, fontSize: 20, color: TEXT_DIM }}>#{rank + 1}</div>
                  <div style={{ fontFamily: ORBITRON, fontSize: 20, fontWeight: 700, color: team.color, textTransform: 'uppercase' }}>
                    {team.model}:{team.persona}
                  </div>
                  <div style={{ fontFamily: ORBITRON, fontSize: 26, fontWeight: 900, color: TEXT_PRIMARY }}>
                    {Math.round(totalProgress * team.score * 100)}%
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};
