import { describe, it, expect } from 'vitest';
import {
  slugifyBrief,
  formatDateCompact,
  formatDateTimestamp,
  buildDeliverableFilename,
  buildForgeFilename,
} from './naming.js';
import type { Brief, Team } from '@arena/shared';
import { CompetitionFormat } from '@arena/shared';

const mockBrief = (overrides: Partial<Brief> = {}): Brief => ({
  id: 'fizzbuzz-cli',
  title: 'FizzBuzz CLI',
  problem: 'Build a fizzbuzz program.',
  constraints: [],
  deliverables: ['solution.py'],
  rubric: { criteria: [] },
  format: CompetitionFormat.SPRINT,
  timeLimitMs: 120000,
  ...overrides,
});

// team.model includes the persona slug: 'claude:architect' is a valid Team.model value.
// buildDeliverableFilename converts 'claude:architect' → 'claude-architect' via replace(':', '-').
const mockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-a',
  model: 'claude:architect',
  persona: 'You are an architect.',
  ...overrides,
});

describe('slugifyBrief', () => {
  it('uses brief.id when available', () => {
    expect(slugifyBrief(mockBrief({ id: 'my-brief-id' }))).toBe('my-brief-id');
  });

  it('falls back to slugified title when id is empty', () => {
    expect(slugifyBrief(mockBrief({ id: '' }))).toBe('fizzbuzz-cli');
  });

  it('handles special characters in title', () => {
    expect(slugifyBrief(mockBrief({ id: '', title: 'Deploy SPA (React) v2!' }))).toBe('deploy-spa-react-v2');
  });

  it('truncates to 60 chars', () => {
    const longTitle = 'A'.repeat(80);
    expect(slugifyBrief(mockBrief({ id: '', title: longTitle })).length).toBeLessThanOrEqual(60);
  });

  it('strips leading/trailing hyphens after truncation', () => {
    const result = slugifyBrief(mockBrief({ id: '', title: 'hello world --- end' }));
    expect(result).not.toMatch(/^-|-$/);
  });
});

describe('formatDateCompact', () => {
  it('formats ISO date to YYYYMMDD', () => {
    expect(formatDateCompact('2026-03-12T16:30:00Z')).toBe('20260312');
  });

  it('handles Date objects', () => {
    expect(formatDateCompact(new Date('2026-03-12T16:30:00Z'))).toBe('20260312');
  });
});

describe('formatDateTimestamp', () => {
  it('formats to YYYYMMDD-HHMMSS', () => {
    // Time is UTC-based; just check format shape
    const result = formatDateTimestamp('2026-03-12T16:35:22Z');
    expect(result).toMatch(/^\d{8}-\d{6}$/);
  });
});

describe('buildDeliverableFilename', () => {
  it('builds a well-structured filename', () => {
    const result = buildDeliverableFilename(mockBrief(), mockTeam(), '2026-03-12T16:00:00Z');
    expect(result).toBe('arena4ai_fizzbuzz-cli_claude-architect_20260312_deliverables.zip');
  });

  it('handles team with model-only (no colon)', () => {
    const result = buildDeliverableFilename(
      mockBrief(),
      mockTeam({ model: 'gemini', persona: '' }),
      '2026-03-12T16:00:00Z'
    );
    expect(result).toBe('arena4ai_fizzbuzz-cli_gemini_20260312_deliverables.zip');
  });

  it('falls back to teamId when model is missing', () => {
    const result = buildDeliverableFilename(
      mockBrief(),
      mockTeam({ model: '', id: 'team-a' }),
      '2026-03-12T16:00:00Z'
    );
    expect(result).toContain('team-a');
    expect(result).toContain('deliverables.zip');
  });

  it('uses current date when startedAt is missing', () => {
    const result = buildDeliverableFilename(mockBrief(), mockTeam());
    expect(result).toMatch(/arena4ai_fizzbuzz-cli_claude-architect_\d{8}_deliverables\.zip/);
  });
});

describe('buildForgeFilename', () => {
  it('builds a well-structured forge filename', () => {
    const result = buildForgeFilename(mockBrief(), 'winner', '2026-03-12T16:35:22Z');
    expect(result).toMatch(/arena4ai_fizzbuzz-cli_winner_\d{8}-\d{6}_forge-run\.zip/);
  });

  it('handles synthesis source', () => {
    const result = buildForgeFilename(mockBrief(), 'synthesis', '2026-03-12T16:35:22Z');
    expect(result).toContain('_synthesis_');
  });

  it('falls back gracefully when generatedAt is missing', () => {
    const result = buildForgeFilename(mockBrief(), 'winner');
    expect(result).toMatch(/arena4ai_fizzbuzz-cli_winner_.+_forge-run\.zip/);
  });
});
