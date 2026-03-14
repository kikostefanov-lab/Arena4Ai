import { describe, it, expect } from 'vitest';
import { scoreBriefQuality, type QualityReport } from './quality-scorer.js';

/** Minimal valid brief for testing — all checks pass. */
function validBrief() {
  return {
    id: 'test-brief',
    title: 'Test Brief Title',
    problem: 'A'.repeat(210), // >200 chars
    constraints: ['Must complete in O(n) time', 'No external API calls'],
    deliverables: ['solution.ts', 'README.md'],
    rubric: {
      criteria: [
        { id: 'edge-cases', description: 'Handles boundary inputs and malformed data gracefully', maxScore: 10, weight: 0.5 },
        { id: 'architecture', description: 'Clean module boundaries and minimal coupling', maxScore: 10, weight: 0.5 },
      ],
    },
    format: 'SPRINT' as const,
    timeLimitMs: 300_000,
    deliverableType: 'code' as const,
  };
}

describe('scoreBriefQuality', () => {
  it('returns perfect score for a valid brief', () => {
    const report = scoreBriefQuality(validBrief());
    expect(report.overallScore).toBe(1.0);
    expect(report.launchReady).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  // Check 1: criterion descriptions > 15 chars
  it('flags short criterion descriptions as errors', () => {
    const brief = validBrief();
    brief.rubric.criteria[0].description = '>'; // placeholder
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'error' && i.check === 'criterion-descriptions')).toBe(true);
    expect(report.overallScore).toBeLessThan(1.0);
  });

  it('flags 15-char criterion description as error', () => {
    const brief = validBrief();
    brief.rubric.criteria[0].description = 'Exactly fifteen'; // exactly 15 chars
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.check === 'criterion-descriptions')).toBe(true);
  });

  // Check 2: constraints array non-empty
  it('warns when constraints array is empty', () => {
    const brief = validBrief();
    brief.constraints = [];
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'warning' && i.check === 'constraints-present')).toBe(true);
    expect(report.overallScore).toBe(0.9);
  });

  // Check 3: deliverable filenames match deliverableType
  it('warns when code deliverableType has no code files', () => {
    const brief = validBrief();
    brief.deliverables = ['report.md', 'notes.txt'];
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'warning' && i.check === 'deliverable-type-match')).toBe(true);
  });

  it('does not warn when code deliverableType has code files', () => {
    const brief = validBrief();
    brief.deliverables = ['solution.py'];
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.check === 'deliverable-type-match')).toBe(false);
  });

  // Check 4: problem statement > 200 chars
  it('warns when problem statement is too short', () => {
    const brief = validBrief();
    brief.problem = 'Short problem.';
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'warning' && i.check === 'problem-length')).toBe(true);
  });

  // Check 5: weights sum to ~1.0
  it('flags weights not summing to 1.0 as error', () => {
    const brief = validBrief();
    brief.rubric.criteria[0].weight = 0.3;
    brief.rubric.criteria[1].weight = 0.3;
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'error' && i.check === 'weights-sum')).toBe(true);
  });

  it('accepts weights summing to 0.99', () => {
    const brief = validBrief();
    brief.rubric.criteria[0].weight = 0.49;
    brief.rubric.criteria[1].weight = 0.50;
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.check === 'weights-sum')).toBe(false);
  });

  // Check 6: no duplicate criterion IDs
  it('flags duplicate criterion IDs as error', () => {
    const brief = validBrief();
    brief.rubric.criteria[1].id = brief.rubric.criteria[0].id;
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'error' && i.check === 'duplicate-criteria')).toBe(true);
  });

  // Check 7: deliverableType not inappropriately 'code'
  it('warns when domain is business but deliverableType is code', () => {
    const brief = { ...validBrief(), domainHint: 'business' as const, deliverableType: 'code' as const };
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.severity === 'warning' && i.check === 'deliverable-type-domain')).toBe(true);
  });

  it('does not warn when domain is software and deliverableType is code', () => {
    const brief = { ...validBrief(), domainHint: 'software' as const, deliverableType: 'code' as const };
    const report = scoreBriefQuality(brief);
    expect(report.issues.some((i) => i.check === 'deliverable-type-domain')).toBe(false);
  });

  // Scoring math
  it('deducts 0.2 per error and 0.1 per warning', () => {
    const brief = validBrief();
    brief.rubric.criteria[0].description = '>'; // error: -0.2
    brief.constraints = [];                       // warning: -0.1
    brief.problem = 'Short.';                     // warning: -0.1
    const report = scoreBriefQuality(brief);
    expect(report.overallScore).toBeCloseTo(0.6, 2);
    expect(report.launchReady).toBe(false);
  });

  it('clamps score at 0', () => {
    const brief = validBrief();
    // Create enough issues to go below 0
    brief.rubric.criteria[0].description = '>';
    brief.rubric.criteria[1].description = '>';
    brief.rubric.criteria[1].id = brief.rubric.criteria[0].id; // duplicate
    brief.rubric.criteria[0].weight = 0.1;
    brief.rubric.criteria[1].weight = 0.1; // bad sum
    brief.constraints = [];
    brief.problem = 'Short.';
    const report = scoreBriefQuality(brief);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.launchReady).toBe(false);
  });

  // Suggestions
  it('includes suggestions', () => {
    const brief = validBrief();
    brief.constraints = [];
    const report = scoreBriefQuality(brief);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });
});
