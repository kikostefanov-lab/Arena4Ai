import { CompetitionFormat, type BriefInput } from '@arena/shared';

/** Fields that a caller must supply on top of the preset defaults. */
type PartialBrief = Partial<BriefInput> & Record<string, unknown>;

/** Preset defaults keyed by CompetitionFormat. */
export const PRESETS: Record<CompetitionFormat, BriefInput> = {
  [CompetitionFormat.SPRINT]: {
    id: 'sprint-default',
    title: 'Sprint Challenge',
    problem: 'Solve the problem as efficiently as possible.',
    constraints: ['Stay within the time limit.'],
    deliverables: ['solution.md'],
    timeLimitMs: 15 * 60 * 1000, // 15 minutes
    format: CompetitionFormat.SPRINT,
    rubric: {
      criteria: [
        { id: 'correctness', description: 'Solution is correct', weight: 0.5, maxScore: 10 },
        { id: 'quality', description: 'Code / writing quality', weight: 0.3, maxScore: 10 },
        { id: 'speed', description: 'Delivered promptly', weight: 0.2, maxScore: 10 },
      ],
    },
  },

  [CompetitionFormat.HACKATHON]: {
    id: 'hackathon-default',
    title: 'Hackathon Challenge',
    problem: 'Build something impressive within the hackathon window.',
    constraints: ['Use only approved libraries.'],
    deliverables: ['README.md', 'source code'],
    timeLimitMs: 2 * 60 * 60 * 1000, // 2 hours
    format: CompetitionFormat.HACKATHON,
    rubric: {
      criteria: [
        { id: 'innovation', description: 'Creative and novel approach', weight: 0.35, maxScore: 10 },
        { id: 'completeness', description: 'Deliverables are complete', weight: 0.35, maxScore: 10 },
        { id: 'presentation', description: 'README and docs are clear', weight: 0.3, maxScore: 10 },
      ],
    },
  },

  [CompetitionFormat.RELAY_RACE]: {
    id: 'relay-default',
    title: 'Relay Race Challenge',
    problem: 'Each agent builds on the previous agent\'s work.',
    constraints: ['Do not redo prior work.'],
    deliverables: ['incremental solution'],
    timeLimitMs: 30 * 60 * 1000, // 30 minutes
    format: CompetitionFormat.RELAY_RACE,
    rubric: {
      criteria: [
        { id: 'continuity', description: 'Builds coherently on prior work', weight: 0.4, maxScore: 10 },
        { id: 'correctness', description: 'Incremental output is correct', weight: 0.4, maxScore: 10 },
        { id: 'clarity', description: 'Handoff notes are clear', weight: 0.2, maxScore: 10 },
      ],
    },
  },

  [CompetitionFormat.RED_VS_BLUE]: {
    id: 'red-vs-blue-default',
    title: 'Red vs Blue Challenge',
    problem: 'Attack or defend a system as assigned.',
    constraints: ['Stay within scope.'],
    deliverables: ['attack/defense report'],
    timeLimitMs: 60 * 60 * 1000, // 1 hour
    format: CompetitionFormat.RED_VS_BLUE,
    rubric: {
      criteria: [
        { id: 'effectiveness', description: 'Attack or defense is effective', weight: 0.5, maxScore: 10 },
        { id: 'documentation', description: 'Report documents findings clearly', weight: 0.3, maxScore: 10 },
        { id: 'scope', description: 'Stays within defined scope', weight: 0.2, maxScore: 10 },
      ],
    },
  },
};

/**
 * Merge user-supplied partial brief fields on top of the preset for the
 * given format. User fields always win (shallow merge).
 *
 * @throws Error if the format is not recognised.
 */
export function applyPreset(format: CompetitionFormat, overrides: PartialBrief): BriefInput {
  const preset = PRESETS[format];
  if (!preset) {
    throw new Error(`Unknown format: "${format}". Valid formats: ${Object.keys(PRESETS).join(', ')}`);
  }
  return { ...preset, ...overrides, format } as BriefInput;
}
