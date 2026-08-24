import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, staticFile, spring } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, BG_DARK, BG_CARD, ORBITRON, TEXT_PRIMARY, TEXT_MUTED, getModelColor } from '../../tokens';
import { ARENA_SUMMARY, ARENA_WINNER_ID, ARENA_JUDGE_CARDS } from '../arena-data';

/**
 * Scores come from the SAME competition the screenshot behind them shows.
 *
 * They used to be a hardcoded 87 / 86 / 68 — the real numbers from a different
 * competition than the one on screen. Once the reel was re-cut against another
 * run, the foreground and the background were telling different stories, and the
 * bars would have been presenting one competition's result over another's
 * picture. Generated from `ARENA_SUMMARY` now, so the two cannot diverge again.
 */
/**
 * The winning team's own model, from the stored winnerId.
 *
 * The banner used to hardcode "CLAUDE WINS" and `getModelColor('claude')`. That
 * is the same defect as the hardcoded 87/86/68 scores this file already carries
 * a note about: it renders a result rather than reporting one, and it would keep
 * crowning claude after a re-judge handed the win to somebody else.
 */
const WINNER_MODEL = ARENA_SUMMARY.find((t) => t.id === ARENA_WINNER_ID)?.model ?? 'claude';

/**
 * Each judge's own card, as integer percents, in team order.
 *
 * ARENA_SUMMARY.score is the MEAN across judges, and on this run the mean is the
 * one number nobody can check: the claude judge scored it 83-78 for claude while
 * the codex judge scored it level, 80-80. Averaging those produces a single
 * clean winner and silently discards the disagreement — which is precisely the
 * thing a cross-model panel exists to expose.
 */
const JUDGE_ROWS = ARENA_JUDGE_CARDS.map((card) => ({
  judgeId: card.judgeId,
  cells: ARENA_SUMMARY.map((t) => ({
    model: t.model,
    color: getModelColor(t.model),
    pct: Math.round((card.byTeam[t.id] ?? 0) * 100),
  })),
}));

const SCORES = ARENA_SUMMARY.map((t, i) => ({
  model: t.model,
  score: Math.round((t.score ?? 0) * 100),
  color: getModelColor(t.model),
  // From the stored winnerId, not from max(score): this competition is a TIE on
  // final score, and max() would light up both bars as the winner.
  winner: t.id === ARENA_WINNER_ID,
}));

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
                // FIXED width, not minWidth: the bar track is `flex: 1`, so a
                // label that overflows steals track width and two IDENTICAL
                // scores render as two visibly DIFFERENT bar lengths — the
                // picture contradicting the caption on the one scene whose
                // point is that the scores are level.
                width: '10em',
                flexShrink: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                letterSpacing: '0.05em',
              }}>
                {/* Model only. The stored persona ("turnaround chief pruban") is
                    internal config, reads as gibberish publicly, and the claim
                    this scene makes is about models, not personas. */}
                {s.model}
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

      {/* The panel split — what the average hides */}
      <div style={{
        position: 'absolute',
        bottom: isPortrait ? '26%' : '24%',
        left: 0, right: 0,
        textAlign: 'center',
        fontFamily: ORBITRON,
        opacity: interpolate(frame, [110, 145], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        <div style={{
          fontSize: kickerSize * 0.8,
          fontWeight: 800,
          letterSpacing: '0.35em',
          color: TEXT_MUTED,
          textTransform: 'uppercase',
          marginBottom: '0.7em',
        }}>
          the judges disagreed
        </div>
        {JUDGE_ROWS.map((row) => (
          <div key={row.judgeId} style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'baseline',
            gap: '1.2em',
            fontSize: kickerSize * 0.85,
            marginTop: '0.35em',
          }}>
            {/* nowrap + a column wide enough for the longest judge id: these
                labels carry provider AND model on purpose, and a wrapped
                "ai-codex/gpt-5.6-/sol" reads as a rendering fault rather than
                as the point. */}
            <div style={{
              color: TEXT_MUTED,
              width: '15em',
              textAlign: 'right',
              letterSpacing: '0.03em',
              whiteSpace: 'nowrap',
              fontSize: '0.88em',
            }}>
              {row.judgeId}
            </div>
            {row.cells.map((c) => (
              <div key={c.model} style={{ color: c.color, fontWeight: 800, letterSpacing: '0.08em' }}>
                {c.model} {c.pct}
              </div>
            ))}
          </div>
        ))}
      </div>

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
          color: getModelColor(WINNER_MODEL),
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
          color: getModelColor(WINNER_MODEL),
          textTransform: 'uppercase',
          textShadow: `0 0 40px ${getModelColor(WINNER_MODEL)}, 0 0 80px ${getModelColor(WINNER_MODEL)}55`,
          lineHeight: 1,
        }}>
          {WINNER_MODEL} WINS
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
