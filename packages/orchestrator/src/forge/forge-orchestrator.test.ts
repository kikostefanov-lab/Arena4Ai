import { describe, it, expect } from 'vitest';
import type { ForgeArtifactType, ForgeOutputFormat } from '@arena/shared';
import { selectDomainArtifacts, buildPrompt, ARTIFACT_CATALOG, DOMAIN_TYPE_DEFAULTS, formatDeliverableFiles, generateStarterKit } from './forge-orchestrator.js';

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
    expect(result.types).toContain('messaging_guide');
  });

  it('domainHint "security" returns security artifacts', async () => {
    const brief = {
      id: 'b3', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      domainHint: 'security' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('security');
    expect(result.types).toContain('risk_register');
  });

  it('domainHint "business" returns business artifacts', async () => {
    const brief = {
      id: 'b4', title: 'T', problem: 'P', constraints: [], deliverables: ['out.md'],
      rubric: { criteria: [] }, format: 'SPRINT' as any, timeLimitMs: 60_000,
      domainHint: 'business' as const,
    };
    const result = await selectDomainArtifacts(brief);
    expect(result.domain).toBe('business');
    expect(result.types).toContain('gantt_timeline');
  });
});

describe('buildPrompt', () => {
  it('appends SQL instruction for sql outputFormat', () => {
    const spec = {
      type: 'sql_schema' as ForgeArtifactType,
      title: 'Schema',
      systemPrompt: 'You are a DB expert.',
      outputFormat: 'sql' as ForgeOutputFormat,
      filename: 'schema.sql',
    };
    const result = buildPrompt(spec);
    expect(result).toContain('You are a DB expert.');
    expect(result).toContain('raw SQL DDL only');
  });

  it('returns systemPrompt unchanged for markdown outputFormat', () => {
    const spec = {
      type: 'roadmap' as ForgeArtifactType,
      title: 'Roadmap',
      systemPrompt: 'You are a planner.',
      outputFormat: 'markdown' as ForgeOutputFormat,
      filename: 'roadmap.md',
    };
    expect(buildPrompt(spec)).toBe('You are a planner.');
  });
});

describe('ARTIFACT_CATALOG completeness', () => {
  it('every catalog entry has outputFormat and filename', () => {
    for (const [key, entry] of Object.entries(ARTIFACT_CATALOG)) {
      expect(entry.outputFormat, `${key} missing outputFormat`).toBeDefined();
      expect(entry.filename, `${key} missing filename`).toBeDefined();
    }
  });
});

describe('new artifact catalog entries', () => {
  it('dockerfile entry exists with correct outputFormat and filename', () => {
    expect(ARTIFACT_CATALOG['dockerfile']).toMatchObject({
      type: 'dockerfile',
      outputFormat: 'dockerfile',
      filename: 'Dockerfile',
    });
  });

  it('github_actions entry exists with yaml outputFormat', () => {
    expect(ARTIFACT_CATALOG['github_actions']).toMatchObject({
      type: 'github_actions',
      outputFormat: 'yaml',
      filename: '.github/workflows/ci.yml',
    });
  });

  it('gantt_timeline entry exists with markdown outputFormat', () => {
    expect(ARTIFACT_CATALOG['gantt_timeline']).toMatchObject({
      type: 'gantt_timeline',
      outputFormat: 'markdown',
      filename: 'gantt_timeline.md',
    });
  });
});

describe('formatDeliverableFiles', () => {
  it('truncates files exceeding 6000 bytes', () => {
    const largeContent = 'x'.repeat(10000);
    const deliverables = [{ teamId: 'team-a', files: [{ path: 'main.py', content: largeContent }] }];
    const result = formatDeliverableFiles(deliverables);
    expect(result).toContain('--- main.py ---');
    expect(result.length).toBeLessThan(10000);
    expect(result).toContain('[truncated]');
  });

  it('respects MAX_TOTAL_BYTES across multiple files', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.py`,
      content: 'x'.repeat(3000),
    }));
    const deliverables = [{ teamId: 'team-a', files }];
    const result = formatDeliverableFiles(deliverables);
    // Should stop well before all 60000 bytes
    expect(result.length).toBeLessThan(45000);
  });
});

describe('generateStarterKit', () => {
  it('is exported and callable', () => {
    expect(typeof generateStarterKit).toBe('function');
  });
});

describe('DOMAIN_TYPE_DEFAULTS', () => {
  it('software domain includes dockerfile and github_actions', () => {
    const softwareTypes = DOMAIN_TYPE_DEFAULTS['software'];
    expect(softwareTypes).toContain('dockerfile');
    expect(softwareTypes).toContain('github_actions');
    expect(softwareTypes).toContain('sql_schema');
    expect(softwareTypes).toContain('environment_template');
  });

  it('business domain includes gantt_timeline', () => {
    expect(DOMAIN_TYPE_DEFAULTS['business']).toContain('gantt_timeline');
  });

  it('all DOMAIN_TYPE_DEFAULTS types exist in ARTIFACT_CATALOG', () => {
    for (const [domain, types] of Object.entries(DOMAIN_TYPE_DEFAULTS)) {
      for (const t of types) {
        expect(
          Object.keys(ARTIFACT_CATALOG),
          `${domain}.${t} not in ARTIFACT_CATALOG`
        ).toContain(t);
      }
    }
  });
});
