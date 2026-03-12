import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, TEXT_DIM, TEXT_PRIMARY, TEXT_MUTED, ORBITRON, BG_DARK } from '../tokens';
import { hexToRgb } from '../utils';

interface KeyMomentsProps {
  data: Pick<ReelData, 'keyMoments' | 'teams'>;
}

const TYPE_ICONS: Record<string, string> = {
  FILE_CREATE: '📄',
  TOOL_CALL: '⚡',
  ERROR: '⚠',
};

// Each team index gets a distinct swoop direction
const SWOOP_DIRS = [
  (p: number) => ({ x: interpolate(p, [0, 1], [-500, 0]), y: 0 }),   // 0: from left
  (p: number) => ({ x: interpolate(p, [0, 1], [500, 0]), y: 0 }),    // 1: from right
  (p: number) => ({ x: 0, y: interpolate(p, [0, 1], [300, 0]) }),    // 2: from bottom
  (p: number) => ({ x: 0, y: interpolate(p, [0, 1], [-300, 0]) }),   // 3: from top
];

function msToStr(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const KeyMoments: React.FC<KeyMomentsProps> = ({ data }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Map teamId → index for stable swoop direction assignment
  const teamIndexMap = Object.fromEntries(data.teams.map((t, i) => [t.teamId, i]));
  const teamColorMap = Object.fromEntries(data.teams.map(t => [t.teamId, t.color]));
  const teamLabelMap = Object.fromEntries(data.teams.map(t => [t.teamId, `${t.model.toUpperCase()}:${t.persona}`]));

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // Each moment springs in 28 frames apart starting at frame 25
  const momentProgress = data.keyMoments.map((_, i) =>
    spring({ frame: Math.max(0, frame - (25 + i * 28)), fps, config: { damping: 200, stiffness: 90 } })
  );

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 60px',
    }}>
      {/* Header */}
      <div style={{ opacity: titleOpacity, marginBottom: 36 }}>
        <div style={{ fontFamily: ORBITRON, fontSize: 20, color: ACCENT_CYAN, letterSpacing: '6px', textTransform: 'uppercase', marginBottom: 8 }}>
          ◆ KEY MOMENTS
        </div>
        <div style={{ fontSize: 22, color: TEXT_DIM }}>
          How the battle unfolded
        </div>
      </div>

      {/* Moment cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {data.keyMoments.map((moment, i) => {
          const prog = momentProgress[i];
          const teamIdx = teamIndexMap[moment.teamId] ?? 0;
          const swoopFn = SWOOP_DIRS[teamIdx % SWOOP_DIRS.length];
          const { x, y } = swoopFn(prog);
          const opacity = interpolate(prog, [0, 0.3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const color = teamColorMap[moment.teamId] ?? ACCENT_CYAN;
          const label = teamLabelMap[moment.teamId] ?? moment.teamId;
          const icon = TYPE_ICONS[moment.type] ?? '◆';

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'stretch', gap: 0,
              transform: `translate(${x}px, ${y}px)`,
              opacity,
            }}>
              {/* Team color stripe */}
              <div style={{
                width: 6, borderRadius: '3px 0 0 3px', flexShrink: 0,
                background: color,
                boxShadow: `0 0 14px rgba(${hexToRgb(color)}, 0.6)`,
              }} />

              {/* Card body */}
              <div style={{
                flex: 1,
                padding: '16px 20px',
                background: `rgba(${hexToRgb(color)}, 0.07)`,
                border: `1px solid rgba(${hexToRgb(color)}, 0.22)`,
                borderLeft: 'none',
                borderRadius: '0 8px 8px 0',
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                {/* Icon */}
                <div style={{ fontSize: 26, flexShrink: 0 }}>{icon}</div>

                {/* Text */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: ORBITRON, fontSize: 13, color, letterSpacing: '2px', marginBottom: 4, textTransform: 'uppercase' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 22, color: TEXT_PRIMARY, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {moment.label}
                  </div>
                </div>

                {/* Timestamp */}
                <div style={{ fontFamily: ORBITRON, fontSize: 20, color: TEXT_MUTED, flexShrink: 0 }}>
                  {msToStr(moment.relativeMs)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
