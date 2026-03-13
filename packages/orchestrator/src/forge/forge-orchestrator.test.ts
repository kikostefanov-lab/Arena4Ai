import { describe, it, expect } from 'vitest';
import type { ForgeArtifactType } from '@arena/shared';
import { selectDomainArtifacts } from './forge-orchestrator.js';

describe('ForgeArtifactType', () => {
  it('includes sql_schema', () => {
    const t: ForgeArtifactType = 'sql_schema';
    expect(t).toBe('sql_schema');
  });

  it('includes environment_template', () => {
    const t: ForgeArtifactType = 'environment_template';
    expect(t).toBe('environment_template');
  });

  it('includes slide_deck', () => {
    const t: ForgeArtifactType = 'slide_deck';
    expect(t).toBe('slide_deck');
  });

  it('includes spreadsheet_export', () => {
    const t: ForgeArtifactType = 'spreadsheet_export';
    expect(t).toBe('spreadsheet_export');
  });
});

describe('selectDomainArtifacts — domainHint and deliverableType signals', () => {
  // These tests verify the domainHint short-circuit path (no AI call — no ANTHROPIC_API_KEY needed).

  it('domainHint "research" returns research artifacts without calling Claude', async () => {
    const brief = {
      id: 'b1', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      deliverableType: 'document' as const,
      domainHint: 'research' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('research');
    expect(result.types).toContain('evaluation_matrix');
  });

  it('domainHint "creative" returns creative artifacts', async () => {
    const brief = {
      id: 'b2', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      domainHint: 'creative' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('creative');
    expect(result.types).toContain('presentation_structure');
  });

  it('domainHint "security" returns security artifacts', async () => {
    const brief = {
      id: 'b3', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      domainHint: 'security' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('security');
    expect(result.types).toContain('threat_model');
  });

  it('domainHint "business" returns business artifacts', async () => {
    const brief = {
      id: 'b4', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      domainHint: 'business' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('business');
    expect(result.types).toContain('business_case');
  });
});
