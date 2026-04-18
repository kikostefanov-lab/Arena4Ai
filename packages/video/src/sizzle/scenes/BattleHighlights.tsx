import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { useEffect, useRef } from 'react';
import { TronGrid } from '../../components/TronGrid';
import { renderVideoGladiator, GladiatorEvent } from '../../components/VideoGladiator';
import { ACCENT_CYAN, BG_DARK, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, getModelColor } from '../../tokens';

// Three teams + choreographed flash events to make the arena feel alive
const TEAMS = [
  { model: 'claude', color: getModelColor('claude'), facing: 1  as const, xRatio: 0.25 },
  { model: 'codex',  color: getModelColor('codex'),  facing: 1  as const, xRatio: 0.50 },
  { model: 'gemini', color: getModelColor('gemini'), facing: -1 as const, xRatio: 0.75 },
];

const EVENTS_BY_TEAM: Record<string, GladiatorEvent[]> = {
  claude: [
    { frameOffset: 10,  type: 'strike' },
    { frameOffset: 60,  type: 'power'  },
    { frameOffset: 110, type: 'strike' },
    { frameOffset: 170, type: 'power'  },
    { frameOffset: 230, type: 'strike' },
  ],
  codex: [
    { frameOffset: 30,  type: 'power'  },
    { frameOffset: 85,  type: 'strike' },
    { frameOffset: 145, type: 'power'  },
    { frameOffset: 200, type: 'strike' },
  ],
  gemini: [
    { frameOffset: 20,  type: 'strike' },
    { frameOffset: 75,  type: 'power'  },
    { frameOffset: 130, type: 'strike' },
    { frameOffset: 190, type: 'power'  },
    { frameOffset: 250, type: 'strike' },
  ],
};

const TICKER_LINES = [
  { teamLabel: 'CLAUDE',  text: '▸ writing security-architecture.md', start: 15 },
  { teamLabel: 'CODEX',   text: '▸ exec: npm test (18 passing)',      start: 55 },
  { teamLabel: 'GEMINI',  text: '▸ reasoning: pricing tier model',    start: 95 },
  { teamLabel: 'CLAUDE',  text: '▸ writing kms-key-vault.ts',         start: 140 },
  { teamLabel: 'GEMINI',  text: '▸ writing go-to-market.md',          start: 185 },
  { teamLabel: 'CODEX',   text: '▸ generating SDK typings',           start: 230 },
];

export const BattleHighlights: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPortrait = height > width;

  const baseY = height * (isPortrait ? 0.62 : 0.62);
  const scale = Math.min(width, height) * 0.0028;

  // Shockwave pulses when strikes land (simple additive draw on canvas)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);

    // Floor — arena ring
    const ringCx = width / 2;
    const ringCy = baseY + Math.min(width, height) * 0.05;
    const ringRx = width * 0.38;
    const ringRy = Math.min(width, height) * 0.08;
    ctx.save();
    ctx.strokeStyle = 'rgba(0,240,255,0.45)';
    ctx.lineWidth = 2;
    ctx.shadowColor = ACCENT_CYAN;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.ellipse(ringCx, ringCy, ringRx, ringRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Shockwave rings spawned at each flash event
    for (const team of TEAMS) {
      const events = EVENTS_BY_TEAM[team.model] ?? [];
      for (const ev of events) {
        const elapsed = frame - ev.frameOffset;
        if (elapsed < 0 || elapsed > 25) continue;
        const t = elapsed / 25;
        const r = 40 + t * 200;
        ctx.save();
        ctx.strokeStyle = team.color;
        ctx.globalAlpha = (1 - t) * 0.7;
        ctx.lineWidth = 3 * (1 - t) + 0.5;
        ctx.shadowColor = team.color;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(width * team.xRatio, baseY - 40 * scale, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Draw gladiators
    for (const team of TEAMS) {
      const events = EVENTS_BY_TEAM[team.model] ?? [];
      renderVideoGladiator(ctx, {
        teamId: team.model,
        model: team.model,
        color: team.color,
        x: width * team.xRatio,
        y: baseY,
        scale,
        facing: team.facing,
      }, frame, events);
    }
  }, [frame, width, height, baseY, scale]);

  const tickerSize = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);
  const kickerSize = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);

  // Exit
  const exit = interpolate(frame, [280, 300], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />

      {/* LIVE chip */}
      <div style={{
        position: 'absolute',
        top: isPortrait ? '6%' : '6%',
        left: '6%',
        fontFamily: ORBITRON,
        fontSize: kickerSize,
        fontWeight: 800,
        letterSpacing: '0.3em',
        color: '#ff3333',
        padding: '0.4em 0.9em',
        border: '1px solid rgba(255,50,50,0.6)',
        background: 'rgba(255,50,50,0.12)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5em',
        textShadow: '0 0 10px #ff3333',
        opacity: interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        <span style={{
          width: '0.55em', height: '0.55em', borderRadius: '50%',
          background: '#ff3333',
          boxShadow: '0 0 10px #ff3333',
        }} /> LIVE
      </div>

      {/* Event ticker — lines scroll up */}
      <div style={{
        position: 'absolute',
        bottom: isPortrait ? '22%' : '18%',
        left: '6%',
        right: '6%',
        height: isPortrait ? '15%' : '12%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        gap: '0.35em',
        pointerEvents: 'none',
      }}>
        {TICKER_LINES.map((line, i) => {
          const op = interpolate(frame, [line.start, line.start + 10, line.start + 40, line.start + 55], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const y = interpolate(frame, [line.start, line.start + 10], [15, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const color = getModelColor(line.teamLabel.toLowerCase());
          if (op < 0.02) return null;
          return (
            <div key={i} style={{
              fontFamily: ORBITRON,
              fontSize: tickerSize,
              letterSpacing: '0.1em',
              opacity: op,
              transform: `translateY(${y}px)`,
              display: 'flex',
              gap: '0.8em',
              alignItems: 'baseline',
            }}>
              <span style={{ color, fontWeight: 800 }}>{line.teamLabel}</span>
              <span style={{ color: TEXT_MUTED, fontWeight: 500 }}>{line.text}</span>
            </div>
          );
        })}
      </div>

      {/* Watch it happen kicker at bottom */}
      <div style={{
        position: 'absolute',
        bottom: '6%',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: ORBITRON,
        fontSize: Math.min(width, height) * (isPortrait ? 0.036 : 0.028),
        fontWeight: 800,
        letterSpacing: '0.3em',
        textTransform: 'uppercase',
        color: TEXT_PRIMARY,
        textShadow: `0 0 20px ${ACCENT_CYAN}`,
        opacity: interpolate(frame, [60, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        Watch every tool call. Every file write. Every thought.
      </div>
    </AbsoluteFill>
  );
};
