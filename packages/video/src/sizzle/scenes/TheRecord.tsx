import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
import { ACCENT_CYAN, BG_DARK, ORBITRON, MONO, TEXT_PRIMARY, TEXT_DIM, getModelColor } from '../../tokens';

/**
 * The three-provider claim, evidenced in aggregate rather than by one match.
 *
 * The reel used to rest that claim on a single three-way competition. This is
 * stronger: the stats page is a win-rate table over EVERY competition the
 * platform has run, with all three providers in it. One three-way match shows
 * the thing can happen; twenty-six show it happens repeatedly. It also survives
 * the reel being re-cut against a two-team competition, which the single-match
 * version did not.
 *
 * Nothing here is styled data — it is the product's own page, screenshotted.
 */

const PROVIDERS = ['claude', 'codex', 'gemini'] as const;

export const TheRecord: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const isPortrait = height > width;

  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Slow push on the screenshot so a static image still has motion under it.
  const zoom = interpolate(frame, [0, durationInFrames], [1.04, 1.14], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const kicker = Math.min(width, height) * (isPortrait ? 0.021 : 0.015);
  const headline = Math.min(width, height) * (isPortrait ? 0.055 : 0.044);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img
          src={staticFile('sizzle-assets/04-stats.png')}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center top',
            transform: `scale(${zoom})`,
            opacity: 0.34 * fadeIn,
          }}
        />
      </AbsoluteFill>

      {/* Legibility wash — the table underneath is evidence, not the subject. */}
      <AbsoluteFill style={{
        background: `linear-gradient(180deg, rgba(0,4,8,0.86) 0%, rgba(0,4,8,0.55) 45%, rgba(0,4,8,0.92) 100%)`,
      }} />

      <AbsoluteFill style={{
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        padding: '0 6%',
        opacity: fadeIn,
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: kicker,
          fontWeight: 800,
          letterSpacing: '0.42em',
          color: TEXT_DIM,
          textTransform: 'uppercase',
        }}>
          not one match — the record
        </div>

        <div style={{
          fontFamily: ORBITRON,
          fontSize: headline,
          fontWeight: 900,
          color: TEXT_PRIMARY,
          marginTop: '0.45em',
          lineHeight: 1.05,
        }}>
          26 COMPETITIONS
        </div>

        <div style={{
          marginTop: '0.9em',
          display: 'flex',
          gap: isPortrait ? '1.1em' : '1.6em',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          fontFamily: ORBITRON,
          fontSize: kicker * 1.5,
          fontWeight: 800,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        }}>
          {PROVIDERS.map((p, i) => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5em' }}>
              {i > 0 && <span style={{ color: TEXT_DIM, opacity: 0.5 }}>·</span>}
              <span style={{
                width: '0.5em', height: '0.5em', borderRadius: '50%',
                background: getModelColor(p), boxShadow: `0 0 14px ${getModelColor(p)}`,
              }} />
              <span style={{ color: getModelColor(p) }}>{p}</span>
            </span>
          ))}
        </div>

        <div style={{
          marginTop: '1.1em',
          fontFamily: MONO,
          fontSize: kicker * 1.05,
          letterSpacing: '0.16em',
          color: ACCENT_CYAN,
          opacity: interpolate(frame, [26, 46], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}>
          win rates, head to head, on your machine
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
