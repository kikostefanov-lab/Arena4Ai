import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, staticFile } from 'remotion';
import { TronGrid } from '../../components/TronGrid';
import { ACCENT_CYAN, ACCENT_ORANGE, BG_DARK, BG_CARD, ORBITRON, TEXT_PRIMARY, TEXT_MUTED } from '../../tokens';
import { ARENA_FORGE } from '../arena-data';


export const TheForge: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const isPortrait = height > width;

  // Header
  const headerOp = interpolate(frame, [5, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Real forge tab screengrab dims in as cards settle
  const shotOp   = interpolate(frame, [0, 30], [0, 0.25], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Forge heading callout
  const callOp   = interpolate(frame, [230, 260], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Exit
  const exit     = interpolate(frame, [280, 300], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const kickerSize = Math.min(width, height) * (isPortrait ? 0.022 : 0.018);
  const titleSize  = Math.min(width, height) * (isPortrait ? 0.028 : 0.022);
  const descSize   = Math.min(width, height) * (isPortrait ? 0.02  : 0.016);
  const calloutSize = Math.min(width, height) * (isPortrait ? 0.05 : 0.04);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <TronGrid />

      {/* Real forge tab image — dim backdrop */}
      <AbsoluteFill style={{ opacity: shotOp, filter: 'blur(4px)' }}>
        <Img
          src={staticFile('sizzle-assets/09-forge-tab-full.png')}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      <AbsoluteFill style={{
        background: `linear-gradient(180deg, rgba(0,4,8,0.88) 0%, rgba(5,15,30,0.92) 100%)`,
      }} />

      {/* Header */}
      <div style={{
        position: 'absolute', top: '6%',
        left: 0, right: 0, textAlign: 'center',
        fontFamily: ORBITRON,
        fontSize: kickerSize,
        fontWeight: 800, letterSpacing: '0.4em',
        color: ACCENT_ORANGE,
        textTransform: 'uppercase',
        textShadow: `0 0 18px ${ACCENT_ORANGE}`,
        opacity: headerOp,
      }}>
        ◆ The Forge
      </div>

      {/* Artifact cards — staggered fan-in */}
      <AbsoluteFill style={{
        padding: isPortrait ? '14% 6% 22%' : '9% 8% 18%',
        display: 'grid',
        gridTemplateColumns: isPortrait ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
        gap: '1em',
        alignContent: 'center',
      }}>
        {ARENA_FORGE.map((a, i) => {
          const start = 15 + i * 8;
          const op = interpolate(frame, [start, start + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const y  = interpolate(frame, [start, start + 20], [40, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <div key={a.title} style={{
              background: BG_CARD,
              border: `1px solid ${ACCENT_CYAN}44`,
              borderRadius: 8,
              padding: '1em 1.1em',
              opacity: op,
              transform: `translateY(${y}px)`,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.4em',
              boxShadow: `0 4px 30px rgba(0,240,255,0.05), inset 0 0 20px rgba(0,240,255,0.02)`,
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Format badge top-right */}
              <div style={{
                position: 'absolute', top: 10, right: 12,
                fontFamily: ORBITRON, fontSize: descSize * 0.8,
                fontWeight: 800, letterSpacing: '0.15em',
                color: a.ext === 'pptx' ? ACCENT_ORANGE : ACCENT_CYAN,
                opacity: 0.7,
                textTransform: 'uppercase',
              }}>{a.ext}</div>

              {/* Icon glyph */}
              <div style={{
                fontFamily: ORBITRON, fontSize: titleSize * 1.1,
                color: ACCENT_CYAN,
              }}>◆</div>
              <div style={{
                fontFamily: ORBITRON, fontSize: titleSize,
                fontWeight: 700,
                color: TEXT_PRIMARY,
                letterSpacing: '0.02em',
                lineHeight: 1.2,
              }}>{a.title}</div>
              <div style={{
                fontFamily: ORBITRON, fontSize: descSize,
                fontWeight: 500,
                color: TEXT_MUTED,
                letterSpacing: '0.04em',
                lineHeight: 1.3,
              }}>{a.desc}</div>
            </div>
          );
        })}
      </AbsoluteFill>

      {/* Callout at bottom */}
      <div style={{
        position: 'absolute',
        bottom: '6%',
        left: 0, right: 0,
        textAlign: 'center',
        opacity: callOp,
      }}>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: calloutSize,
          fontWeight: 900,
          letterSpacing: '0.05em',
          color: TEXT_PRIMARY,
          textShadow: `0 0 30px ${ACCENT_CYAN}`,
          lineHeight: 1,
        }}>
          The winner becomes your <span style={{ color: ACCENT_CYAN }}>launch kit.</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
