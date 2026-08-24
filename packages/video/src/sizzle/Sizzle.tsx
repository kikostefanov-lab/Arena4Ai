// packages/video/src/sizzle/Sizzle.tsx
//
// Arena4Ai sizzle — 63s promo video.
// One composition, three aspect ratios (1920×1080, 1080×1920, 1080×1080)
// via useVideoConfig(). Each scene decides its own layout from width/height.

import { Series, Audio, AbsoluteFill, useVideoConfig, staticFile } from 'remotion';
import { BG_DARK } from '../tokens';
import { IntroBumper } from './scenes/IntroBumper';
import { TheQuestion } from './scenes/TheQuestion';
import { GladiatorReveal } from './scenes/GladiatorReveal';
import { TheBrief } from './scenes/TheBrief';
import { ArenaCity } from './scenes/ArenaCity';
import { TheVerdict } from './scenes/TheVerdict';
import { TheRecord } from './scenes/TheRecord';
import { TheForge } from './scenes/TheForge';
import { ThreePillars } from './scenes/ThreePillars';
import { SizzleOutro } from './scenes/SizzleOutro';

// Scene durations @ 30fps (total 1890 frames = 63s)
const SCENES = [
  { C: IntroBumper,      frames: 90  }, //   0–90   (0–3s)    intro bumper
  { C: TheQuestion,      frames: 120 }, //  90–210  (3–7s)    which model wins?
  { C: GladiatorReveal,  frames: 210 }, // 240–450  (8–15s)   three gladiators in the ring
  { C: TheBrief,         frames: 210 }, // 450–660  (15–22s)  real brief, real criteria
  // AA-067: was BattleHighlights, a hand-rolled flat gladiator ring with no
  // information in it. This runs the SAME isometric renderer the live app uses,
  // over a real competition's real events — the site's claim and the reel's
  // footage are now the same code.
  { C: ArenaCity,        frames: 300 }, // 660–960  (22–32s)  the cities build
  { C: TheVerdict,       frames: 300 }, // 960–1260 (32–42s)  cross-judge + winner
  { C: TheForge,         frames: 240 }, //          artifacts fly past
  // The three-provider claim, evidenced across every competition rather than by
  // one three-way match — which is also what let the reel move to a two-team
  // competition without losing it.
  { C: TheRecord,        frames: 150 }, //          26 competitions, all providers
  { C: ThreePillars,     frames: 120 }, //          REAL / LIVE / FORGED
  { C: SizzleOutro,      frames: 150 }, //1740–1890 (58–63s)  logo + tagline + URL
];

export const SIZZLE_TOTAL_FRAMES = SCENES.reduce((s, x) => s + x.frames, 0);

export const Sizzle: React.FC = () => {
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK }}>
      {/* Theme audio with 1s fade-in + 2s fade-out */}
      <Audio
        src={staticFile('arena4ai-theme.mp3')}
        volume={(frame) => {
          const fadeIn = Math.min(1, frame / 30);
          const fadeOut = Math.min(1, (durationInFrames - frame) / 60);
          return 0.65 * Math.min(fadeIn, fadeOut);
        }}
      />

      <Series>
        {SCENES.map(({ C, frames }, i) => (
          <Series.Sequence key={i} durationInFrames={frames}>
            <C />
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
};
