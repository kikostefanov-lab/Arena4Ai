import { Sequence } from 'remotion';
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
// Total: 1260 frames

export const CompetitionRecap: React.FC<ReelData> = (data) => (
  <div style={{ width: '100%', height: '100%', overflow: 'hidden', fontFamily: '"Orbitron", sans-serif' }}>
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
