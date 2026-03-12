import { Sequence, Audio, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { IntroBumper }  from '../scenes/IntroBumper';
import { Matchup }      from '../scenes/Matchup';
import { TheBrief }     from '../scenes/TheBrief';
import { KeyMoments }   from '../scenes/KeyMoments';
import { ScoreReveal }  from '../scenes/ScoreReveal';
import { Winner }       from '../scenes/Winner';
import { GoDeeper }     from '../scenes/GoDeeper';
import { Outro }        from '../scenes/Outro';

// Scene timing table (from spec)
// IntroBumper:  from=0,    duration=90
// Matchup:      from=90,   duration=120
// TheBrief:     from=210,  duration=120
// KeyMoments:   from=330,  duration=240
// ScoreReveal:  from=570,  duration=330
// Winner:       from=900,  duration=90
// GoDeeper:     from=990,  duration=180
// Outro:        from=1170, duration=90
// Total: 1260 frames @ 30fps = 42s

const TOTAL_FRAMES = 1260;
const FADE_IN_FRAMES = 45;   // 1.5s fade in
const FADE_OUT_START = 1200; // begin fade out 2s before end

const ThemeAudio: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const volume = interpolate(
    frame,
    [0, FADE_IN_FRAMES, FADE_OUT_START, durationInFrames],
    [0, 0.75, 0.75, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <Audio
      src={staticFile('arena4ai-theme.mp3')}
      volume={volume}
      // Loop if track is shorter than the reel
      loop
    />
  );
};

export const CompetitionRecap: React.FC<ReelData> = (data) => (
  <div style={{ width: '100%', height: '100%', overflow: 'hidden', fontFamily: '"Orbitron", sans-serif' }}>
    <ThemeAudio />
    <Sequence from={0}    durationInFrames={90}>  <IntroBumper /> </Sequence>
    <Sequence from={90}   durationInFrames={120}> <Matchup    data={data} /> </Sequence>
    <Sequence from={210}  durationInFrames={120}> <TheBrief   data={data} /> </Sequence>
    <Sequence from={330}  durationInFrames={240}> <KeyMoments data={data} /> </Sequence>
    <Sequence from={570}  durationInFrames={330}> <ScoreReveal data={data} /> </Sequence>
    <Sequence from={900}  durationInFrames={90}>  <Winner     data={data} /> </Sequence>
    <Sequence from={990}  durationInFrames={180}> <GoDeeper   data={data} /> </Sequence>
    <Sequence from={1170} durationInFrames={90}>  <Outro /> </Sequence>
  </div>
);
