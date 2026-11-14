import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { delayRender, continueRender, cancelRender, staticFile, useVideoConfig } from 'remotion';
import type { TeamSpec, World } from '@arena/shared';
import { Arena3D } from '../arena3d/scene';
import { getModelColor } from '../tokens';

/**
 * Mount the 3D arena on a canvas and hold the render until it can draw.
 *
 * The scene is created once per mount and reused for every frame, which is safe
 * only because `drawFrame()` is a pure function of its arguments — the WebGL
 * context carries no state from one frame into the next.
 *
 * `draw` is called for the current frame as soon as the robots have loaded and
 * again whenever its dependencies change. The render is released AFTER the first
 * draw, not when loading finishes, so a frame can never be captured between
 * "ready" and "painted".
 */
export function useArena3D(
  canvasRef: RefObject<HTMLCanvasElement>,
  teams: TeamSpec[],
  layoutWorld: () => World,
  draw: (scene: Arena3D) => void,
  deps: unknown[],
): void {
  const { width, height } = useVideoConfig();
  const [scene, setScene] = useState<Arena3D | null>(null);
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = delayRender('Loading the 3D arena');
    handleRef.current = handle;
    let dead = false;
    let s: Arena3D | null = null;
    try {
      s = new Arena3D(canvas, {
        teams: teams.map((t) => ({ id: t.id, model: t.model, color: getModelColor(t.model) })),
        modelUrl: staticFile('models/gladiators.glb'),
        preserveDrawingBuffer: true,
        reducedMotion: true,
      });
      s.resize(width, height, 1);
      const made = s;
      made.load(layoutWorld()).then(() => { if (!dead) setScene(made); }).catch((err) => cancelRender(err));
    } catch (err) {
      cancelRender(err);
    }
    return () => { dead = true; s?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  useLayoutEffect(() => {
    if (!scene) return;
    draw(scene);
    if (handleRef.current !== null) { continueRender(handleRef.current); handleRef.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, ...deps]);
}

/** Vertical field of view that keeps a landscape-composed shot readable in a taller frame. */
export function fovFor(base: number, width: number, height: number): number {
  const aspect = width / height;
  return Math.min(78, aspect >= 1.5 ? base : aspect >= 1 ? base * 1.4 : base * 1.75);
}
