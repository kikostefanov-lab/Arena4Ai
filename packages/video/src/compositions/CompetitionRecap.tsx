import { Sequence, Audio, staticFile, useCurrentFrame, interpolate } from 'remotion';
import type { ReelData } from '../types';
import { IntroBumper }       from '../scenes/IntroBumper';
import { Matchup }           from '../scenes/Matchup';
import { BattleHighlights }  from '../scenes/BattleHighlights';
import { TheBrief }          from '../scenes/TheBrief';
import { KeyMoments }        from '../scenes/KeyMoments';
import { ScoreReveal }       from '../scenes/ScoreReveal';
import { Winner }            from '../scenes/Winner';
import { GoDeeper }          from '../scenes/GoDeeper';
import { Outro }             from '../scenes/Outro';

// Scene timing — 65s total @ 30fps = 1950 frames
const INTRO_START = 0;
const INTRO_DURATION = 120;     // 4s

const MATCHUP_START = 120;
const MATCHUP_DURATION = 180;   // 6s

const BATTLE_START = 300;
const BATTLE_DURATION = 180;    // 6s (NEW)

const BRIEF_START = 480;
const BRIEF_DURATION = 180;     // 6s

const MOMENTS_START = 660;
const MOMENTS_DURATION = 300;   // 10s

const SCORE_START = 960;
const SCORE_DURATION = 420;     // 14s

const WINNER_START = 1380;
const WINNER_DURATION = 120;    // 4s

const DEEPER_START = 1500;
const DEEPER_DURATION = 270;    // 9s

const OUTRO_START = 1770;
const OUTRO_DURATION = 180;     // 6s

const TOTAL_FRAMES = 1950;

const FADE_IN_FRAMES = 45;   // 1.5s fade in

const ThemeAudio: React.FC = () => {
  const frame = useCurrentFrame();
  const fadeOutStart = TOTAL_FRAMES - 60; // 1890

  const volume = interpolate(
    frame,
    [0, FADE_IN_FRAMES, fadeOutStart, TOTAL_FRAMES],
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
    <Sequence from={INTRO_START}   durationInFrames={INTRO_DURATION}   name="IntroBumper">      <IntroBumper /> </Sequence>
    <Sequence from={MATCHUP_START} durationInFrames={MATCHUP_DURATION} name="Matchup">           <Matchup data={data} /> </Sequence>
    <Sequence from={BATTLE_START}  durationInFrames={BATTLE_DURATION}  name="BattleHighlights">  <BattleHighlights data={{ teams: data.teams, keyEvents: data.keyEvents }} /> </Sequence>
    <Sequence from={BRIEF_START}   durationInFrames={BRIEF_DURATION}   name="TheBrief">          <TheBrief data={data} /> </Sequence>
    <Sequence from={MOMENTS_START} durationInFrames={MOMENTS_DURATION} name="KeyMoments">        <KeyMoments data={data} /> </Sequence>
    <Sequence from={SCORE_START}   durationInFrames={SCORE_DURATION}   name="ScoreReveal">       <ScoreReveal data={data} /> </Sequence>
    <Sequence from={WINNER_START}  durationInFrames={WINNER_DURATION}  name="Winner">            <Winner data={data} /> </Sequence>
    <Sequence from={DEEPER_START}  durationInFrames={DEEPER_DURATION}  name="GoDeeper">          <GoDeeper data={data} /> </Sequence>
    <Sequence from={OUTRO_START}   durationInFrames={OUTRO_DURATION}   name="Outro">             <Outro /> </Sequence>
  </div>
);
