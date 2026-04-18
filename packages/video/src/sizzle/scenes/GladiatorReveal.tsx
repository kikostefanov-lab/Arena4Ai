import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { useEffect, useRef } from 'react';
import { TronGrid } from '../../components/TronGrid';
import { renderVideoGladiator } from '../../components/VideoGladiator';
import { ACCENT_CYAN, BG_DARK, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, getModelColor } from '../../tokens';

const GLADIATORS = [
  { model: 'claude', color: getModelColor('claude'), label: 'CLAUDE', swoopFrom: 'left'   as const, swoopFrame: 0 },
  { model: 'codex',  color: getModelColor('codex'),  label: 'CODEX',  swoopFrom: 'top'    as const, swoopFrame: 12 },
  { model: 'gemini', color: getModelColor('gemini'), label: 'GEMINI', swoopFrom: 'right'  as const, swoopFrame: 24 },
];

export const GladiatorReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPortrait = height > width;

  // VS header
  const headerOpacity = interpolate(frame, [75, 100], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Exit
  const exit = interpolate(frame, [190, 210], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Canvas rendering — 3 gladiators positioned in the ring
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    // Gladiator base positions (center of figure)
    const cx = width / 2;
    const baseY = height * (isPortrait ? 0.62 : 0.62);
    const spread = width * (isPortrait ? 0.35 : 0.28);
    const scale = Math.min(width, height) * 0.0028; // ~2.5–3 at 1080

    const positions = [
      { x: cx - spread, y: baseY, facing: 1 as const },
      { x: cx,          y: baseY - height * (isPortrait ? 0.04 : 0.03), facing: 1 as const },
      { x: cx + spread, y: baseY, facing: -1 as const },
    ];

    for (let i = 0; i < GLADIATORS.length; i++) {
      const g = GLADIATORS[i];
      const pos = positions[i];

      // Swoop-in offset
      const t = Math.min(1, Math.max(0, (frame - g.swoopFrame) / 30));
      const easedT = 1 - Math.pow(1 - t, 3); // easeOutCubic
      let offX = 0, offY = 0;
      if (g.swoopFrom === 'left')  offX = (easedT - 1) * width * 0.8;
      if (g.swoopFrom === 'right') offX = (1 - easedT) * width * 0.8;
      if (g.swoopFrom === 'top')   offY = (easedT - 1) * height * 0.6;
      const op = t;

      if (op <= 0) continue;
      ctx.save();
      ctx.globalAlpha = op;
      renderVideoGladiator(ctx, {
        teamId: g.model,
        model: g.model,
        color: g.color,
        x: pos.x + offX,
        y: pos.y + offY,
        scale,
        facing: pos.facing,
      }, frame, []);
      ctx.restore();
    }
  }, [frame, width, height, isPortrait]);

  const headerSize = Math.min(width, height) * (isPortrait ? 0.042 : 0.03);
  const vsSize     = Math.min(width, height) * (isPortrait ? 0.07 : 0.055);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      <AbsoluteFill style={{
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: isPortrait ? '8%' : '6%',
        opacity: headerOpacity,
        pointerEvents: 'none',
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: headerSize,
          fontWeight: 800,
          letterSpacing: '0.4em',
          color: ACCENT_CYAN,
          textTransform: 'uppercase',
          textShadow: `0 0 16px ${ACCENT_CYAN}`,
        }}>
          ◆ Enter the Arena
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: vsSize,
          fontWeight: 900,
          letterSpacing: '0.15em',
          color: TEXT_PRIMARY,
          marginTop: '0.8em',
          textShadow: `0 0 30px rgba(0,240,255,0.5)`,
        }}>
          Three agents. One brief.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
