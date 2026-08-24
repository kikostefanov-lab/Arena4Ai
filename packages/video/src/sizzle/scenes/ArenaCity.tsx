import { useLayoutEffect, useRef } from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { IsoArenaRenderer } from '@arena/shared';
import type { Ctx2D } from '@arena/shared';
import { ARENA_EVENTS, ARENA_TEAMS, ARENA_SUMMARY } from '../arena-data';
import { BG_DARK, ORBITRON, MONO, TEXT_PRIMARY, TEXT_DIM } from '../../tokens';

/**
 * The arena, drawn by the SAME renderer the live app uses.
 *
 * Until now the reel showed a hand-rolled flat gladiator ring — a picture of
 * something happening, with no information in it. This scene runs
 * `IsoArenaRenderer` from @arena/shared over a real competition's real events:
 * every block is a file, its height is the edit count, and the cities grow as
 * the competition actually unfolded. What the site claims the arena is, and what
 * the reel shows, are now the same code.
 *
 * DETERMINISM — the thing Remotion requires and a stateful renderer does not
 * naturally give you. Remotion renders frames offline, out of order and in
 * parallel, so frame N must produce identical pixels every time it is asked for.
 * Three things had to be true, and each was checked rather than assumed:
 *
 *  1. A fresh renderer per frame, seeked to that frame's timestamp. `seek()`
 *     rebuilds the world from scratch and snaps block heights to their targets,
 *     so nothing depends on how many frames came before.
 *  2. `reducedMotion: true`, which removes the camera-shake path — the only
 *     `Math.random()` in the renderer.
 *  3. The camera set explicitly from the frame number. `draw()` normally EASES
 *     the camera toward a target, which accumulates across calls; deriving yaw
 *     from `frame` makes the orbit a pure function of time instead.
 *
 * Verified by recording every canvas call for a frame and rendering it twice:
 * identical op-for-op at frames 0/37/90/150/240, and different between frames
 * (11,351 draw ops at the start, 16,465 once the cities are up).
 *
 * KNOWN LIMIT, stated because it is visible: transient effects — the tool-call
 * beams, the write streaks — do not survive a `seek`, so this shows the CITIES
 * BUILDING rather than the strikes landing. Making them frame-derivable is a
 * bigger change to the renderer than a reel justifies today.
 */

/** Frames of settle before the floor starts filling. */
const EASE_IN = 8;
/**
 * The scene starts here rather than at zero, so it opens on a floor that already
 * has something on it. An arena with nothing in it says nothing.
 */
const START_PROGRESS = 0.12;

export const ArenaCity: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames, fps } = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPortrait = height > width;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const renderer = new IsoArenaRenderer({
      teams: ARENA_TEAMS,
      events: ARENA_EVENTS,
      timeLimitMs: 300_000,
      reducedMotion: true,
      // The legend belongs on the product, where a reader can act on it. Here it
      // would be four points of unreadable type; the reel says the same thing in
      // its own overlay instead.
      showLegend: false,
    });

    /**
     * Time mapping, arrived at by rendering the scene and looking at it.
     *
     * A linear map onto the whole competition span put the scene in a fight with
     * its own content: it OPENED on a bare floor with nothing to read, spent
     * seven of its ten seconds watching one team build against an empty opposite
     * side, and only reached the state the caption describes — both cities up,
     * 17 against 4 — in the final frames, which are the frames being faded out.
     * The one moment that earned the line was the moment it was thrown away.
     *
     * So: start with a few blocks already down (no dead opening), reach the full
     * result at three-quarters, and HOLD it. The last beat is the payoff sitting
     * still, which is also what a viewer needs in order to read a caption.
     */
    const progress = interpolate(
      frame,
      [EASE_IN, durationInFrames * 0.75],
      [START_PROGRESS, 1],
      { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
    );

    renderer.attach(ctx as unknown as Ctx2D);
    renderer.setViewport({
      width,
      height,
      dpr: 1,
      // Tight insets: the renderer fits the WHOLE grid into the safe box, and a
      // competition that used a fraction of its floor leaves the rest empty. On
      // a page that is fine — there is other chrome. In a full-frame shot it
      // reads as a small diagram in a large void, so the box is opened up and
      // the camera pushed in below.
      insets: isPortrait
        ? { top: height * 0.13, right: 12, bottom: height * 0.14, left: 12 }
        : { top: height * 0.11, right: 20, bottom: height * 0.12, left: 20 },
    });
    renderer.seek(progress * renderer.totalMs);

    // Pure functions of the frame — no easing, no accumulation.
    const yaw = -0.62 + Math.sin(frame / 110) * 0.16;
    // A slow push-in over the scene. Remotion needs this derived from the frame
    // rather than eased, or the same frame would render differently depending on
    // what was rendered before it.
    const zoom = interpolate(frame, [0, durationInFrames], [1.28, 1.46], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
    const cam = renderer.camera;
    cam.yaw = yaw;
    cam.tyaw = yaw;
    cam.zoom = zoom;
    cam.tzoom = zoom;
    cam.x = 0;
    cam.y = 0;
    cam.tx = 0;
    cam.ty = 0;

    renderer.draw();
  }, [frame, width, height, durationInFrames, fps, isPortrait]);

  const kicker = Math.min(width, height) * (isPortrait ? 0.022 : 0.016);
  const headline = Math.min(width, height) * (isPortrait ? 0.052 : 0.042);
  const fadeIn = interpolate(frame, [6, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Short exit. The previous 18-frame fade began while the cities were still
  // resolving, so the payoff was dimming as it arrived.
  const exit = interpolate(frame, [durationInFrames - 8, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

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

      <div style={{
        position: 'absolute',
        top: isPortrait ? '9%' : '7%',
        left: 0,
        right: 0,
        textAlign: 'center',
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
          the workspace is the arena
        </div>
        <div style={{
          fontFamily: ORBITRON,
          fontSize: headline,
          fontWeight: 900,
          letterSpacing: '0.02em',
          color: TEXT_PRIMARY,
          marginTop: '0.5em',
        }}>
          EVERY BLOCK IS A FILE
        </div>
      </div>

      {/*
        THE CAPTION DELIBERATELY STATES NO FILE COUNTS. Read this before adding any.

        An earlier cut said "claude 17 files vs codex 4 files". That was FALSE:
        both teams shipped 17 files (results.deliverables is 17 and 17). The "4"
        was the number of FILE_CREATE events codex's stream produced, not the
        number of files it wrote — codex applies edits via apply_patch and the
        codex normalizer only turns the first path of a patch block into an event,
        so 13 of 17 never became events at all. The paths are all still in the
        stream as `+++ b/<path>` diff headers; recovering them yields exactly the
        17 stored deliverables.

        Counting events and calling the result "files" is precisely the misreading
        the renderer's three-state design exists to prevent — a logging gap must
        never render as less work. A caption is worse than the floor for this,
        because text cannot be hatched or caveated.

        So: no counts here until the floor itself is sourced from something
        complete. Scores are safe — they come from the judge, not the stream.
      */}
      <div style={{
        position: 'absolute',
        bottom: isPortrait ? '11%' : '7%',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontFamily: MONO,
        fontSize: kicker,
        letterSpacing: '0.14em',
        color: TEXT_DIM,
        opacity: interpolate(frame, [30, 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}>
        {/* A LEGEND, NOT A COMPARISON — and it must describe WHERE THE BLOCKS
            CAME FROM. It said "files each CLI reported writing" while the floor
            was built from the event stream. It is now built from the DELIVERABLES
            MANIFEST (see generate-arena-data.ts), because the stream under-reports
            codex by 13 of 17 — so "reported" became false the moment the floor
            became true. "delivered" is accurate for both teams: the manifest is
            what was collected off disk.
            Whenever the floor's data source changes, THIS LINE CHANGES WITH IT.
            Never replace it with per-team counts. */}
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
