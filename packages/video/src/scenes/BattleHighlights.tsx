// packages/video/src/scenes/BattleHighlights.tsx

import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { useRef, useEffect, useMemo } from 'react';
import { TronGrid } from '../components/TronGrid';
import { renderVideoGladiator } from '../components/VideoGladiator';
import type { ReelData } from '../types';
import { ACCENT_CYAN, ORBITRON, BG_DARK } from '../tokens';

interface BattleHighlightsProps {
  data: Pick<ReelData, 'teams' | 'keyEvents'>;
}

export const BattleHighlights: React.FC<BattleHighlightsProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Title fade-in
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Scene fade-out
  const sceneOpacity = interpolate(frame, [160, 180], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Position gladiators — stable across frames (only changes if teams/dimensions change)
  const gladiatorConfigs = useMemo(() => data.teams.map((team, i) => {
    const total = data.teams.length;
    let x: number, facing: 1 | -1;
    if (total === 2) {
      x = i === 0 ? width * 0.3 : width * 0.7;
      facing = i === 0 ? 1 : -1;
    } else {
      const angle = (Math.PI * 2 / total) * i - Math.PI / 2;
      x = width / 2 + Math.cos(angle) * width * 0.25;
      facing = x < width / 2 ? 1 : -1;
    }
    return {
      teamId: team.teamId,
      model: team.model,
      color: team.color,
      x,
      y: height * 0.55,
      scale: 2.8,
      facing,
    };
  }), [data.teams, width, height]);

  // Split keyEvents by team — stable across frames
  const eventsByTeam = useMemo(() => {
    const map = new Map<string, { frameOffset: number; type: 'strike' | 'power' | 'hit' }[]>();
    for (const team of data.teams) map.set(team.teamId, []);
    for (const ev of data.keyEvents) {
      const arr = map.get(ev.teamId);
      if (arr) arr.push({ frameOffset: ev.frameOffset, type: ev.type });
    }
    return map;
  }, [data.teams, data.keyEvents]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    for (const config of gladiatorConfigs) {
      const teamEvents = eventsByTeam.get(config.teamId) || [];
      renderVideoGladiator(ctx, config, frame, teamEvents);
    }
  }, [frame, width, height, gladiatorConfigs, eventsByTeam]);

  return (
    <div style={{
      width: '100%', height: '100%', position: 'relative',
      backgroundColor: BG_DARK,
      opacity: sceneOpacity,
    }}>
      <TronGrid opacity={0.4} />

      {/* Canvas for gladiators */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      />

      {/* Title overlay */}
      <div style={{
        position: 'absolute', top: 60, left: 0, right: 0,
        textAlign: 'center',
        fontFamily: ORBITRON,
        fontSize: 36,
        fontWeight: 900,
        color: ACCENT_CYAN,
        letterSpacing: '4px',
        textShadow: `0 0 30px rgba(0,240,255,0.6)`,
        opacity: titleOpacity,
        zIndex: 2,
      }}>
        BATTLE HIGHLIGHTS
      </div>

      {/* Team labels */}
      <div style={{
        position: 'absolute', bottom: 80, left: 0, right: 0,
        display: 'flex', justifyContent: 'space-around',
        padding: '0 60px',
        zIndex: 2,
      }}>
        {data.teams.map((team) => (
          <div key={team.teamId} style={{
            fontFamily: ORBITRON,
            fontSize: 18,
            color: team.color,
            textShadow: `0 0 12px ${team.color}`,
            textAlign: 'center',
            opacity: titleOpacity,
          }}>
            {team.label.toUpperCase()}
          </div>
        ))}
      </div>
    </div>
  );
};
