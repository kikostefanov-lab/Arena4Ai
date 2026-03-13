import { describe, it, expect } from 'vitest';
import type { ForgeArtifactType } from '@arena/shared';

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
