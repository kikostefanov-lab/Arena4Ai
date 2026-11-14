import { useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { createWorld } from '@arena/shared';
import type { TeamSpec } from '@arena/shared';
import type { PoseName } from '../../arena3d/scene';
import { ACCENT_CYAN, BG_DARK, ORBITRON, TEXT_PRIMARY } from '../../tokens';
import { useArena3D, fovFor } from '../useArena3D';

/**
 * The three robots land on the deck — the 3D replacement for GladiatorReveal.
 *
 * This scene is STAGED, not data: there are no events and no blocks, just the
 * three provider models on an empty deck. It makes the three-provider claim the
 * same way the 2D scene did, with the models the live 3D arena uses.
 */
const TEAMS: TeamSpec[] = [
  { id: 'claude', model: 'claude' },
  { id: 'codex', model: 'codex' },
  { id: 'gemini', model: 'gemini' },
];
const YAW = [0.32, 0, -0.32];
const LAND = [12, 34, 56];
const DROP = 24;

const ease = (x: number): number => { const t = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - t, 3); };

export const RobotReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, fps, durationInFrames } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPortrait = height > width;

  const world = (): ReturnType<typeof createWorld> => createWorld(TEAMS, []);

  useArena3D(canvasRef, TEAMS, world, (scene) => {
    const overrides: Record<string, { pose: PoseName | { from: PoseName; to: PoseName; mix: number }; lift: number; yaw: number }> = {};
    TEAMS.forEach((t, i) => {
      const since = frame - LAND[i];
      // Falls in, lands in a crouch, rises with arms up, settles.
      const lift = (1 - ease((since + DROP) / DROP)) * 70;
      const pose = since < 0 ? 'kneel'
        : since < 22 ? { from: 'kneel' as const, to: 'power' as const, mix: ease(since / 22) }
        : { from: 'power' as const, to: 'idle' as const, mix: ease((since - 30) / 26) };
      overrides[t.id] = { pose, lift, yaw: YAW[i] };
    });
    // A taller frame sees past the front edge of the deck from a low camera, so
    // the camera climbs and tilts down to keep the deck under the robots.
    const square = width === height;
    const back = isPortrait ? 74 : square ? 60 : 52;
    const camY = isPortrait ? 30 : square ? 17 : 9.5;
    const lookY = isPortrait ? 3 : square ? 7 : 9.8;
    scene.drawFrame(world(), {
      t: frame / fps,
      cam: { pos: [-11 + frame * 0.1, camY, back - frame * 0.03], look: [0, lookY, 0], fov: fovFor(42, width, height) },
      windowMs: 1,
      overrides,
      banner: { text: 'CLAUDE  ·  CODEX  ·  GEMINI', color: '#00f0ff' },
    });
  }, [frame]);

  const headerOpacity = interpolate(frame, [80, 104], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [durationInFrames - 20, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const headerSize = Math.min(width, height) * (isPortrait ? 0.042 : 0.03);
  const lineSize = Math.min(width, height) * (isPortrait ? 0.07 : 0.055);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <canvas ref={canvasRef} width={width} height={height} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(2,3,10,0.78) 0%, rgba(2,3,10,0) 34%)' }} />
      <AbsoluteFill style={{
        flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
        paddingTop: isPortrait ? '8%' : '5%', paddingLeft: '6%', paddingRight: '6%', textAlign: 'center', opacity: headerOpacity, pointerEvents: 'none',
      }}>
        <div style={{ fontFamily: ORBITRON, fontSize: headerSize, fontWeight: 800, letterSpacing: '0.4em', color: ACCENT_CYAN, textTransform: 'uppercase', textShadow: `0 0 16px ${ACCENT_CYAN}` }}>
          ◆ Enter the Arena
        </div>
        <div style={{ fontFamily: ORBITRON, fontSize: lineSize, fontWeight: 900, letterSpacing: '0.15em', color: TEXT_PRIMARY, marginTop: '0.8em', textShadow: '0 2px 30px rgba(0,0,0,0.9)' }}>
          Three agents. One brief.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
