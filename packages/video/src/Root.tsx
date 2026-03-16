import { Composition, delayRender, continueRender, registerRoot } from 'remotion';
import { useState, useEffect } from 'react';
import { loadFont } from '@remotion/google-fonts/Orbitron';
import { CompetitionRecap } from './compositions/CompetitionRecap';
import { mockReelData } from './mock';
import { COMPOSITION_ID } from './index';
import type { ReelData } from './types';

const { waitUntilDone } = loadFont();

// FontLoader: ensures Orbitron is loaded before any frame is captured.
// Uses useState + useEffect to call delayRender exactly once.
const FontLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Loading Orbitron font'));

  useEffect(() => {
    waitUntilDone().then(() => continueRender(handle));
  }, [handle]);

  return <>{children}</>;
};

export const RemotionRoot: React.FC = () => (
  <FontLoader>
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
  </FontLoader>
);

registerRoot(RemotionRoot);
