import { Composition, delayRender, continueRender, registerRoot } from 'remotion';
import { useState, useEffect } from 'react';
import { loadFont } from '@remotion/google-fonts/Orbitron';
import { CompetitionRecap } from './compositions/CompetitionRecap';
import { mockReelData } from './mock';
import { COMPOSITION_ID } from './index';
import { Sizzle, SIZZLE_TOTAL_FRAMES } from './sizzle/Sizzle';

const { waitUntilDone } = loadFont();

// FontLoader: ensures Orbitron is loaded before any frame is captured.
const FontLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading Orbitron font'));

  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);

  return <>{children}</>;
};

export const RemotionRoot: React.FC = () => (
  <FontLoader>
    {/* Per-competition recap reel */}
    <Composition
      id={COMPOSITION_ID}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      component={CompetitionRecap as any}
      durationInFrames={1950}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={mockReelData}
    />

    {/* Sizzle — landscape (YouTube, site hero) */}
    <Composition
      id="SizzleLandscape"
      component={Sizzle}
      durationInFrames={SIZZLE_TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />

    {/* Sizzle — portrait (Twitter, IG Reels, TikTok) */}
    <Composition
      id="SizzlePortrait"
      component={Sizzle}
      durationInFrames={SIZZLE_TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1920}
    />

    {/* Sizzle — square (IG feed) */}
    <Composition
      id="SizzleSquare"
      component={Sizzle}
      durationInFrames={SIZZLE_TOTAL_FRAMES}
      fps={30}
      width={1080}
      height={1080}
    />
  </FontLoader>
);

registerRoot(RemotionRoot);
