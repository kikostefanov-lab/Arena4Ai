> **Historical design document, March 2026.** Model ids, APIs and file paths referenced below are as of that date and are **not current**. It is kept as a record of what was decided then, not as guidance. See `README.md` for current models and `CLAUDE.md` for current usage.

# Sprint 5: Brief Pipeline Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the brief pipeline into a full-spectrum, domain-aware, self-improving system where every downstream stage (judge, presentation, synthesis, forge) receives rich brief context.

**Architecture:** Three layers built in order: (1) shared `buildBriefContext()` utility + pipeline integration + re-evaluate CLI, (2) intelligent multi-step brief generator with domain awareness + quality scoring, (3) feedback telemetry loop + brief library persistence.

**Tech Stack:** TypeScript, Drizzle ORM + PostgreSQL, Express, Claude CLI (`claude --print`), Zod, Next.js 15 App Router, Vitest

**Spec:** `docs/superpowers/specs/2026-03-14-brief-pipeline-overhaul-design.md`

---

## Chunk 1: Shared Types & Brief Context Utility

### Task 1: Add `strategy` to domain enums in `@arena/shared`

**Files:**
- Modify: `packages/shared/src/types/forge.ts:55-61`
- Modify: `packages/shared/src/types/competition.ts:41`
- Modify: `packages/shared/src/schemas/brief.schema.ts:30`

- [ ] **Step 1: Update `ForgeDomain` type**

In `packages/shared/src/types/forge.ts`, add `'strategy'` to the `ForgeDomain` union:

```ts
export type ForgeDomain =
  | 'software'
  | 'research'
  | 'creative'
  | 'security'
  | 'business'
  | 'ideation'
  | 'strategy';
```

- [ ] **Step 2: Update `Brief.domainHint` type**

In `packages/shared/src/types/competition.ts` line 41, add `'strategy'`:

```ts
domainHint?: 'software' | 'research' | 'creative' | 'security' | 'business' | 'ideation' | 'strategy';
```

- [ ] **Step 3: Update `briefSchema` Zod validation**

In `packages/shared/src/schemas/brief.schema.ts` line 30:

```ts
domainHint: z.enum(['software', 'research', 'creative', 'security', 'business', 'ideation', 'strategy']).optional(),
```

- [ ] **Step 4: Run existing tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 211 tests pass (type-only change, no runtime impact)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/forge.ts packages/shared/src/types/competition.ts packages/shared/src/schemas/brief.schema.ts
git commit -m "feat(shared): add 'strategy' to ForgeDomain and Brief.domainHint enums"
```

---

### Task 2: Create `buildBriefContext()` utility

**Files:**
- Create: `packages/orchestrator/src/utils/brief-context.ts`
- Create: `packages/orchestrator/src/utils/__tests__/brief-context.test.ts`

- [ ] **Step 1: Write the test file**

```ts
// packages/orchestrator/src/utils/__tests__/brief-context.test.ts
import { describe, it, expect } from 'vitest';
import { buildBriefContext, JUDGE_CONTEXT, PRESENTER_CONTEXT, SYNTHESIS_CONTEXT, FORGE_CONTEXT, truncateFiles } from '../brief-context.js';
import type { Brief } from '@arena/shared';

const mockBrief: Brief = {
  id: 'test-brief',
  title: 'Test Competition',
  problem: 'Build a widget that solves world hunger. It must handle edge cases gracefully and produce clean output.',
  constraints: ['Must use TypeScript', 'No external APIs', 'Under 500 lines'],
  deliverables: ['widget.ts', 'README.md'],
  rubric: {
    criteria: [
      { id: 'correctness', description: 'Solution produces correct output', weight: 0.5, maxScore: 10 },
      { id: 'design', description: 'Clean architecture and code quality', weight: 0.3, maxScore: 10 },
      { id: 'docs', description: 'README explains usage clearly', weight: 0.2, maxScore: 10 },
    ],
  },
  format: 'SPRINT' as any,
  timeLimitMs: 300000,
  deliverableType: 'code',
  domainHint: 'software',
};

describe('buildBriefContext', () => {
  it('includes only requested fields', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['title', 'problem'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('Test Competition');
    expect(result).toContain('Build a widget');
    expect(result).not.toContain('Must use TypeScript'); // constraints not requested
    expect(result).not.toContain('widget.ts'); // deliverables not requested
  });

  it('includes constraints when requested', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['constraints'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('Must use TypeScript');
    expect(result).toContain('No external APIs');
    expect(result).toContain('Under 500 lines');
  });

  it('includes deliverables list when requested', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['deliverables'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('widget.ts');
    expect(result).toContain('README.md');
  });

  it('rubricDetail=full includes weight and maxScore', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['rubric'],
      rubricDetail: 'full',
    });
    expect(result).toContain('correctness');
    expect(result).toContain('50%');
    expect(result).toContain('max 10');
  });

  it('rubricDetail=weights-only includes weight but not maxScore', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['rubric'],
      rubricDetail: 'weights-only',
    });
    expect(result).toContain('50%');
    expect(result).not.toContain('max 10');
  });

  it('rubricDetail=descriptions-only includes neither weight nor maxScore', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['rubric'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('correctness');
    expect(result).toContain('Solution produces correct output');
    expect(result).not.toContain('50%');
    expect(result).not.toContain('max 10');
  });

  it('handles empty constraints gracefully', () => {
    const brief = { ...mockBrief, constraints: [] };
    const result = buildBriefContext(brief, {
      include: ['constraints'],
      rubricDetail: 'descriptions-only',
    });
    // Should not crash; either omit section or show empty
    expect(result).toBeDefined();
  });

  it('includes format when requested', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['format'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('SPRINT');
  });

  it('includes deliverableType when requested', () => {
    const result = buildBriefContext(mockBrief, {
      include: ['deliverableType'],
      rubricDetail: 'descriptions-only',
    });
    expect(result).toContain('code');
  });
});

describe('truncateFiles', () => {
  it('passes through small files unchanged', () => {
    const files = [{ path: 'a.ts', content: 'hello' }];
    const result = truncateFiles(files, 8000, 50000);
    expect(result).toEqual('### a.ts\n```\nhello\n```');
  });

  it('truncates individual files exceeding per-file limit', () => {
    const content = 'x'.repeat(10000);
    const files = [{ path: 'big.ts', content }];
    const result = truncateFiles(files, 100, 50000);
    expect(result).toContain('[truncated');
    expect(result.length).toBeLessThan(content.length);
  });

  it('respects total budget across multiple files', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.ts`,
      content: 'y'.repeat(5000),
    }));
    const result = truncateFiles(files, 8000, 20000);
    // Should not include all 20 files worth of content
    expect(result.length).toBeLessThan(100000);
  });
});

describe('presets', () => {
  it('JUDGE_CONTEXT includes title, problem, constraints, deliverables, rubric', () => {
    expect(JUDGE_CONTEXT.include).toContain('title');
    expect(JUDGE_CONTEXT.include).toContain('problem');
    expect(JUDGE_CONTEXT.include).toContain('constraints');
    expect(JUDGE_CONTEXT.include).toContain('deliverables');
    expect(JUDGE_CONTEXT.include).toContain('rubric');
    expect(JUDGE_CONTEXT.rubricDetail).toBe('full');
  });

  it('PRESENTER_CONTEXT uses weights-only rubric', () => {
    expect(PRESENTER_CONTEXT.rubricDetail).toBe('weights-only');
  });

  it('SYNTHESIS_CONTEXT includes constraints', () => {
    expect(SYNTHESIS_CONTEXT.include).toContain('constraints');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/orchestrator -- --run src/utils/__tests__/brief-context.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/orchestrator/src/utils/brief-context.ts
import type { Brief } from '@arena/shared';

type IncludeField = 'title' | 'problem' | 'constraints' | 'deliverables' | 'rubric' | 'format' | 'deliverableType';

export interface BriefContextOptions {
  include: IncludeField[];
  rubricDetail: 'full' | 'weights-only' | 'descriptions-only';
  fileTruncation?: number;
  fileBudget?: number;
}

// ── Presets ──────────────────────────────────────────────────────────────────

export const JUDGE_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 12_000,
  fileBudget: 80_000,
};

export const PRESENTER_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'deliverables', 'rubric'],
  rubricDetail: 'weights-only',
  fileTruncation: 8_000,
  fileBudget: 50_000,
};

export const SYNTHESIS_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 8_000,
  fileBudget: 50_000,
};

export const FORGE_CONTEXT: BriefContextOptions = {
  include: ['title', 'problem', 'constraints', 'rubric'],
  rubricDetail: 'full',
  fileTruncation: 6_000,
  fileBudget: 40_000,
};

// ── Utilities ────────────────────────────────────────────────────────────────

export function truncateFiles(
  files: Array<{ path: string; content: string }>,
  perFile: number,
  totalBudget: number,
): string {
  const sections: string[] = [];
  let totalChars = 0;

  for (const f of files) {
    if (totalChars >= totalBudget) {
      sections.push(`\n... (${files.length - sections.length} more files omitted — budget exceeded)`);
      break;
    }

    const remaining = totalBudget - totalChars;
    const limit = Math.min(perFile, remaining);
    const content = f.content.length > limit
      ? f.content.slice(0, limit) + `\n... [truncated at ${limit} chars]`
      : f.content;

    sections.push(`### ${f.path}\n\`\`\`\n${content}\n\`\`\``);
    totalChars += content.length;
  }

  return sections.join('\n\n');
}

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildBriefContext(brief: Brief, options: BriefContextOptions): string {
  const parts: string[] = [];

  if (options.include.includes('title')) {
    parts.push(`## Brief: ${brief.title}`);
  }

  if (options.include.includes('problem')) {
    parts.push(`## Problem\n${brief.problem}`);
  }

  if (options.include.includes('constraints') && brief.constraints.length > 0) {
    const list = brief.constraints.map((c) => `- ${c}`).join('\n');
    parts.push(`## Constraints\n${list}`);
  }

  if (options.include.includes('deliverables') && brief.deliverables.length > 0) {
    const list = brief.deliverables.map((d) => `- ${d}`).join('\n');
    parts.push(`## Expected Deliverables\n${list}`);
  }

  if (options.include.includes('rubric')) {
    const lines = brief.rubric.criteria.map((c) => {
      switch (options.rubricDetail) {
        case 'full':
          return `- **${c.id}** (weight ${Math.round(c.weight * 100)}%, max ${c.maxScore}): ${c.description}`;
        case 'weights-only':
          return `- **${c.id}** (weight ${Math.round(c.weight * 100)}%): ${c.description}`;
        case 'descriptions-only':
          return `- **${c.id}**: ${c.description}`;
      }
    });
    parts.push(`## Rubric Criteria\n${lines.join('\n')}`);
  }

  if (options.include.includes('format')) {
    parts.push(`**Format:** ${brief.format}`);
  }

  if (options.include.includes('deliverableType') && brief.deliverableType) {
    parts.push(`**Deliverable Type:** ${brief.deliverableType}`);
  }

  return parts.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/orchestrator -- --run src/utils/__tests__/brief-context.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 211+ tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/utils/brief-context.ts packages/orchestrator/src/utils/__tests__/brief-context.test.ts
git commit -m "feat: add buildBriefContext() utility with presets and file truncation"
```

---

## Chunk 2: Pipeline Integration (Judge, Presenter, Synthesis, Forge)

### Task 3: Integrate `buildBriefContext` into AI Judge

**Files:**
- Modify: `packages/orchestrator/src/judging/ai-judge.ts`

The judge currently receives only rubric + raw files. After this change it receives the full brief context.

- [ ] **Step 1: Update `aiJudge` function signature**

Add `Brief` import and update `aiJudge` to accept a `brief` parameter:

```ts
// At top of file, update imports:
import type { Brief, Rubric, Deliverable, JudgeResult, CriterionScore } from '@arena/shared';
import { buildBriefContext, truncateFiles, JUDGE_CONTEXT } from '../utils/brief-context.js';
```

- [ ] **Step 2: Rewrite `buildJudgePrompt` to use `buildBriefContext`**

Replace the existing `buildJudgePrompt` function (lines 24-56) with:

```ts
export function buildJudgePrompt(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  judgeId: string,
): string {
  const briefContext = buildBriefContext(brief, JUDGE_CONTEXT);

  const filesText = truncateFiles(
    deliverable.files,
    JUDGE_CONTEXT.fileTruncation!,
    JUDGE_CONTEXT.fileBudget!,
  );

  const adversarialClause = judgeId.includes('adversarial')
    ? '\n\nIMPORTANT: You are an adversarial judge. Look for weaknesses, gaps, and missed edge cases. Score critically — be specific about what is missing or wrong.'
    : '';

  return `You are an impartial competition judge.${adversarialClause}

${briefContext}

## Deliverable Files
${filesText || '(no files submitted)'}

## Your Task
Score this team's deliverables against each criterion. Consider:
1. Does the work address the original problem?
2. Were the stated constraints honored?
3. Were the expected deliverables produced?
4. Quality and depth per criterion.
Be specific — reference actual content from the deliverables in your commentary.
Differentiate: if two teams both attempt the same criterion, one is likely stronger. Say why.

Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore>, "commentary": "<2-3 sentences referencing specific deliverable content>" }
  ]
}`;
}
```

- [ ] **Step 3: Update `aiJudge` function to pass `brief`**

Change the function signature and the `buildJudgePrompt` call:

```ts
export async function aiJudge(
  brief: Brief,
  deliverable: Deliverable,
  rubric: Rubric,
  options: AiJudgeOptions,
): Promise<JudgeResult> {
  const { judgeId, claudeBin = 'claude' } = options;
  const prompt = buildJudgePrompt(brief, deliverable, rubric, judgeId);
  // ... rest unchanged
```

- [ ] **Step 4: Update caller in `competition-runner.ts`**

Find the `aiJudge` calls in `competition-runner.ts` and add `brief` as the first argument. The current call pattern is approximately:

```ts
// Before:
aiJudge(deliverable, brief.rubric, { judgeId: JUDGE_IDS.aiClaude })
// After:
aiJudge(brief, deliverable, brief.rubric, { judgeId: JUDGE_IDS.aiClaude })
```

Search for all `aiJudge(` calls in `competition-runner.ts` and update each one.

- [ ] **Step 5: Update existing judge tests**

Find test files that call `buildJudgePrompt` or `aiJudge` and update them to pass the `brief` parameter. The existing tests in `packages/orchestrator/src/judging/__tests__/` will need mock briefs added.

- [ ] **Step 6: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/judging/ai-judge.ts packages/orchestrator/src/engine/competition-runner.ts
git add -A packages/orchestrator/src/judging/__tests__/
git commit -m "feat(judge): inject full brief context via buildBriefContext — problem, constraints, deliverables"
```

---

### Task 4: Integrate `buildBriefContext` into Presentation Generator

**Files:**
- Modify: `packages/orchestrator/src/presentation/presentation-generator.ts`

- [ ] **Step 1: Import and use `buildBriefContext`**

Add import at top:

```ts
import { buildBriefContext, truncateFiles, PRESENTER_CONTEXT } from '../utils/brief-context.js';
```

- [ ] **Step 2: Replace the ad-hoc brief section in the prompt**

In `generatePresentation()`, replace the manual construction of `criteriaList` and the prompt's `## Original Problem` / `## Constraints` / `## Judging Criteria` sections (lines 51-70) with:

```ts
  const briefContext = buildBriefContext(brief, PRESENTER_CONTEXT);

  const filesSections = truncateFiles(
    deliverable.files,
    PRESENTER_CONTEXT.fileTruncation!,
    PRESENTER_CONTEXT.fileBudget!,
  );
```

Then update the prompt template to use `${briefContext}` instead of the three separate sections. Keep the rest of the prompt (Your Task, return format) unchanged.

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/presentation/presentation-generator.ts
git commit -m "feat(presenter): use buildBriefContext for consistent brief context with weights"
```

---

### Task 5: Integrate `buildBriefContext` into Synthesis

**Files:**
- Modify: `packages/orchestrator/src/synthesis/merge-engine.ts`

- [ ] **Step 1: Import `buildBriefContext`**

```ts
import { buildBriefContext, SYNTHESIS_CONTEXT } from '../utils/brief-context.js';
```

- [ ] **Step 2: Replace the manual brief section in the prompt**

In `synthesizeDeliverables()`, replace the manual `criteriaList` construction (lines 41-43) and the `## Problem` / `## Judging Criteria` sections in the prompt (lines 78-82) with:

```ts
  const briefContext = buildBriefContext(brief as Brief, SYNTHESIS_CONTEXT);
```

Then use `${briefContext}` in the prompt template instead of `## Problem\n${brief.problem}\n\n## Judging Criteria\n${criteriaList}`. This adds `constraints` and `title` that were previously missing.

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/synthesis/merge-engine.ts
git commit -m "feat(synthesis): use buildBriefContext — adds constraints and title to synthesis prompt"
```

---

### Task 6: Normalize Forge to use `buildBriefContext`

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Import `buildBriefContext`**

```ts
import { buildBriefContext, FORGE_CONTEXT } from '../utils/brief-context.js';
```

- [ ] **Step 2: Update `buildForgeUserPrompt` to use the utility**

Find the `buildForgeUserPrompt` function (around line 781) and replace the manual `# Original Brief` section assembly with `buildBriefContext(brief, FORGE_CONTEXT)`. Keep the rest of the function (presentations, synthesis, deliverables sections) unchanged.

- [ ] **Step 3: Add `strategy` to `DOMAIN_TYPE_DEFAULTS`**

Find the `DOMAIN_TYPE_DEFAULTS` object (around line 686) and add:

```ts
strategy: ['roadmap', 'risk_register', 'decision_log', 'gantt_timeline', 'stakeholder_map', 'go_to_market'],
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts
git commit -m "feat(forge): normalize to buildBriefContext, add strategy domain defaults"
```

---

## Chunk 3: Database Schema & Re-evaluate CLI

### Task 7: Create migration for new tables

**Files:**
- Create: `packages/orchestrator/src/db/migrations/0010_brief_pipeline.sql`
- Modify: `packages/orchestrator/src/db/schema.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 0010_brief_pipeline.sql
-- Sprint 5: Brief Pipeline Overhaul — results_history, brief_quality_signals, briefs tables

CREATE TABLE IF NOT EXISTS results_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id TEXT NOT NULL REFERENCES competitions(id),
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stage TEXT NOT NULL,
  previous_results JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_results_history_competition ON results_history(competition_id);

CREATE TABLE IF NOT EXISTS brief_quality_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  score_spread NUMERIC,
  tied BOOLEAN,
  all_eights BOOLEAN,
  criterion_signals JSONB,
  judge_referenced_problem BOOLEAN,
  judge_referenced_constraints BOOLEAN,
  judge_referenced_deliverables BOOLEAN,
  expected_files_produced JSONB,
  total_files_produced INTEGER,
  total_content_size INTEGER,
  forge_domain_matched BOOLEAN,
  forge_artifacts_downloaded INTEGER DEFAULT 0,
  brief_was_ai_generated BOOLEAN,
  brief_edit_distance INTEGER,
  competition_rerun BOOLEAN,
  synthesis_triggered BOOLEAN,
  synthesis_meaningful BOOLEAN,
  UNIQUE(competition_id)
);
CREATE INDEX IF NOT EXISTS idx_quality_signals_competition ON brief_quality_signals(competition_id);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  brief JSONB NOT NULL,
  source TEXT NOT NULL,
  quality_score NUMERIC,
  tags TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Add Drizzle table definitions to `schema.ts`**

Add after the existing table definitions in `packages/orchestrator/src/db/schema.ts`:

```ts
export const resultsHistory = pgTable('results_history', {
  id:             text('id').primaryKey().default(sql`gen_random_uuid()`),
  competitionId:  text('competition_id').notNull().references(() => competitions.id),
  archivedAt:     timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  stage:          text('stage').notNull(),
  previousResults: jsonb('previous_results').notNull(),
}, (t) => [
  index('idx_results_history_competition').on(t.competitionId),
]);

export const briefQualitySignals = pgTable('brief_quality_signals', {
  id:                          text('id').primaryKey().default(sql`gen_random_uuid()`),
  competitionId:               text('competition_id').notNull().references(() => competitions.id, { onDelete: 'cascade' }),
  computedAt:                  timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  scoreSpread:                 numeric('score_spread'),
  tied:                        boolean('tied'),
  allEights:                   boolean('all_eights'),
  criterionSignals:            jsonb('criterion_signals'),
  judgeReferencedProblem:      boolean('judge_referenced_problem'),
  judgeReferencedConstraints:  boolean('judge_referenced_constraints'),
  judgeReferencedDeliverables: boolean('judge_referenced_deliverables'),
  expectedFilesProduced:       jsonb('expected_files_produced'),
  totalFilesProduced:          integer('total_files_produced'),
  totalContentSize:            integer('total_content_size'),
  forgeDomainMatched:          boolean('forge_domain_matched'),
  forgeArtifactsDownloaded:    integer('forge_artifacts_downloaded').default(0),
  briefWasAiGenerated:         boolean('brief_was_ai_generated'),
  briefEditDistance:            integer('brief_edit_distance'),
  competitionRerun:            boolean('competition_rerun'),
  synthesisTriggered:          boolean('synthesis_triggered'),
  synthesisMeaningful:         boolean('synthesis_meaningful'),
}, (t) => [
  uniqueIndex('brief_quality_signals_competition_unique').on(t.competitionId),
]);

export const briefs = pgTable('briefs', {
  id:           text('id').primaryKey(),
  title:        text('title').notNull(),
  brief:        jsonb('brief').notNull(),
  source:       text('source').notNull(),
  qualityScore: numeric('quality_score'),
  tags:         jsonb('tags').$type<string[]>(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Run migration**

Run: `cd packages/orchestrator && DATABASE_URL=postgresql://localhost/arena npm run db:migrate`

- [ ] **Step 4: Run existing tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 211 tests pass (new tables don't affect existing tests)

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/db/migrations/0010_brief_pipeline.sql packages/orchestrator/src/db/schema.ts
git commit -m "feat(db): add results_history, brief_quality_signals, briefs tables (migration 0010)"
```

---

### Task 8: Add repository methods for results history and briefs CRUD

**Files:**
- Modify: `packages/orchestrator/src/db/repository.ts`

- [ ] **Step 1: Add results history methods**

Add to `CompetitionRepository` class:

```ts
  async archiveResult(competitionId: string, stage: string): Promise<void> {
    const current = await this.getResult(competitionId);
    if (!current) return;
    await this.db.insert(resultsHistory).values({
      competitionId,
      stage,
      previousResults: current as Record<string, unknown>,
    });
  }

  async updateScorecards(competitionId: string, scorecards: unknown[], winnerId: string | null): Promise<void> {
    await this.db.update(results)
      .set({ scorecards, winnerId })
      .where(eq(results.competitionId, competitionId));
  }

  async updatePresentations(competitionId: string, presentations: TeamPresentation[]): Promise<void> {
    await this.db.update(results)
      .set({ presentations })
      .where(eq(results.competitionId, competitionId));
  }
```

- [ ] **Step 2: Add briefs CRUD methods**

Add a new `BriefsRepository` class (or add to `CompetitionRepository`):

```ts
export class BriefsRepository {
  constructor(private db: ReturnType<typeof drizzle>) {}

  async list() {
    return this.db.select().from(briefs).orderBy(briefs.createdAt);
  }

  async getById(id: string) {
    const rows = await this.db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async save(entry: typeof briefs.$inferInsert) {
    await this.db.insert(briefs).values(entry)
      .onConflictDoUpdate({
        target: briefs.id,
        set: { title: entry.title, brief: entry.brief, source: entry.source, qualityScore: entry.qualityScore, tags: entry.tags, updatedAt: new Date() },
      });
  }

  async remove(id: string) {
    await this.db.delete(briefs).where(eq(briefs.id, id));
  }

  async seedFromYaml(entries: Array<typeof briefs.$inferInsert>) {
    for (const entry of entries) {
      await this.db.insert(briefs).values(entry)
        .onConflictDoUpdate({
          target: briefs.id,
          set: { title: entry.title, brief: entry.brief, tags: entry.tags, updatedAt: new Date() },
          where: eq(briefs.source, 'yaml'),
        });
    }
  }
}
```

- [ ] **Step 3: Import new schema tables at the top of repository.ts**

```ts
import { competitions, events, results, tournaments, resultsHistory, briefs } from './schema.js';
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/db/repository.ts
git commit -m "feat(db): add archiveResult, updateScorecards, updatePresentations, BriefsRepository"
```

---

### Task 9: Add `re-evaluate` CLI command

**Files:**
- Modify: `packages/orchestrator/src/cli.ts`

- [ ] **Step 1: Add the re-evaluate command**

After the existing `serve` command block in `cli.ts`, add:

```ts
// ── re-evaluate ──────────────────────────────────────────────────────────────
program
  .command('re-evaluate')
  .description('Re-run downstream stages (judge/presentation/synthesis) on completed competitions')
  .argument('[competition-id]', 'Competition ID to re-evaluate (omit with --all)')
  .option('--stage <stage>', 'Stage to re-run: judge, presentation, synthesis, all', 'all')
  .option('--all', 'Re-evaluate all completed competitions')
  .option('--analyze', 'Also trigger quality analysis after re-evaluation')
  .action(async (competitionId: string | undefined, opts: {
    stage: string;
    all?: boolean;
    analyze?: boolean;
  }) => {
    if (!process.env.DATABASE_URL) {
      console.error('[arena] re-evaluate requires DATABASE_URL');
      process.exit(1);
    }

    const { db } = await import('./db/client.js');
    const { CompetitionRepository } = await import('./db/repository.js');
    const repo = new CompetitionRepository(db);

    let ids: string[];
    if (opts.all) {
      const comps = await repo.list();
      ids = comps
        .filter((c: any) => c.state === 'COMPLETE' || c.state === 'FORGE_COMPLETE')
        .map((c: any) => c.id);
    } else if (competitionId) {
      ids = [competitionId];
    } else {
      console.error('[arena] provide a competition ID or --all');
      process.exit(1);
    }

    const stages = opts.stage === 'all'
      ? ['presentation', 'judge', 'synthesis'] as const
      : [opts.stage] as const;

    console.log(`[arena] re-evaluating ${ids.length} competition(s), stages: ${stages.join(' → ')}`);

    for (const id of ids) {
      const comp = await repo.getCompetition(id);
      const result = await repo.getResult(id);
      if (!comp || !result) {
        console.error(`[arena] skip ${id}: missing competition or result`);
        continue;
      }

      const brief = comp.brief as import('@arena/shared').Brief;
      const deliverables = (result.deliverables ?? []) as import('@arena/shared').Deliverable[];

      // Archive current results before overwriting
      await repo.archiveResult(id, opts.stage);
      console.log(`[arena] ${id}: archived current results`);

      for (const stage of stages) {
        if (stage === 'presentation') {
          const { generateAllPresentations } = await import('./presentation/presentation-generator.js');
          const teamModels = new Map((comp.teams as any[]).map((t: any) => [t.id, t.model]));
          const presentations = await generateAllPresentations(brief, deliverables, teamModels);
          await repo.updatePresentations(id, presentations);
          console.log(`[arena] ${id}: presentations regenerated (${presentations.length} teams)`);
        }

        if (stage === 'judge') {
          const { aiJudge, JUDGE_IDS } = await import('./judging/ai-judge.js');
          const { computeOverallScore } = await import('./judging/score-aggregator.js');
          const scorecards = [];
          for (const d of deliverables) {
            const jr = await aiJudge(brief, d, brief.rubric, { judgeId: JUDGE_IDS.aiClaude });
            const finalScore = computeOverallScore(jr.scores, brief.rubric);
            scorecards.push({ teamId: d.teamId, finalScore, judgeResults: [jr] });
          }
          scorecards.sort((a, b) => b.finalScore - a.finalScore);
          const winnerId = scorecards[0]?.teamId ?? null;
          await repo.updateScorecards(id, scorecards, winnerId);
          console.log(`[arena] ${id}: re-judged → winner: ${winnerId} (${scorecards.map(s => `${s.teamId}:${s.finalScore.toFixed(3)}`).join(', ')})`);
        }

        if (stage === 'synthesis') {
          const { synthesizeDeliverables } = await import('./synthesis/merge-engine.js');
          const currentResult = await repo.getResult(id);
          const presentations = (currentResult?.presentations ?? []) as import('@arena/shared').TeamPresentation[];
          const synthesis = await synthesizeDeliverables(brief, deliverables, {}, presentations);
          if (synthesis) {
            await repo.saveSynthesis(id, synthesis);
            console.log(`[arena] ${id}: synthesis regenerated`);
          }
        }
      }
    }

    console.log(`[arena] re-evaluation complete`);
    process.exit(0);
  });
```

- [ ] **Step 2: Test manually**

Run: `DATABASE_URL=postgresql://localhost/arena npx tsx packages/orchestrator/src/cli.ts re-evaluate --help`
Expected: Shows help text with options

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/cli.ts
git commit -m "feat(cli): add re-evaluate command for re-running judge/presentation/synthesis"
```

---

### Task 10: Run re-evaluate on all 11 existing competitions

This is a manual validation step, not code.

- [ ] **Step 1: Re-evaluate all competitions with the new judge**

Run:
```bash
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts re-evaluate --all --stage judge
```
Expected: Each competition gets new scores. Watch for score spreads > 0.05.

- [ ] **Step 2: Compare before/after scores**

Run:
```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgresql://localhost/arena -c "
SELECT rh.competition_id,
       (c.brief->>'title') as title,
       rh.stage,
       rh.archived_at,
       rh.previous_results->'winnerId' as old_winner,
       r.winner_id as new_winner
FROM results_history rh
JOIN competitions c ON c.id = rh.competition_id
JOIN results r ON r.competition_id = rh.competition_id
ORDER BY rh.archived_at;
"
```

- [ ] **Step 3: Document score spread improvement**

Record the before/after score spreads. This validates Layer 1.

---

## Chunk 4: Intelligent Brief Generator (Layer 2)

### Task 11: Create domain templates

**Files:**
- Create: `packages/orchestrator/src/brief/domain-templates.ts`

- [ ] **Step 1: Write domain templates file**

```ts
// packages/orchestrator/src/brief/domain-templates.ts

export type BriefDomain = 'software' | 'business' | 'research' | 'creative' | 'strategy' | 'security' | 'ideation';

export interface DomainTemplate {
  domain: BriefDomain;
  systemFocus: string;
  deliverableType: 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  exemplarCriteria: string[];
  antiPatterns: string[];
  deliverableHints: string[];
  defaultTimeLimitMs: number;
}

export const DOMAIN_TEMPLATES: Record<BriefDomain, DomainTemplate> = {
  software: {
    domain: 'software',
    systemFocus: 'You are designing a competition about building software. Focus on architecture, correctness, edge case handling, and runnable output. Criteria should evaluate specific technical qualities.',
    deliverableType: 'code',
    exemplarCriteria: [
      'error-handling: Graceful handling of invalid input, network failures, and edge cases — not just the happy path',
      'api-design: API surface is intuitive, well-documented, and follows RESTful conventions or framework idioms',
      'test-coverage: Meaningful test cases that cover core logic, edge cases, and failure modes — not just smoke tests',
    ],
    antiPatterns: [
      'Do NOT use generic criteria like "code quality", "efficiency", or "completeness" — these are too vague to score meaningfully.',
      'Criteria must reference specific technical artifacts or behaviors the judge can verify in the deliverables.',
    ],
    deliverableHints: ['main.ts', 'README.md', 'Dockerfile'],
    defaultTimeLimitMs: 300_000,
  },
  business: {
    domain: 'business',
    systemFocus: 'You are designing a competition about business analysis, strategy, or financial reasoning. Focus on data-driven reasoning, feasibility, and actionable recommendations. If specific data is available, embed it directly in the problem statement.',
    deliverableType: 'analysis',
    exemplarCriteria: [
      'financial-accuracy: All calculations (burn rate, runway, LTV/CAC, margins) are correct and explicitly shown',
      'market-insight: Analysis identifies non-obvious market dynamics, competitive threats, or customer segment behaviors supported by data',
      'actionability: Recommendations are specific, time-bound, and financially grounded — not generic advice',
    ],
    antiPatterns: [
      'Do NOT use generic criteria like "quality of analysis" or "thoroughness" — these are too vague.',
      'Criteria should reference specific outputs: calculations, frameworks, or data-backed claims the judge can verify.',
    ],
    deliverableHints: ['analysis.md', 'model.csv', 'recommendations.md'],
    defaultTimeLimitMs: 2_700_000,
  },
  research: {
    domain: 'research',
    systemFocus: 'You are designing a competition about research, investigation, or evidence synthesis. Focus on methodology rigor, evidence quality, and reproducible reasoning.',
    deliverableType: 'document',
    exemplarCriteria: [
      'methodology: Research approach is clearly stated, appropriate for the question, and reproducible',
      'evidence-depth: Claims are supported by specific sources, data, or logical arguments — not assertions',
      'reproducibility: Another researcher could replicate the analysis from the deliverables alone',
    ],
    antiPatterns: [
      'Do NOT use "quality of research" or "depth" without specifying what dimension of depth.',
      'Criteria should reference verifiable aspects: sources cited, methodology documented, conclusions supported.',
    ],
    deliverableHints: ['paper.md', 'methodology.md', 'sources.md'],
    defaultTimeLimitMs: 3_600_000,
  },
  creative: {
    domain: 'creative',
    systemFocus: 'You are designing a competition about creative work: writing, design, communications, or content creation. Focus on originality, craft quality, voice consistency, and audience impact.',
    deliverableType: 'document',
    exemplarCriteria: [
      'voice-consistency: Writing maintains a consistent tone, style, and perspective throughout — no jarring shifts',
      'structural-innovation: The piece uses structure (not just content) to enhance meaning or impact',
      'emotional-impact: The work creates a clear emotional response appropriate to its purpose and audience',
    ],
    antiPatterns: [
      'Do NOT use "creativity" as a criterion — it is too subjective to score meaningfully.',
      'Criteria should reference observable qualities: consistency, structure, specificity, audience alignment.',
    ],
    deliverableHints: ['draft.md', 'outline.md'],
    defaultTimeLimitMs: 1_800_000,
  },
  strategy: {
    domain: 'strategy',
    systemFocus: 'You are designing a competition about strategic planning, systems design, or policy analysis. Focus on systems thinking, tradeoff honesty, feasibility, and implementation paths.',
    deliverableType: 'plan',
    exemplarCriteria: [
      'systems-thinking: Design decisions are connected — changing one thing affects others, and these interdependencies are shown',
      'feasibility: Proposals could actually work given real-world constraints — not utopian hand-waving',
      'tradeoff-honesty: Explicitly states what was sacrificed to achieve goals — honest about costs',
    ],
    antiPatterns: [
      'Do NOT use "strategic quality" or "comprehensiveness" — these are too vague.',
      'Criteria should reference specific analytical outputs: tradeoff matrices, dependency maps, implementation timelines.',
    ],
    deliverableHints: ['strategy.md', 'roadmap.md', 'risk-matrix.md'],
    defaultTimeLimitMs: 3_600_000,
  },
  security: {
    domain: 'security',
    systemFocus: 'You are designing a competition about security analysis, threat modeling, or defensive design. Focus on threat coverage, defense depth, and operational realism.',
    deliverableType: 'mixed',
    exemplarCriteria: [
      'threat-coverage: Identifies attack vectors across all relevant surfaces — not just the obvious ones',
      'defense-depth: Mitigations are layered and account for defense failure — no single points of failure',
      'operational-realism: Controls are implementable by a real team with real constraints, not theoretical perfection',
    ],
    antiPatterns: [
      'Do NOT use "security quality" as a criterion.',
      'Criteria should reference specific deliverables: threat models, control matrices, incident response procedures.',
    ],
    deliverableHints: ['threat-model.md', 'controls.md', 'runbook.md'],
    defaultTimeLimitMs: 2_700_000,
  },
  ideation: {
    domain: 'ideation',
    systemFocus: 'You are designing a competition about concept exploration, hypothesis formation, or MVP scoping. Focus on concept clarity, hypothesis testability, and practical next steps.',
    deliverableType: 'plan',
    exemplarCriteria: [
      'concept-clarity: The core idea is stated in one sentence that a non-expert can understand',
      'hypothesis-quality: Key assumptions are stated as falsifiable hypotheses with proposed validation methods',
      'mvp-viability: The proposed MVP is buildable in the stated timeframe and tests the right hypotheses',
    ],
    antiPatterns: [
      'Do NOT use "innovativeness" or "creativity" — these are subjective and unscoreable.',
      'Criteria should reference tangible outputs: hypothesis lists, MVP specs, validation plans.',
    ],
    deliverableHints: ['concept.md', 'hypotheses.md', 'mvp-spec.md'],
    defaultTimeLimitMs: 1_800_000,
  },
};

/** Classify a domain from raw idea text. Returns a prompt for Claude. */
export function buildIntakePrompt(idea: string): string {
  const domainList = Object.entries(DOMAIN_TEMPLATES)
    .map(([d, t]) => `- ${d}: ${t.systemFocus.split('.')[0]}`)
    .join('\n');

  return `You are classifying a user's competition idea and generating targeted clarifying questions.

Available domains:
${domainList}

User's idea: "${idea}"

Analyze this idea and return JSON (no markdown, no preamble):
{
  "detectedDomain": "<domain>",
  "detectedDeliverableType": "<code|document|analysis|presentation|plan|mixed>",
  "questions": [
    {
      "id": "<short-id>",
      "text": "<question text>",
      "options": ["<option1>", "<option2>", "<option3>"]
    }
  ]
}

Rules:
- Detect the domain that best fits the idea
- Generate 1-3 targeted questions (1 for clear ideas, 3 for vague ones)
- Questions should help determine: what data/context agents will have, what "good" looks like, what format the deliverable should take
- Options should be concrete choices, not "other"
- Keep question text under 100 characters`;
}

/** Build a domain-aware brief generation prompt. */
export function buildGenerationPrompt(
  idea: string,
  answers: Record<string, string>,
  template: DomainTemplate,
  learnings: string,
): string {
  const answersText = Object.entries(answers)
    .map(([q, a]) => `Q: ${q}\nA: ${a}`)
    .join('\n\n');

  return `${template.systemFocus}

${template.antiPatterns.join('\n')}

## Exemplar Criteria (for reference — adapt to the specific problem, don't copy verbatim)
${template.exemplarCriteria.map(c => `- ${c}`).join('\n')}

## User's Idea
"${idea}"

## User's Answers to Clarifying Questions
${answersText || '(no clarifying questions needed)'}

${learnings ? `## Learnings from Past Competitions\n${learnings}` : ''}

## Instructions
Generate a complete competition brief as JSON. Be specific and detailed.

Constraints should actually constrain — not generic advice like "must be well-tested."
Example good constraint: "Work only from the data provided — do not invent additional facts"
Example bad constraint: "Code should be clean and well-organized"

Problem statement should be 3-8 sentences with specific requirements, numbered sub-deliverables if complex.

Return ONLY valid JSON:
{
  "title": "Short compelling title (5-8 words)",
  "problem": "Detailed problem statement (3-8 sentences). Number sub-deliverables if the problem has multiple parts.",
  "constraints": ["Specific constraint 1", "Specific constraint 2", "..."],
  "deliverables": ["filename.ext", "..."],
  "deliverableType": "${template.deliverableType}",
  "domainHint": "${template.domain}",
  "timeLimitMs": ${template.defaultTimeLimitMs},
  "criteria": [
    { "id": "kebab-case-id", "description": "Specific, scoreable description (15+ chars)", "maxScore": 10, "weight": 0.XX }
  ]
}

Requirements:
- 3-6 criteria, weights must sum to 1.0
- Each criterion description must be specific enough that a judge could differentiate between a good and bad submission
- Deliverable filenames must match the deliverableType (e.g., .md for documents, .ts/.py for code)
- timeLimitMs should reflect problem complexity (${Math.round(template.defaultTimeLimitMs / 60000)} minutes default for ${template.domain})`;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/brief/domain-templates.ts
git commit -m "feat(brief): add 7 domain-specific generation templates with exemplar criteria"
```

---

### Task 12: Create intake endpoint

**Files:**
- Create: `packages/orchestrator/src/brief/intake.ts`
- Modify: `packages/orchestrator/src/server/routes/generate-brief.ts`

- [ ] **Step 1: Create the intake module**

```ts
// packages/orchestrator/src/brief/intake.ts
import { spawn } from 'node:child_process';
import { claudeEnv } from '../utils/claude-env.js';
import { extractJson } from '../utils/extract-json.js';
import { buildIntakePrompt, DOMAIN_TEMPLATES, type BriefDomain } from './domain-templates.js';

export interface IntakeResult {
  detectedDomain: BriefDomain;
  detectedDeliverableType: string;
  questions: Array<{
    id: string;
    text: string;
    options: string[];
  }>;
}

export async function runIntake(idea: string, claudeBin = 'claude'): Promise<IntakeResult> {
  const prompt = buildIntakePrompt(idea);

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(claudeBin, ['-p', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: claudeEnv(),
    });
    child.stdin.write(prompt);
    child.stdin.end();
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
    const timer = setTimeout(() => { child.kill(); reject(new Error('intake timeout')); }, 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`intake exited ${code}`));
    });
    child.on('error', reject);
  });

  const parsed = JSON.parse(extractJson(output)) as IntakeResult;

  // Validate domain — fall back to 'software' if unrecognized
  if (!DOMAIN_TEMPLATES[parsed.detectedDomain]) {
    parsed.detectedDomain = 'software';
  }

  return parsed;
}
```

- [ ] **Step 2: Rewrite `generate-brief.ts` with new endpoints**

Replace the entire file content of `packages/orchestrator/src/server/routes/generate-brief.ts`:

```ts
import { Router } from 'express';
import { spawn } from 'node:child_process';
import { claudeEnv } from '../../utils/claude-env.js';
import { extractJson } from '../../utils/extract-json.js';
import { runIntake } from '../../brief/intake.js';
import { DOMAIN_TEMPLATES, buildGenerationPrompt, type BriefDomain } from '../../brief/domain-templates.js';

export const generateBriefRouter = Router();

// POST /generate-brief/intake — domain detection + clarifying questions
generateBriefRouter.post('/intake', async (req, res) => {
  const { idea } = req.body as { idea?: string };
  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short (minimum 10 characters)' });
    return;
  }

  try {
    const result = await runIntake(idea.trim());
    res.json(result);
  } catch (err) {
    console.error('[arena] intake failed:', err);
    res.status(500).json({ error: 'Intake failed' });
  }
});

// POST /generate-brief/generate — domain-aware brief generation
generateBriefRouter.post('/generate', async (req, res) => {
  const { idea, answers = {}, domain, deliverableType, format = 'SPRINT' } = req.body as {
    idea?: string;
    answers?: Record<string, string>;
    domain?: string;
    deliverableType?: string;
    format?: string;
  };

  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short' });
    return;
  }

  const template = DOMAIN_TEMPLATES[(domain as BriefDomain) ?? 'software'] ?? DOMAIN_TEMPLATES.software;

  // Learnings placeholder — Layer 3 will populate this
  const learnings = '';

  const prompt = buildGenerationPrompt(idea.trim(), answers, template, learnings);

  try {
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(claudeBin, ['-p', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeEnv(),
      });
      child.stdin.write(prompt);
      child.stdin.end();
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`exited ${code}`));
      });
      child.on('error', reject);
    });

    const brief = JSON.parse(extractJson(output));
    res.json(brief);
  } catch (err) {
    console.error('[arena] generate-brief failed:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// POST /generate-brief — legacy single-shot endpoint (backward compat)
generateBriefRouter.post('/', async (req, res) => {
  const { idea, format = 'SPRINT' } = req.body as { idea?: string; format?: string };
  if (!idea || typeof idea !== 'string' || idea.trim().length < 10) {
    res.status(400).json({ error: 'Idea too short' });
    return;
  }

  try {
    // Step 1: Run intake to detect domain
    const intake = await runIntake(idea.trim());
    const template = DOMAIN_TEMPLATES[intake.detectedDomain] ?? DOMAIN_TEMPLATES.software;

    // Step 2: Generate brief with detected domain (no user answers for legacy path)
    const learnings = '';
    const prompt = buildGenerationPrompt(idea.trim(), {}, template, learnings);

    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(claudeBin, ['-p', '-'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: claudeEnv(),
      });
      child.stdin.write(prompt);
      child.stdin.end();
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 60_000);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`exited ${code}`));
      });
      child.on('error', reject);
    });

    const brief = JSON.parse(extractJson(output));
    res.json(brief);
  } catch (err) {
    console.error('[arena] generate-brief failed:', err);
    res.status(500).json({ error: 'Generation failed' });
  }
});
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/brief/intake.ts packages/orchestrator/src/server/routes/generate-brief.ts
git commit -m "feat(brief): conversational intake endpoint + domain-aware generation + legacy compat"
```

---

### Task 13: Create brief quality scorer

**Files:**
- Create: `packages/orchestrator/src/brief/quality-scorer.ts`
- Create: `packages/orchestrator/src/brief/__tests__/quality-scorer.test.ts`

- [ ] **Step 1: Write tests for heuristic checks**

```ts
// packages/orchestrator/src/brief/__tests__/quality-scorer.test.ts
import { describe, it, expect } from 'vitest';
import { scoreBriefQuality } from '../quality-scorer.js';

const goodBrief = {
  id: 'test', title: 'Test', format: 'SPRINT',
  problem: 'A'.repeat(250),
  constraints: ['Specific constraint one', 'Specific constraint two'],
  deliverables: ['output.md', 'model.csv'],
  deliverableType: 'analysis' as const,
  rubric: { criteria: [
    { id: 'accuracy', description: 'Financial calculations are correct and shown', weight: 0.5, maxScore: 10 },
    { id: 'insight', description: 'Identifies non-obvious patterns in the data', weight: 0.5, maxScore: 10 },
  ]},
  timeLimitMs: 300000,
};

describe('scoreBriefQuality — heuristic checks', () => {
  it('returns high score for a well-formed brief', () => {
    const report = scoreBriefQuality(goodBrief as any);
    expect(report.overallScore).toBeGreaterThan(0.7);
    expect(report.launchReady).toBe(true);
    expect(report.issues).toHaveLength(0);
  });

  it('flags short criterion descriptions', () => {
    const brief = { ...goodBrief, rubric: { criteria: [
      { id: 'bad', description: '>', weight: 1, maxScore: 10 },
    ]}};
    const report = scoreBriefQuality(brief as any);
    expect(report.issues.some(i => i.field.includes('criteria') && i.severity === 'error')).toBe(true);
  });

  it('flags empty constraints', () => {
    const brief = { ...goodBrief, constraints: [] };
    const report = scoreBriefQuality(brief as any);
    expect(report.issues.some(i => i.field === 'constraints')).toBe(true);
  });

  it('flags short problem statement', () => {
    const brief = { ...goodBrief, problem: 'Too short' };
    const report = scoreBriefQuality(brief as any);
    expect(report.issues.some(i => i.field === 'problem')).toBe(true);
  });

  it('flags duplicate criterion IDs', () => {
    const brief = { ...goodBrief, rubric: { criteria: [
      { id: 'same', description: 'First criterion description here', weight: 0.5, maxScore: 10 },
      { id: 'same', description: 'Second criterion description here', weight: 0.5, maxScore: 10 },
    ]}};
    const report = scoreBriefQuality(brief as any);
    expect(report.issues.some(i => i.field.includes('criteria') && i.message.includes('duplicate'))).toBe(true);
  });

  it('flags weights not summing to 1', () => {
    const brief = { ...goodBrief, rubric: { criteria: [
      { id: 'a', description: 'First criterion description here', weight: 0.3, maxScore: 10 },
      { id: 'b', description: 'Second criterion description here', weight: 0.3, maxScore: 10 },
    ]}};
    const report = scoreBriefQuality(brief as any);
    expect(report.issues.some(i => i.field === 'rubric.weights')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/orchestrator -- --run src/brief/__tests__/quality-scorer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// packages/orchestrator/src/brief/quality-scorer.ts
import type { Brief } from '@arena/shared';

export interface BriefQualityIssue {
  field: string;
  severity: 'error' | 'warning';
  message: string;
  suggestion?: string;
}

export interface CriterionSuggestion {
  criterionId: string;
  currentDescription: string;
  suggestedDescription: string;
  reason: string;
}

export interface BriefQualityReport {
  overallScore: number;
  launchReady: boolean;
  issues: BriefQualityIssue[];
  suggestions: CriterionSuggestion[];
}

/** Heuristic-only brief quality check (instant, no LLM). */
export function scoreBriefQuality(brief: Brief): BriefQualityReport {
  const issues: BriefQualityIssue[] = [];

  // Problem statement length
  if ((brief.problem ?? '').length < 200) {
    issues.push({
      field: 'problem',
      severity: 'warning',
      message: `Problem statement is only ${brief.problem.length} chars — aim for 200+ for clear agent guidance`,
    });
  }

  // Constraints
  if (!brief.constraints || brief.constraints.length === 0) {
    issues.push({
      field: 'constraints',
      severity: 'warning',
      message: 'No constraints specified — agents may produce unfocused work',
      suggestion: 'Add 2-5 specific constraints that narrow the solution space',
    });
  }

  // Criterion descriptions
  const criteria = brief.rubric?.criteria ?? [];
  for (let i = 0; i < criteria.length; i++) {
    const c = criteria[i];
    if (c.description.length < 15) {
      issues.push({
        field: `criteria[${i}].description`,
        severity: 'error',
        message: `Criterion "${c.id}" description is too short (${c.description.length} chars) — judges can't score this meaningfully`,
        suggestion: 'Describe what "good" looks like for this criterion in 15+ characters',
      });
    }
  }

  // Duplicate criterion IDs
  const ids = criteria.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length > 0) {
    issues.push({
      field: `criteria`,
      severity: 'error',
      message: `Duplicate criterion IDs: ${[...new Set(dupes)].join(', ')} — each must be unique`,
    });
  }

  // Weights sum
  const weightSum = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(weightSum - 1.0) > 0.05) {
    issues.push({
      field: 'rubric.weights',
      severity: 'error',
      message: `Criterion weights sum to ${weightSum.toFixed(2)}, not 1.0`,
    });
  }

  // deliverableType not defaulting to code
  if (!brief.deliverableType || brief.deliverableType === 'code') {
    // Only flag if deliverables don't look like code
    const codeExts = ['.ts', '.js', '.py', '.rb', '.sh', '.go', '.rs', '.java'];
    const hasCodeFiles = (brief.deliverables ?? []).some((d) =>
      codeExts.some((ext) => d.endsWith(ext)),
    );
    if (!hasCodeFiles && brief.deliverables?.length) {
      issues.push({
        field: 'deliverableType',
        severity: 'warning',
        message: 'deliverableType is "code" but deliverables don\'t include code files — consider "document", "analysis", or "plan"',
      });
    }
  }

  // Score: start at 1.0, deduct for issues
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const overallScore = Math.max(0, 1.0 - errorCount * 0.2 - warningCount * 0.1);

  return {
    overallScore,
    launchReady: overallScore >= 0.7,
    issues,
    suggestions: [], // LLM suggestions added separately
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace=packages/orchestrator -- --run src/brief/__tests__/quality-scorer.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Add quality endpoint to generate-brief router**

In `generate-brief.ts`, add:

```ts
import { scoreBriefQuality } from '../../brief/quality-scorer.js';

// POST /generate-brief/quality — brief quality check
generateBriefRouter.post('/quality', async (req, res) => {
  const { brief } = req.body as { brief?: any };
  if (!brief) {
    res.status(400).json({ error: 'Missing brief' });
    return;
  }
  const report = scoreBriefQuality(brief);
  res.json(report);
});
```

- [ ] **Step 6: Run full test suite**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/brief/quality-scorer.ts packages/orchestrator/src/brief/__tests__/quality-scorer.test.ts packages/orchestrator/src/server/routes/generate-brief.ts
git commit -m "feat(brief): add heuristic quality scorer with 7 checks + quality endpoint"
```

---

## Chunk 5: Brief Library Persistence

### Task 14: Rewrite briefs routes for DB-backed CRUD

**Files:**
- Modify: `packages/orchestrator/src/server/routes/briefs.ts`
- Modify: `packages/orchestrator/src/server/app.ts`

- [ ] **Step 1: Rewrite briefs.ts for DB CRUD**

Replace the entire file:

```ts
// packages/orchestrator/src/server/routes/briefs.ts
import { Router } from 'express';
import type { Request, Response } from 'express';
import { BriefsRepository } from '../../db/repository.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export function createBriefsRouter(briefsRepo: BriefsRepository) {
  const router = Router();

  // GET /briefs — list all briefs from DB
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const rows = await briefsRepo.list();
      const mapped = rows.map((r) => ({
        id: r.id,
        title: r.title,
        brief: r.brief,
        source: r.source,
        qualityScore: r.qualityScore ? Number(r.qualityScore) : null,
        tags: r.tags ?? [],
        createdAt: r.createdAt,
      }));
      res.json(mapped);
    } catch (err) {
      res.status(500).json({ error: 'Failed to list briefs', details: String(err) });
    }
  });

  // POST /briefs — save a brief to the library
  router.post('/', async (req: Request, res: Response) => {
    const { brief, source = 'generated', tags } = req.body as {
      brief?: any; source?: string; tags?: string[];
    };
    if (!brief || !brief.title) {
      res.status(400).json({ error: 'Missing brief or brief.title' });
      return;
    }

    const id = brief.id ?? brief.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    try {
      await briefsRepo.save({
        id,
        title: brief.title,
        brief,
        source,
        qualityScore: brief._qualityScore ?? null,
        tags: tags ?? brief.tags ?? [],
      });
      res.status(201).json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to save brief', details: String(err) });
    }
  });

  // PUT /briefs/:id — update
  router.put('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    const { brief, tags } = req.body as { brief?: any; tags?: string[] };
    if (!brief) {
      res.status(400).json({ error: 'Missing brief' });
      return;
    }
    try {
      await briefsRepo.save({
        id,
        title: brief.title ?? id,
        brief,
        source: 'generated',
        tags: tags ?? brief.tags ?? [],
      });
      res.json({ id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update brief', details: String(err) });
    }
  });

  // DELETE /briefs/:id — remove (YAML-sourced briefs protected)
  router.delete('/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
      const existing = await briefsRepo.getById(id);
      if (!existing) {
        res.status(404).json({ error: 'Brief not found' });
        return;
      }
      if (existing.source === 'yaml') {
        res.status(403).json({ error: 'Cannot delete YAML-sourced briefs via API — edit the YAML file instead' });
        return;
      }
      await briefsRepo.remove(id);
      res.json({ deleted: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete brief', details: String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 2: Update app.ts to mount the new briefs router**

In `packages/orchestrator/src/server/app.ts`, update the briefs import and mounting:

Change:
```ts
import { briefsRouter } from './routes/briefs.js';
// ...
app.use('/briefs', briefsRouter);
```

To:
```ts
import { createBriefsRouter } from './routes/briefs.js';
// ...
const briefsRepo = new BriefsRepository(db);
app.use('/briefs', createBriefsRouter(briefsRepo));
```

Add the `BriefsRepository` import at the top. Also add YAML seeding on startup:

```ts
// Seed YAML briefs into DB on startup
import { seedYamlBriefs } from './routes/briefs-seed.js';
seedYamlBriefs(briefsRepo).catch(console.error);
```

- [ ] **Step 3: Create the YAML seeder**

Create `packages/orchestrator/src/server/routes/briefs-seed.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { BriefsRepository } from '../../db/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const BRIEFS_DIR = join(REPO_ROOT, 'briefs');

export async function seedYamlBriefs(repo: BriefsRepository): Promise<void> {
  try {
    const files = readdirSync(BRIEFS_DIR).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    const entries = files.map((filename) => {
      const raw = readFileSync(join(BRIEFS_DIR, filename), 'utf-8');
      const parsed = yaml.load(raw) as Record<string, any>;
      const id = parsed?.id ?? filename.replace(/\.(yml|yaml)$/, '');
      return {
        id,
        title: parsed?.title ?? filename,
        brief: parsed,
        source: 'yaml' as const,
        tags: parsed?.tags ?? [],
      };
    }).filter(Boolean);

    await repo.seedFromYaml(entries);
    console.log(`[arena] seeded ${entries.length} YAML briefs into DB`);
  } catch (err) {
    console.error('[arena] YAML brief seeding failed:', (err as Error).message);
  }
}
```

- [ ] **Step 4: Update the web proxy route**

Update `packages/web/app/api/briefs/route.ts` to pass through the new response shape.

- [ ] **Step 5: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/server/routes/briefs.ts packages/orchestrator/src/server/routes/briefs-seed.ts packages/orchestrator/src/server/app.ts
git commit -m "feat(briefs): DB-backed CRUD endpoints with YAML seeding on startup"
```

---

## Chunk 6: Feedback Telemetry (Layer 3)

### Task 15: Create quality analyzer

**Files:**
- Create: `packages/orchestrator/src/telemetry/quality-analyzer.ts`
- Create: `packages/orchestrator/src/telemetry/__tests__/quality-analyzer.test.ts`

- [ ] **Step 1: Write tests for heuristic signal computation**

```ts
// packages/orchestrator/src/telemetry/__tests__/quality-analyzer.test.ts
import { describe, it, expect } from 'vitest';
import { computeHeuristicSignals } from '../quality-analyzer.js';

describe('computeHeuristicSignals', () => {
  it('detects tight score spread', () => {
    const scorecards = [
      { teamId: 'a', finalScore: 0.82, judgeResults: [{ scores: [{ criterionId: 'c1', score: 8, commentary: 'good' }] }] },
      { teamId: 'b', finalScore: 0.82, judgeResults: [{ scores: [{ criterionId: 'c1', score: 8, commentary: 'good' }] }] },
    ];
    const signals = computeHeuristicSignals(scorecards, ['widget.ts'], [{ teamId: 'a', files: [{ path: 'widget.ts', content: 'code' }] }]);
    expect(signals.tied).toBe(true);
    expect(signals.scoreSpread).toBe(0);
  });

  it('detects all-eights pattern', () => {
    const scorecards = [
      { teamId: 'a', finalScore: 0.8, judgeResults: [{ scores: [
        { criterionId: 'c1', score: 8, commentary: '' },
        { criterionId: 'c2', score: 8, commentary: '' },
      ] }] },
      { teamId: 'b', finalScore: 0.8, judgeResults: [{ scores: [
        { criterionId: 'c1', score: 8, commentary: '' },
        { criterionId: 'c2', score: 7, commentary: '' },
      ] }] },
    ];
    const signals = computeHeuristicSignals(scorecards, [], []);
    expect(signals.allEights).toBe(true);
  });

  it('identifies missing expected files', () => {
    const signals = computeHeuristicSignals(
      [{ teamId: 'a', finalScore: 0.9, judgeResults: [] }],
      ['widget.ts', 'README.md'],
      [{ teamId: 'a', files: [{ path: 'widget.ts', content: 'x' }] }],
    );
    expect(signals.expectedFilesProduced.missing).toContain('README.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=packages/orchestrator -- --run src/telemetry/__tests__/quality-analyzer.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```ts
// packages/orchestrator/src/telemetry/quality-analyzer.ts

export interface HeuristicSignals {
  scoreSpread: number;
  tied: boolean;
  allEights: boolean;
  criterionSignals: Array<{ criterionId: string; scoreSpread: number; avgScore: number }>;
  expectedFilesProduced: { expected: string[]; found: string[]; missing: string[] };
  totalFilesProduced: number;
  totalContentSize: number;
}

export function computeHeuristicSignals(
  scorecards: any[],
  expectedDeliverables: string[],
  deliverables: any[],
): HeuristicSignals {
  // Score spread
  const scores = scorecards.map((sc) => sc.finalScore as number).sort((a, b) => b - a);
  const scoreSpread = scores.length >= 2 ? scores[0] - scores[scores.length - 1] : 0;
  const tied = scoreSpread < 0.01;

  // All-eights: every criterion score between 7 and 9
  let allEights = true;
  const criterionMap = new Map<string, number[]>();
  for (const sc of scorecards) {
    for (const jr of sc.judgeResults ?? []) {
      for (const s of jr.scores ?? []) {
        if (s.score < 7 || s.score > 9) allEights = false;
        const arr = criterionMap.get(s.criterionId) ?? [];
        arr.push(s.score);
        criterionMap.set(s.criterionId, arr);
      }
    }
  }

  // Per-criterion signals
  const criterionSignals = [...criterionMap.entries()].map(([id, scores]) => ({
    criterionId: id,
    scoreSpread: Math.max(...scores) - Math.min(...scores),
    avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
  }));

  // Expected files
  const allFiles = deliverables.flatMap((d: any) => (d.files ?? []).map((f: any) => f.path));
  const found = expectedDeliverables.filter((e) => allFiles.some((f: string) => f.endsWith(e) || f === e));
  const missing = expectedDeliverables.filter((e) => !found.includes(e));

  const totalContentSize = deliverables.reduce(
    (sum: number, d: any) => sum + (d.files ?? []).reduce((s: number, f: any) => s + (f.content?.length ?? 0), 0),
    0,
  );

  return {
    scoreSpread,
    tied,
    allEights,
    criterionSignals,
    expectedFilesProduced: { expected: expectedDeliverables, found, missing },
    totalFilesProduced: allFiles.length,
    totalContentSize,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator -- --run src/telemetry/__tests__/quality-analyzer.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/telemetry/quality-analyzer.ts packages/orchestrator/src/telemetry/__tests__/quality-analyzer.test.ts
git commit -m "feat(telemetry): add computeHeuristicSignals for post-competition quality analysis"
```

---

### Task 16: Create learnings extractor

**Files:**
- Create: `packages/orchestrator/src/telemetry/learnings.ts`

- [ ] **Step 1: Write the learnings extractor**

```ts
// packages/orchestrator/src/telemetry/learnings.ts
import { briefQualitySignals } from '../db/schema.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export async function getGeneratorLearnings(db: NodePgDatabase): Promise<string> {
  try {
    const rows = await db.select().from(briefQualitySignals);
    if (rows.length < 3) return ''; // Not enough data for meaningful learnings

    const totalComps = rows.length;
    const tiedCount = rows.filter((r) => r.tied).length;
    const allEightsCount = rows.filter((r) => r.allEights).length;
    const avgSpread = rows.reduce((sum, r) => sum + Number(r.scoreSpread ?? 0), 0) / totalComps;

    // Find which criteria patterns correlate with low spread
    const lowSpreadRows = rows.filter((r) => Number(r.scoreSpread ?? 0) < 0.03);
    const highSpreadRows = rows.filter((r) => Number(r.scoreSpread ?? 0) > 0.05);

    const parts: string[] = [`Based on ${totalComps} past competitions:`];

    if (allEightsCount / totalComps > 0.3) {
      parts.push(`- ${Math.round(allEightsCount / totalComps * 100)}% of competitions produce "all 8s" scoring — criteria need to be more specific to drive differentiation.`);
    }

    if (tiedCount / totalComps > 0.2) {
      parts.push(`- ${Math.round(tiedCount / totalComps * 100)}% of competitions end in ties (spread < 0.01). More distinctive criteria reduce ties.`);
    }

    parts.push(`- Average score spread is ${avgSpread.toFixed(3)}. Briefs with 4+ specific constraints tend to produce wider spreads.`);

    if (highSpreadRows.length > 0) {
      parts.push(`- The most differentiating criterion pattern: "[verb] [specific domain artifact]" — e.g., "financial calculations are correct", "governance structure addresses power concentration".`);
    }

    return parts.join('\n');
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/orchestrator/src/telemetry/learnings.ts
git commit -m "feat(telemetry): add getGeneratorLearnings() for feedback injection into brief generator"
```

---

### Task 17: Wire learnings into the brief generator

**Files:**
- Modify: `packages/orchestrator/src/server/routes/generate-brief.ts`

- [ ] **Step 1: Import and call `getGeneratorLearnings`**

At the top of `generate-brief.ts`, add:

```ts
import { getGeneratorLearnings } from '../../telemetry/learnings.js';
```

In both the `/generate` and `/` (legacy) handlers, replace:
```ts
const learnings = '';
```
with:
```ts
let learnings = '';
try {
  if (process.env.DATABASE_URL) {
    const { db } = await import('../../db/client.js');
    learnings = await getGeneratorLearnings(db);
  }
} catch { /* non-fatal */ }
```

- [ ] **Step 2: Add seed-quality-signals CLI command**

In `cli.ts`, add:

```ts
program
  .command('seed-quality-signals')
  .description('Retroactively analyze all completed competitions for quality signals')
  .action(async () => {
    if (!process.env.DATABASE_URL) {
      console.error('[arena] requires DATABASE_URL');
      process.exit(1);
    }
    const { db } = await import('./db/client.js');
    const { CompetitionRepository } = await import('./db/repository.js');
    const { computeHeuristicSignals } = await import('./telemetry/quality-analyzer.js');
    const { briefQualitySignals } = await import('./db/schema.js');

    const repo = new CompetitionRepository(db);
    const comps = await repo.list();
    const completed = comps.filter((c: any) => c.state === 'COMPLETE' || c.state === 'FORGE_COMPLETE');

    for (const comp of completed) {
      const result = await repo.getResult(comp.id);
      if (!result) continue;

      const brief = comp.brief as any;
      const signals = computeHeuristicSignals(
        result.scorecards as any[] ?? [],
        brief.deliverables ?? [],
        result.deliverables ?? [],
      );

      await db.insert(briefQualitySignals).values({
        competitionId: comp.id,
        scoreSpread: String(signals.scoreSpread),
        tied: signals.tied,
        allEights: signals.allEights,
        criterionSignals: signals.criterionSignals,
        expectedFilesProduced: signals.expectedFilesProduced,
        totalFilesProduced: signals.totalFilesProduced,
        totalContentSize: signals.totalContentSize,
      }).onConflictDoUpdate({
        target: briefQualitySignals.competitionId,
        set: {
          computedAt: new Date(),
          scoreSpread: String(signals.scoreSpread),
          tied: signals.tied,
          allEights: signals.allEights,
          criterionSignals: signals.criterionSignals,
          expectedFilesProduced: signals.expectedFilesProduced,
          totalFilesProduced: signals.totalFilesProduced,
          totalContentSize: signals.totalContentSize,
        },
      });

      console.log(`[arena] ${comp.id}: spread=${signals.scoreSpread.toFixed(3)} tied=${signals.tied} allEights=${signals.allEights}`);
    }

    console.log(`[arena] seeded quality signals for ${completed.length} competitions`);
    process.exit(0);
  });
```

- [ ] **Step 3: Run full test suite**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/server/routes/generate-brief.ts packages/orchestrator/src/cli.ts
git commit -m "feat(telemetry): wire learnings into generator, add seed-quality-signals CLI"
```

---

## Chunk 7: Web UI Updates

### Task 18: Update `/competitions/new` with intake flow

**Files:**
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/api/briefs/route.ts`

This is a large UI task. The key changes:

- [ ] **Step 1: Add intake state management**

Add new state variables for the intake flow:
- `intakeQuestions` — questions from the intake endpoint
- `intakeAnswers` — user's selected answers
- `qualityReport` — from the quality endpoint
- `detectedDomain` / `detectedDeliverableType` — from intake

- [ ] **Step 2: Replace the AI generate flow**

When the user clicks "Generate" (the sparkle button), instead of calling `POST /api/generate-brief` directly:
1. Call `POST /api/generate-brief/intake` with the idea text
2. Show the returned questions in a panel
3. After the user answers, call `POST /api/generate-brief/generate` with idea + answers + domain
4. Show the editable brief preview with quality annotations

- [ ] **Step 3: Add quality scoring on the preview**

After generation, call `POST /api/generate-brief/quality` with the brief. Display issues inline on each field. Show the quality meter.

Run heuristic checks on every edit (client-side reimplementation of the heuristic checks). Call the LLM quality endpoint on 2-second debounce.

- [ ] **Step 4: Add "Save to Library" button**

In the preview step, add a button that calls `POST /api/briefs` with the current brief.

- [ ] **Step 5: Add `deliverableType` and `domainHint` dropdowns**

Make these visible and editable in the preview step. Currently they're hidden or defaulted.

- [ ] **Step 6: Add web API proxy routes for new endpoints**

Create or update:
- `packages/web/app/api/generate-brief/intake/route.ts`
- `packages/web/app/api/generate-brief/generate/route.ts`
- `packages/web/app/api/generate-brief/quality/route.ts`

Each proxies to the corresponding orchestrator endpoint.

- [ ] **Step 7: Update `packages/web/app/api/briefs/route.ts`**

Update the proxy to pass through the new response shape from the DB-backed endpoint. The `/briefs` page will need to consume `brief.problem` instead of `problemSnippet`.

- [ ] **Step 8: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add packages/web/app/competitions/new/page.tsx packages/web/app/api/
git commit -m "feat(web): conversational intake flow, quality preview, save-to-library in competitions/new"
```

---

### Task 19: Update `/briefs` page for DB-backed library

**Files:**
- Modify: `packages/web/app/briefs/page.tsx`

- [ ] **Step 1: Update data fetching for new response shape**

Change from consuming `{ id, title, format, tags, problemSnippet }` to `{ id, title, brief, source, qualityScore, tags }`. Extract display fields from `brief` object.

- [ ] **Step 2: Add source badges**

Show `YAML` | `Generated` | `From Competition` badge on each card using the `source` field.

- [ ] **Step 3: Add quality score meter**

Small visual meter on each card showing `qualityScore` (0-1 scale).

- [ ] **Step 4: Add "+ New Brief" button**

Links to `/competitions/new?mode=library` (or opens the intake flow inline).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/briefs/page.tsx
git commit -m "feat(web): DB-backed brief library with source badges, quality scores, new brief button"
```

---

### Task 20: Add "Save Brief to Library" on competition detail page

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Add save button**

In the competition detail page, add a "Save Brief to Library" button visible when state is `COMPLETE` or `FORGE_COMPLETE`. On click, call `POST /api/briefs` with the competition's brief and `source: 'competition'`.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/competitions/[id]/page.tsx
git commit -m "feat(web): add 'Save Brief to Library' button on competition detail page"
```

---

## Chunk 8: Final Validation & Cleanup

### Task 21: Run full test suite and type check

- [ ] **Step 1: Run orchestrator tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 211+ tests pass (plus ~40 new tests)

- [ ] **Step 2: Run web type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: No errors

- [ ] **Step 3: Seed quality signals from existing competitions**

Run:
```bash
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts seed-quality-signals
```
Expected: 11 competitions analyzed

### Task 22: Run a new competition through the full pipeline

- [ ] **Step 1: Generate a brief through the new intake flow**

Open `http://localhost:3001/competitions/new`, enter a non-code idea (e.g., "analyze why restaurants fail in their first year"), go through the intake questions, review the generated brief quality.

- [ ] **Step 2: Launch the competition**

Run it with two teams and observe the judge scores.

- [ ] **Step 3: Verify score differentiation**

Check that the score spread is > 0.05 and judge commentary references specific deliverable content.

- [ ] **Step 4: Save the brief to the library**

Click "Save Brief to Library" on the competition detail page and verify it appears in `/briefs`.

### Task 23: Update CLAUDE.md and commit

- [ ] **Step 1: Update CLAUDE.md with Sprint 5 changes**

Add new API endpoints, CLI commands, and architecture changes to the CLAUDE.md reference.

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md for Sprint 5 — brief pipeline overhaul"
```
