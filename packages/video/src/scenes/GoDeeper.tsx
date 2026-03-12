import { useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { ACCENT_CYAN, ACCENT_ORANGE, ACCENT_GOLD, TEXT_MUTED, TEXT_DIM, ORBITRON, BG_DARK } from '../tokens';

interface GoDeeperProps {
  data: Pick<ReelData, 'hasSynthesis' | 'hasForge'>;
}

export const GoDeeper: React.FC<GoDeeperProps> = ({ data }) => {
  const frame = useCurrentFrame();

  const kickerOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // Synthesis card fades + slides in at frame 25
  const synthOpacity = interpolate(frame, [25, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const synthY       = interpolate(frame, [25, 50], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // Forge card fades + slides in at frame 55
  const forgeOpacity = interpolate(frame, [55, 80], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const forgeY       = interpolate(frame, [55, 80], [30, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // CTA fades in at frame 100
  const ctaOpacity = interpolate(frame, [100, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // hasSynthesis / hasForge reserved for future conditional rendering
  void data.hasSynthesis;
  void data.hasForge;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: BG_DARK,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '0 72px',
    }}>
      {/* Kicker */}
      <div style={{ opacity: kickerOpacity, marginBottom: 40 }}>
        <div style={{ fontSize: 22, color: ACCENT_GOLD, letterSpacing: '6px', textTransform: 'uppercase', fontFamily: ORBITRON, marginBottom: 8 }}>
          ✦ GO DEEPER
        </div>
        <div style={{ fontSize: 30, color: TEXT_DIM }}>
          Unlock premium analysis
        </div>
      </div>

      {/* Synthesis card */}
      <div style={{
        padding: '28px 32px',
        background: `rgba(0,240,255,0.07)`,
        border: `1.5px solid rgba(0,240,255,0.25)`,
        borderRadius: 12,
        marginBottom: 20,
        opacity: synthOpacity,
        transform: `translateY(${synthY}px)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 32 }}>◈</div>
          <div style={{ fontFamily: ORBITRON, fontSize: 32, fontWeight: 700, color: ACCENT_CYAN, letterSpacing: '2px' }}>
            SYNTHESIS
          </div>
        </div>
        <div style={{ fontSize: 26, color: TEXT_MUTED, lineHeight: 1.5 }}>
          AI cross-analysis of what each approach got right — per criterion
        </div>
      </div>

      {/* Forge card */}
      <div style={{
        padding: '28px 32px',
        background: `rgba(255,102,0,0.07)`,
        border: `1.5px solid rgba(255,102,0,0.25)`,
        borderRadius: 12,
        marginBottom: 40,
        opacity: forgeOpacity,
        transform: `translateY(${forgeY}px)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10 }}>
          <div style={{ fontSize: 32 }}>⚡</div>
          <div style={{ fontFamily: ORBITRON, fontSize: 32, fontWeight: 700, color: ACCENT_ORANGE, letterSpacing: '2px' }}>
            FORGE
          </div>
        </div>
        <div style={{ fontSize: 26, color: TEXT_MUTED, lineHeight: 1.5 }}>
          Turn the winner's solution into a full project blueprint
        </div>
      </div>

      {/* CTA */}
      <div style={{ fontSize: 26, color: ACCENT_GOLD, letterSpacing: '3px', opacity: ctaOpacity, fontFamily: ORBITRON }}>
        Available on arena4.ai
      </div>
    </div>
  );
};
