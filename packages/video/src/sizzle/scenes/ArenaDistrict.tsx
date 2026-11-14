import { useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { IsoArenaRenderer } from '@arena/shared';
import { ARENA_EVENTS, ARENA_TEAMS, ARENA_SUMMARY } from '../arena-data';
import { BG_DARK, ORBITRON, MONO, TEXT_PRIMARY, TEXT_DIM } from '../../tokens';
import { useArena3D, fovFor } from '../useArena3D';

/**
 * The arena in 3D, drawn by the SAME scene the live app's 3D view uses, over the
 * same real competition `ArenaCity` used.
 *
 * The truth model is unchanged: a fresh `IsoArenaRenderer` per frame, seeked to
 * that frame's timestamp, supplies the world — one block per delivered file,
 * height from the edit count. Only the picture is different. `Arena3D.drawFrame`
 * is a pure function of (world, frame), so the determinism argument made in
 * ArenaCity carries over: nothing depends on which frames were drawn before.
 *
 * What this gains over the isometric cut: the robots react to the stream. A
 * file write, a tool call and an error each have a pose, derived from how long
 * ago the event happened in the competition's own time. What it still does not
 * show is particles — they have no pure form — so strikes read through pose and
 * floor pulses only.
 *
 * The time mapping and the captions are ArenaCity's, deliberately. Read the
 * caption notes there before changing either: the caption states no file counts
 * because the event stream under-reports one provider.
 */
const EASE_IN = 8;
const START_PROGRESS = 0.12;
const HOLD_AT = 0.75;

export const ArenaDistrict: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPortrait = height > width;

  const worldAt = (f: number): { world: IsoArenaRenderer['world']; totalMs: number } => {
    const r = new IsoArenaRenderer({ teams: ARENA_TEAMS, events: ARENA_EVENTS, timeLimitMs: 300_000, reducedMotion: true, showLegend: false });
    const progress = interpolate(f, [EASE_IN, durationInFrames * HOLD_AT], [START_PROGRESS, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    r.seek(progress * r.totalMs);
    return { world: r.world, totalMs: r.totalMs };
  };

  useArena3D(canvasRef, ARENA_TEAMS, () => worldAt(0).world, (scene) => {
    const { world, totalMs } = worldAt(frame);
    // World-milliseconds that pass in 0.6s of video: how long a reaction holds.
    const msPerVideoSec = (totalMs * (1 - START_PROGRESS)) / ((durationInFrames * HOLD_AT - EASE_IN) / fps);
    const fx = Math.abs(scene.metrics.fighterX[0] ?? 28);
    const fov = (b: number): number => fovFor(b, width, height);
    const far = isPortrait ? 1.2 : 1;
    // In a tall frame, aim above the deck so the arena sits mid-frame, not at the top.
    const up = isPortrait ? 9 : 0;

    // Four shots, hard cuts, every one a pure function of the frame number.
    let cam: { pos: [number, number, number]; look: [number, number, number]; fov: number };
    if (frame < 84) {
      const a = 0.75 + frame * 0.004;
      cam = { pos: [Math.sin(a) * 80 * far, 30 - frame * 0.06, Math.cos(a) * 80 * far], look: [0, 6 + up, 0], fov: fov(40) };
    } else if (frame < 156) {
      const u = frame - 84;
      cam = { pos: [-fx - 22 + u * 0.06, 11, (27 - u * 0.05) * far], look: [-fx + 6, 7.5, -2], fov: fov(36) };
    } else if (frame < 222) {
      const u = frame - 156;
      cam = { pos: [fx + 22 - u * 0.06, 11, (27 - u * 0.05) * far], look: [fx - 6, 7.5, -2], fov: fov(36) };
    } else {
      const u = frame - 222, a = -0.5 + u * 0.002, d = (70 + u * 0.08) * far;
      cam = { pos: [Math.sin(a) * d, 46, Math.cos(a) * d], look: [0, 3 + up, 0], fov: fov(40) };
    }
    scene.drawFrame(world, { t: frame / fps, cam, windowMs: msPerVideoSec * 0.6 });
  }, [frame]);

  const kicker = Math.min(width, height) * (isPortrait ? 0.022 : 0.016);
  const headline = Math.min(width, height) * (isPortrait ? 0.052 : 0.042);
  const fadeIn = interpolate(frame, [6, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shade = 'linear-gradient(180deg, rgba(2,3,10,0.72) 0%, rgba(2,3,10,0) 24%, rgba(2,3,10,0) 74%, rgba(2,3,10,0.8) 100%)';

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK, opacity: exit }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        // MUST be absolutely positioned: AbsoluteFill is a flex container, and a
        // flex-child canvas collapses to zero height and draws off-screen.
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />
      {/* Type sits on a scrim, not on the city: the skyline is too busy to read text over. */}
      <AbsoluteFill style={{ background: shade }} />

      <div style={{ position: 'absolute', top: isPortrait ? '9%' : '6%', left: 0, right: 0, textAlign: 'center', opacity: fadeIn }}>
        <div style={{ fontFamily: ORBITRON, fontSize: kicker, fontWeight: 800, letterSpacing: '0.42em', color: TEXT_DIM, textTransform: 'uppercase' }}>
          the workspace is the arena
        </div>
        <div style={{ fontFamily: ORBITRON, fontSize: headline, fontWeight: 900, letterSpacing: '0.02em', color: TEXT_PRIMARY, marginTop: '0.5em', textShadow: '0 2px 24px rgba(0,0,0,0.9)' }}>
          EVERY BLOCK IS A FILE
        </div>
      </div>

      {/* Same legend, same rule as ArenaCity: it describes where the blocks came
          from and never states per-team counts. */}
      <div style={{
        position: 'absolute', bottom: isPortrait ? '11%' : '6%', left: 0, right: 0, textAlign: 'center',
        fontFamily: MONO, fontSize: kicker, letterSpacing: '0.14em', color: TEXT_DIM,
        opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        <div>blocks = files each agent delivered</div>
        <div style={{ marginTop: '0.7em', color: TEXT_PRIMARY, letterSpacing: '0.2em' }}>
          {ARENA_SUMMARY.every((t) => t.score !== null)
            ? `judge scored them ${ARENA_SUMMARY.map((t) => `${Math.round((t.score as number) * 100)}%`).join('  ·  ')}`
            : 'height = edits'}
        </div>
      </div>
    </AbsoluteFill>
  );
};
