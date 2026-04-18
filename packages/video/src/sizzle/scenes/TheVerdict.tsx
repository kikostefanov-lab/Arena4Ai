import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, staticFile, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, BG_DARK, BG_CARD, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, getModelColor } from '../../tokens';

const SCORES = [
  { model: 'claude', persona: 'architect',  score: 87, color: getModelColor('claude'), winner: true },
  { model: 'codex',  persona: 'adversarial', score: 86, color: getModelColor('codex'), winner: false },
  { model: 'gemini', persona: 'pioneer',    score: 68, color: getModelColor('gemini'), winner: false },
];

export const TheVerdict: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const isPortrait = height > width;

  // Judge scan beam
  const scanX = interpolate(frame, [0, 60], [-1.2, 1.2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scanOp = interpolate(frame, [0, 30, 60, 75], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Scorecard panels
  const panelOp = interpolate(frame, [50, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const panelY  = interpolate(frame, [50, 90], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Real scores tab screengrab — subtle backdrop
  const shotOp = interpolate(frame, [5, 40], [0, 0.35], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Winner stamp
  const winnerIn = spring({ frame: Math.max(0, frame - 180), fps, config: { damping: 12, stiffness: 100 } });
  const winnerOp = interpolate(frame, [180, 210], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Exit
  const exit = interpolate(frame, [280, 300], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const titleSize = Math.min(width, height) * (isPortrait ? 0.032 : 0.026);
  const scoreSize = Math.min(width, height) * (isPortrait ? 0.06 : 0.045);
  const labelSize = Math.min(width, height) * (isPortrait ? 0.024 : 0.019);
  const kickerSize = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);

  const winnerSize = Math.min(width, height) * (isPortrait ? 0.08 : 0.06);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      {/* Real scores tab screengrab as atmospheric backdrop */}
      <AbsoluteFill style={{ opacity: shotOp, filter: 'blur(3px)' }}>
        <Img
          src={staticFile('sizzle-assets/06-scores-tab.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      <AbsoluteFill style={{
        background: `linear-gradient(180deg, rgba(0,4,8,0.85) 0%, rgba(5,15,30,0.92) 100%)`,
      }} />

      {/* Scan beam */}
      <AbsoluteFill style={{
        background: `linear-gradient(90deg, transparent 40%, ${ACCENT_ORANGE}40 50%, transparent 60%)`,
        transform: `translateX(${scanX * 100}%)`,
        opacity: scanOp,
        mixBlendMode: 'screen',
      }} />

      {/* Header */}
      <div style={{
        position: 'absolute', top: isPortrait ? '8%' : '6%',
        left: 0, right: 0, textAlign: 'center',
        fontFamily: ORBITRON,
        fontSize: kickerSize,
        fontWeight: 800, letterSpacing: '0.4em',
        color: ACCENT_ORANGE,
        textTransform: 'uppercase',
        textShadow: `0 0 20px ${ACCENT_ORANGE}`,
        opacity: interpolate(frame, [20, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        ◆ Judging · cross-model panel
      </div>

      {/* Scorecards */}
      <AbsoluteFill style={{
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6%',
        gap: '1em',
        opacity: panelOp,
        transform: `translateY(${panelY}px)`,
      }}>
        {SCORES.map((s, i) => {
          const start = 60 + i * 15;
          const barFill = interpolate(frame, [start, start + 45], [0, s.score], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const rowOp  = interpolate(frame, [start, start + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={s.model} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1em',
              width: isPortrait ? '88%' : '70%',
              padding: '1em 1.25em',
              background: BG_CARD,
              border: `1px solid ${s.color}55`,
              borderRadius: 8,
              opacity: rowOp,
              boxShadow: s.winner ? `0 0 40px ${s.color}66` : 'none',
            }}>
              <div style={{
                fontFamily: ORBITRON,
                fontSize: titleSize,
                fontWeight: 800,
                color: s.color,
                minWidth: '10em',
                letterSpacing: '0.05em',
              }}>
                {s.model}:{s.persona}
              </div>
              <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  width: `${barFill}%`, height: '100%',
                  background: `linear-gradient(90deg, ${s.color}88, ${s.color})`,
                  boxShadow: `0 0 10px ${s.color}`,
                }} />
              </div>
              <div style={{
                fontFamily: ORBITRON,
                fontSize: scoreSize * 0.6,
                fontWeight: 900,
                color: s.color,
                minWidth: '2.5em',
                textAlign: 'right',
                textShadow: `0 0 15px ${s.color}`,
              }}>
                {Math.round(barFill)}%
              </div>
            </div>
          );
        })}
      </AbsoluteFill>

      {/* Winner banner at bottom */}
      <div style={{
        position: 'absolute',
        bottom: isPortrait ? '10%' : '8%',
        left: 0, right: 0,
        textAlign: 'center',
        opacity: winnerOp,
        transform: `scale(${winnerIn})`,
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: labelSize,
          fontWeight: 800,
          letterSpacing: '0.5em',
          color: getModelColor('claude'),
          textTransform: 'uppercase',
          marginBottom: '0.4em',
        }}>
          ◆ Victor ◆
        </div>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: winnerSize,
          fontWeight: 900,
          letterSpacing: '0.1em',
          color: getModelColor('claude'),
          textTransform: 'uppercase',
          textShadow: `0 0 40px ${getModelColor('claude')}, 0 0 80px ${getModelColor('claude')}55`,
          lineHeight: 1,
        }}>
          CLAUDE WINS
        </div>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: kickerSize,
          fontWeight: 700,
          letterSpacing: '0.25em',
          textTransform: 'uppercase',
          color: TEXT_MUTED,
          marginTop: '0.8em',
        }}>
          Transparent rubric. Scored against your criteria.
        </div>
      </div>
    </AbsoluteFill>
  );
};
