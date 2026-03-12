import type { ReelData } from './types';

export const mockReelData: ReelData = {
  competitionId: 'mock-001',
  briefTitle: 'FizzBuzz CLI Challenge',
  briefDescription: 'Build a CLI tool that outputs FizzBuzz for numbers 1–100.',
  criteria: ['Correctness', 'Code Quality', 'Performance'],
  teams: [
    {
      teamId: 'team-a',
      label: 'claude:architect',
      model: 'claude',
      persona: 'architect',
      color: '#ff6600',
      score: 0.917,
      criteriaScores: [
        { name: 'Correctness',   score: 0.95, commentary: 'All 100 numbers correct with proper Fizz, Buzz, FizzBuzz logic.' },
        { name: 'Code Quality',  score: 0.88, commentary: 'Clean, readable Python with good variable names and comments.' },
        { name: 'Performance',   score: 0.92, commentary: 'Efficient single-pass implementation, no unnecessary iterations.' },
      ],
    },
    {
      teamId: 'team-b',
      label: 'codex:speedrunner',
      model: 'codex',
      persona: 'speedrunner',
      color: '#0066ff',
      score: 0.832,
      criteriaScores: [
        { name: 'Correctness',   score: 0.80, commentary: 'Output correct but edge case at 15 was handled suboptimally.' },
        { name: 'Code Quality',  score: 0.85, commentary: 'Compact JavaScript, could use more descriptive naming.' },
        { name: 'Performance',   score: 0.85, commentary: 'Functional but used a dictionary lookup instead of modulo.' },
      ],
    },
  ],
  winnerId: 'team-a',
  keyMoments: [
    { relativeMs: 42000,  teamId: 'team-a', label: 'Created fizzbuzz.py',      type: 'FILE_CREATE' },
    { relativeMs: 65000,  teamId: 'team-b', label: 'Created solution.js',      type: 'FILE_CREATE' },
    { relativeMs: 91000,  teamId: 'team-a', label: 'Created test_fizzbuzz.py', type: 'FILE_CREATE' },
  ],
  synthesisQuote: 'Claude demonstrated a more thorough approach by including unit tests alongside the implementation.',
  hasSynthesis: true,
  hasForge: true,
};
