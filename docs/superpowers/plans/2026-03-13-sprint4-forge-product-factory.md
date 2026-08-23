> **Historical design document, March 2026.** Model ids, APIs and file paths referenced below are as of that date and are **not current**. It is kept as a record of what was decided then, not as guidance. See `README.md` for current models and `CLAUDE.md` for current usage.

# Sprint 4 — Forge as Product Factory: Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Forge output from markdown planning docs into a structured, immediately usable launchpad — format-routed ZIP with new artifact types (SQL, Dockerfile, CI YAML, CSV, Gantt), a starter kit pass that consumes winning code, and per-artifact download buttons with a format-aware preview modal.

**Architecture:** Four incremental layers: (1) format routing infrastructure — artifacts declare `outputFormat`/`filename`, ZIP organizes by folder; (2) new catalog artifact types keyed by domain; (3) starter kit pass that reads winner/loser deliverables and emits reference implementation + test scaffold + README; (4) per-artifact download UI with format-aware modal.

**Tech Stack:** TypeScript, Vitest, Next.js 15 App Router, JSZip, `archiver`, Zod, `@arena/shared` types

---

## Chunk 1: Shared Types + Backward Compat

### Task 1: Extend ForgeArtifact type and add ForgeOutputFormat

**Files:**
- Modify: `packages/shared/src/types/forge.ts`

- [ ] **Step 1: Read the current forge types file**

```bash
cat packages/shared/src/types/forge.ts
```

- [ ] **Step 2: Extend `ForgeArtifactType` union**

Add the following six values to the existing `ForgeArtifactType` union (confirm `sql_schema`, `environment_template`, `slide_deck`, `spreadsheet_export` already present — add only what's missing):

```ts
| 'dockerfile'
| 'github_actions'
| 'gantt_timeline'
| 'reference_implementation'
| 'test_suite_template'
| 'project_readme'
```

- [ ] **Step 3: Add `ForgeOutputFormat` type**

Add before or after `ForgeArtifactType`:

```ts
export type ForgeOutputFormat =
  | 'markdown'
  | 'sql'
  | 'csv'
  | 'yaml'
  | 'json'
  | 'text'
  | 'dockerfile';
```

- [ ] **Step 4: Add fields to `ForgeArtifact` interface**

Add `outputFormat` and `filename` to the existing `ForgeArtifact` interface — preserve `generatedAt` and `universal`:

```ts
export interface ForgeArtifact {
  type: ForgeArtifactType;
  title: string;
  content: string;
  generatedAt: string;              // existing — preserve
  universal?: boolean;              // existing — preserve
  outputFormat: ForgeOutputFormat;  // NEW
  filename: string;                 // NEW
}
```

- [ ] **Step 5: Run typecheck to confirm no regressions**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: zero errors (existing code uses `ForgeArtifact` without the new fields — TypeScript will flag this in orchestrator code we haven't updated yet, so fix the next task before committing)

---

### Task 2: Backward compat normalization in repository.ts

**Files:**
- Modify: `packages/orchestrator/src/repository.ts`

- [ ] **Step 1: Write the failing test**

In `packages/orchestrator/src/forge/forge-orchestrator.test.ts` (or a new `repository.test.ts` if it doesn't exist), add:

```ts
describe('normalizeArtifact (backward compat)', () => {
  it('sets outputFormat to markdown and filename to {type}.md for legacy records', () => {
    // Simulate a legacy artifact persisted without the new fields
    const legacy = {
      type: 'roadmap',
      title: 'Roadmap',
      content: '# Roadmap',
      generatedAt: '2024-01-01T00:00:00.000Z',
    } as unknown as ForgeArtifact;

    const normalized = normalizeArtifact(legacy);
    expect(normalized.outputFormat).toBe('markdown');
    expect(normalized.filename).toBe('roadmap.md');
  });

  it('does not overwrite existing outputFormat and filename', () => {
    const artifact: ForgeArtifact = {
      type: 'sql_schema',
      title: 'Schema',
      content: 'CREATE TABLE ...',
      generatedAt: '2024-01-01T00:00:00.000Z',
      outputFormat: 'sql',
      filename: 'schema.sql',
    };

    const normalized = normalizeArtifact(artifact);
    expect(normalized.outputFormat).toBe('sql');
    expect(normalized.filename).toBe('schema.sql');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'normalizeArtifact|FAIL|PASS'
```

Expected: FAIL — `normalizeArtifact` is not exported

- [ ] **Step 3: Find where ForgeRun artifacts are read from DB**

In `packages/orchestrator/src/repository.ts`, find the function(s) that deserialize `results.forge` (look for `JSON.parse` or `as ForgeRun` casts near `results.forge`).

- [ ] **Step 4: Add `normalizeArtifact` helper and call it on read**

Add an exported helper function (export it for the test):

```ts
export function normalizeArtifact(artifact: ForgeArtifact): ForgeArtifact {
  return {
    ...artifact,
    outputFormat: artifact.outputFormat ?? 'markdown',
    filename: artifact.filename ?? `${artifact.type}.md`,
  };
}
```

In the same file, wherever `ForgeRun` artifacts are deserialized from DB JSON, apply the normalizer:

```ts
// Where run.artifacts is deserialized:
run.artifacts = (run.artifacts ?? []).map(normalizeArtifact);
```

Also handle the legacy backward compat for `result.forge` being a single `ForgeOutput` object (not an array) — the existing code in `repository.ts` already wraps it into a 1-element array. After that wrapping, apply `normalizeArtifact` to each run's artifacts.

- [ ] **Step 5: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'normalizeArtifact|FAIL|PASS'
```

Expected: PASS

- [ ] **Step 6: Run /simplify on changed files**

```bash
git diff
```

Review the diff, then invoke `/simplify` to check for reuse/quality/efficiency issues. Fix any findings.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/types/forge.ts packages/orchestrator/src/repository.ts packages/orchestrator/src/forge/forge-orchestrator.test.ts
git commit -m "feat(forge): add ForgeOutputFormat type and backward-compat normalization"
```

---

## Chunk 2: Catalog Infrastructure

### Task 3: Update ArtifactSpec + buildPrompt + generateArtifact

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Read the current forge-orchestrator file**

```bash
cat packages/orchestrator/src/forge/forge-orchestrator.ts
```

- [ ] **Step 2: Write a failing test for buildPrompt**

In `packages/orchestrator/src/forge/forge-orchestrator.test.ts`:

```ts
describe('buildPrompt', () => {
  it('appends SQL instruction for sql outputFormat', () => {
    const spec: ArtifactSpec = {
      type: 'sql_schema',
      title: 'Schema',
      systemPrompt: 'You are a DB expert.',
      outputFormat: 'sql',
      filename: 'schema.sql',
    };
    const result = buildPrompt(spec);
    expect(result).toContain('You are a DB expert.');
    expect(result).toContain('raw SQL DDL only');
  });

  it('returns systemPrompt unchanged for markdown outputFormat', () => {
    const spec: ArtifactSpec = {
      type: 'roadmap',
      title: 'Roadmap',
      systemPrompt: 'You are a planner.',
      outputFormat: 'markdown',
      filename: 'roadmap.md',
    };
    expect(buildPrompt(spec)).toBe('You are a planner.');
  });
});
```

Note: `buildPrompt` and `ArtifactSpec` need to be exported or the test needs to be in the same file scope. Use named exports if the test file imports them, or move the test inline as a co-located test if the file structure warrants it. Check how existing tests in `forge-orchestrator.test.ts` access internal functions.

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'buildPrompt|FAIL|PASS'
```

Expected: FAIL

- [ ] **Step 4: Add `outputFormat` and `filename` to `ArtifactSpec` interface**

In `forge-orchestrator.ts`, find the `ArtifactSpec` interface and add:

```ts
interface ArtifactSpec {
  type: ForgeArtifactType;
  title: string;
  systemPrompt: string;
  universal?: boolean;      // existing — preserve
  outputFormat: ForgeOutputFormat;  // NEW
  filename: string;                  // NEW
}
```

- [ ] **Step 5: Add `buildPrompt` helper**

```ts
function buildPrompt(spec: ArtifactSpec): string {
  const formatInstructions: Partial<Record<ForgeOutputFormat, string>> = {
    sql:        'Respond with raw SQL DDL only — no markdown fences, no explanations.',
    csv:        'Respond with raw CSV only — a header row followed by data rows. No markdown fences.',
    yaml:       'Respond with raw YAML only — no markdown fences.',
    dockerfile: 'Respond with a raw Dockerfile only — no markdown fences, no explanations.',
    text:       'Respond with the file contents only — no markdown fences, no explanations.',
  };
  const extra = formatInstructions[spec.outputFormat];
  return extra ? `${spec.systemPrompt}\n\n${extra}` : spec.systemPrompt;
}
```

Export it if tests need it (`export function buildPrompt`), or keep internal if tests use module-level approach.

- [ ] **Step 6: Update `generateArtifact` to pass through new fields**

Find `generateArtifact` and update its return:

```ts
return {
  type: spec.type,
  title: spec.title,
  content,
  generatedAt: new Date().toISOString(),
  universal: spec.universal ?? false,   // preserve
  outputFormat: spec.outputFormat,       // NEW
  filename: spec.filename,               // NEW
};
```

Also update the call site from `runClaude(userPrompt, spec.systemPrompt)` to `runClaude(userPrompt, buildPrompt(spec))`.

- [ ] **Step 7: Run test to verify buildPrompt tests pass**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'buildPrompt|FAIL|PASS'
```

Expected: PASS

---

### Task 4: Update all existing ARTIFACT_CATALOG entries with outputFormat/filename

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Write a failing test**

```ts
describe('ARTIFACT_CATALOG completeness', () => {
  it('every catalog entry has outputFormat and filename', () => {
    for (const [key, entry] of Object.entries(ARTIFACT_CATALOG)) {
      expect(entry.outputFormat, `${key} missing outputFormat`).toBeDefined();
      expect(entry.filename, `${key} missing filename`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'ARTIFACT_CATALOG|FAIL|PASS'
```

Expected: FAIL

- [ ] **Step 3: Update all existing catalog entries**

For every entry in `ARTIFACT_CATALOG`, add `outputFormat` and `filename` per this table:

| type | outputFormat | filename |
|---|---|---|
| `roadmap` | `'markdown'` | `'roadmap.md'` |
| `task_graph` | `'markdown'` | `'task_graph.md'` |
| `repo_blueprint` | `'markdown'` | `'repo_blueprint.md'` |
| `api_contracts` | `'markdown'` | `'api_contracts.md'` |
| `risk_register` | `'markdown'` | `'risk_register.md'` |
| `decision_log` | `'markdown'` | `'decision_log.md'` |
| `executive_summary` | `'markdown'` | `'executive_summary.md'` |
| `competitive_analysis` | `'markdown'` | `'competitive_analysis.md'` |
| `evaluation_matrix` | `'markdown'` | `'evaluation_matrix.md'` |
| `vendor_scorecard` | `'markdown'` | `'vendor_scorecard.md'` |
| `decision_framework` | `'markdown'` | `'decision_framework.md'` |
| `concept_canvas` | `'markdown'` | `'concept_canvas.md'` |
| `mvp_definition` | `'markdown'` | `'mvp_definition.md'` |
| `hypothesis_backlog` | `'markdown'` | `'hypothesis_backlog.md'` |
| `messaging_guide` | `'markdown'` | `'messaging_guide.md'` |
| `presentation_structure` | `'markdown'` | `'presentation_structure.md'` |
| `content_outline` | `'markdown'` | `'content_outline.md'` |
| `sql_schema` | `'sql'` | `'schema.sql'` |
| `environment_template` | `'text'` | `'.env.example'` |
| `slide_deck` | `'markdown'` | `'slide_deck.md'` |
| `spreadsheet_export` | `'csv'` | `'data.csv'` |

(If `sql_schema`, `environment_template`, `slide_deck`, or `spreadsheet_export` are missing from the catalog entirely, add their full entries now — full system prompts are in the spec Section 3.)

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'ARTIFACT_CATALOG|FAIL|PASS'
```

Expected: PASS

---

### Task 5: Add new catalog entries (dockerfile, github_actions, gantt_timeline + missing Sprint 1 types)

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Write failing tests for new catalog entries**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'new artifact catalog|FAIL|PASS'
```

Expected: FAIL

- [ ] **Step 3: Add new catalog entries**

Add to `ARTIFACT_CATALOG`:

```ts
dockerfile: {
  type: 'dockerfile',
  title: 'Dockerfile',
  outputFormat: 'dockerfile',
  filename: 'Dockerfile',
  systemPrompt: `You are a DevOps expert. Generate a production-ready multi-stage Dockerfile based on the competition brief and any code context provided.
Requirements:
- Use an appropriate base image for the language/framework
- Stage 1: build/compile dependencies
- Stage 2: minimal runtime image
- Expose the correct port
- Set a sensible CMD/ENTRYPOINT`,
},

github_actions: {
  type: 'github_actions',
  title: 'CI Pipeline',
  outputFormat: 'yaml',
  filename: '.github/workflows/ci.yml',
  systemPrompt: `You are a DevOps expert. Generate a GitHub Actions CI workflow for the project described in the competition brief.
Requirements:
- Trigger on push and pull_request to main
- Install dependencies
- Run tests
- Run a build step if applicable
- Use appropriate language/runtime versions`,
},

gantt_timeline: {
  type: 'gantt_timeline',
  title: 'Project Timeline',
  outputFormat: 'markdown',
  filename: 'gantt_timeline.md',
  systemPrompt: `You are a project manager. Generate a Mermaid gantt chart as a markdown document showing key milestones and phases for this project.
Requirements:
- Extract real milestones and phases from the brief and competition context
- Include at least 3 sections (phases) with named tasks and durations
- Use realistic date ranges
Format: a markdown document with a single mermaid gantt code block, followed by a brief legend.`,
},
```

Also add `sql_schema`, `environment_template`, `slide_deck`, `spreadsheet_export` if they were missing (full prompts in spec Section 3).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'new artifact catalog|FAIL|PASS'
```

Expected: PASS

---

### Task 6: Update DOMAIN_TYPE_DEFAULTS and DOMAIN_SELECTION_SYSTEM_PROMPT

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'DOMAIN_TYPE_DEFAULTS|FAIL|PASS'
```

Expected: FAIL (new types not yet in defaults)

- [ ] **Step 3: Update `DOMAIN_TYPE_DEFAULTS`**

Replace the existing `DOMAIN_TYPE_DEFAULTS` constant with:

```ts
const DOMAIN_TYPE_DEFAULTS: Record<ForgeDomain, ForgeArtifactType[]> = {
  software:  ['roadmap', 'sql_schema', 'environment_template', 'dockerfile', 'github_actions', 'api_contracts'],
  research:  ['evaluation_matrix', 'spreadsheet_export', 'decision_framework', 'decision_log'],
  creative:  ['slide_deck', 'concept_canvas', 'messaging_guide'],
  business:  ['roadmap', 'gantt_timeline', 'risk_register', 'decision_log'],
  ideation:  ['concept_canvas', 'mvp_definition', 'hypothesis_backlog', 'decision_framework'],
  security:  ['risk_register', 'api_contracts', 'repo_blueprint', 'decision_log'],
};
```

**Do NOT modify `FORMAT_DOMAIN_DEFAULTS`** — that's keyed by brief format (SPRINT/HACKATHON/etc.) and is a different structure.

- [ ] **Step 4: Update `DOMAIN_SELECTION_SYSTEM_PROMPT`**

Update the system prompt so each domain's listed types exactly match `DOMAIN_TYPE_DEFAULTS`. Do **not** list `reference_implementation`, `test_suite_template`, or `project_readme` — these are triggered by the starter kit pass, not selected by the AI domain selector. Remove `business_case`, `go_to_market`, and `stakeholder_map` from the prompt if present.

The updated prompt lists:
- **Software:** roadmap, sql_schema, environment_template, dockerfile, github_actions, api_contracts
- **Research:** evaluation_matrix, spreadsheet_export, decision_framework, decision_log
- **Creative:** slide_deck, concept_canvas, messaging_guide
- **Business:** roadmap, gantt_timeline, risk_register, decision_log
- **Ideation:** concept_canvas, mvp_definition, hypothesis_backlog, decision_framework
- **Security:** risk_register, api_contracts, repo_blueprint, decision_log

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'DOMAIN_TYPE_DEFAULTS|FAIL|PASS'
```

Expected: PASS

- [ ] **Step 6: Run full orchestrator test suite**

```bash
npm run test --workspace=packages/orchestrator
```

Expected: all tests pass

- [ ] **Step 7: Run /simplify on changed files**

```bash
git diff
```

Review diff, run `/simplify`, fix any findings.

- [ ] **Step 8: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts packages/orchestrator/src/forge/forge-orchestrator.test.ts
git commit -m "feat(forge): catalog infrastructure — ArtifactSpec fields, buildPrompt, new types, domain defaults"
```

---

## Chunk 3: ZIP Routing

### Task 7: Create forge-zip-utils.ts

**Files:**
- Create: `packages/web/lib/forge-zip-utils.ts`
- Test: `packages/web/lib/forge-zip-utils.test.ts` (new)

- [ ] **Step 1: Write failing tests for resolveZipPath**

Create `packages/web/lib/forge-zip-utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveZipPath } from './forge-zip-utils';
import type { ForgeArtifact } from '@arena/shared';

function artifact(overrides: Partial<ForgeArtifact>): ForgeArtifact {
  return {
    type: 'roadmap',
    title: 'Test',
    content: '',
    generatedAt: '',
    outputFormat: 'markdown',
    filename: 'roadmap.md',
    ...overrides,
  } as ForgeArtifact;
}

describe('resolveZipPath', () => {
  it('returns README.md for project_readme (type override)', () => {
    expect(resolveZipPath(artifact({ type: 'project_readme', outputFormat: 'markdown', filename: 'README.md' })))
      .toBe('README.md');
  });

  it('returns .github/workflows/ci.yml for github_actions (type override)', () => {
    expect(resolveZipPath(artifact({ type: 'github_actions', outputFormat: 'yaml', filename: '.github/workflows/ci.yml' })))
      .toBe('.github/workflows/ci.yml');
  });

  it('returns infrastructure/.env.example for environment_template (type override)', () => {
    expect(resolveZipPath(artifact({ type: 'environment_template', outputFormat: 'text', filename: '.env.example' })))
      .toBe('infrastructure/.env.example');
  });

  it('returns docs/roadmap.md for markdown fallback', () => {
    expect(resolveZipPath(artifact({ type: 'roadmap', outputFormat: 'markdown', filename: 'roadmap.md' })))
      .toBe('docs/roadmap.md');
  });

  it('returns infrastructure/schema.sql for sql fallback', () => {
    expect(resolveZipPath(artifact({ type: 'sql_schema', outputFormat: 'sql', filename: 'schema.sql' })))
      .toBe('infrastructure/schema.sql');
  });

  it('returns infrastructure/Dockerfile for dockerfile fallback', () => {
    expect(resolveZipPath(artifact({ type: 'dockerfile', outputFormat: 'dockerfile', filename: 'Dockerfile' })))
      .toBe('infrastructure/Dockerfile');
  });

  it('returns data/data.csv for csv fallback', () => {
    expect(resolveZipPath(artifact({ type: 'spreadsheet_export', outputFormat: 'csv', filename: 'data.csv' })))
      .toBe('data/data.csv');
  });

  it('returns null for reference_implementation (multi-file)', () => {
    expect(resolveZipPath(artifact({ type: 'reference_implementation', outputFormat: 'text', filename: 'src/' })))
      .toBeNull();
  });

  it('returns null for test_suite_template (multi-file)', () => {
    expect(resolveZipPath(artifact({ type: 'test_suite_template', outputFormat: 'text', filename: 'tests/' })))
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/web && npx vitest run lib/forge-zip-utils.test.ts 2>&1 | head -30
```

Expected: FAIL — file does not exist

- [ ] **Step 3: Create forge-zip-utils.ts**

Create `packages/web/lib/forge-zip-utils.ts`:

```ts
import type { ForgeArtifact } from '@arena/shared';
import JSZip from 'jszip';

const TYPE_OVERRIDES: Partial<Record<string, string | null>> = {
  project_readme:           'README.md',
  environment_template:     'infrastructure/.env.example',
  github_actions:           '.github/workflows/ci.yml',
  reference_implementation: null,   // multi-file
  test_suite_template:      null,   // multi-file
};

const FORMAT_FOLDERS: Record<string, string> = {
  markdown:   'docs/',
  sql:        'infrastructure/',
  yaml:       'infrastructure/',
  dockerfile: 'infrastructure/',
  csv:        'data/',
  json:       'data/',
  text:       'infrastructure/',
};

/**
 * Returns the full ZIP path for a single-file artifact,
 * or null for multi-file types (reference_implementation, test_suite_template).
 */
export function resolveZipPath(artifact: ForgeArtifact): string | null {
  if (artifact.type in TYPE_OVERRIDES) {
    return TYPE_OVERRIDES[artifact.type] ?? null;
  }
  const folder = FORMAT_FOLDERS[artifact.outputFormat] ?? 'docs/';
  return `${folder}${artifact.filename}`;
}

/**
 * Expands a multi-file artifact (reference_implementation or test_suite_template)
 * by parsing content as a JSON file map and adding each file to the JSZip instance.
 * Files are placed under src/ or tests/ respectively.
 */
export function expandMultiFileArtifact(zip: JSZip, artifact: ForgeArtifact): void {
  const folder = artifact.type === 'reference_implementation' ? 'src/' : 'tests/';
  let fileMap: Record<string, string>;
  try {
    fileMap = JSON.parse(artifact.content) as Record<string, string>;
  } catch {
    // Fallback: treat content as a single file
    zip.file(`${folder}index.txt`, artifact.content);
    return;
  }
  for (const [filename, content] of Object.entries(fileMap)) {
    zip.file(`${folder}${filename}`, content);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/web && npx vitest run lib/forge-zip-utils.test.ts 2>&1 | tail -20
```

Expected: all tests PASS

---

### Task 8: Update both ZIP download routes

**Files:**
- Modify: `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

- [ ] **Step 1: Read both current files**

```bash
cat "packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts"
cat packages/orchestrator/src/server/routes/competitions.ts | grep -n 'forge/download\|archiver\|artifact' | head -40
```

- [ ] **Step 2: Update the JSZip web route**

In `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`:

Replace the flat artifact loop with:

```ts
import { resolveZipPath, expandMultiFileArtifact } from '../../../../../../../../../lib/forge-zip-utils';

// Inside the route handler, replace the artifact loop:
for (const artifact of run.artifacts) {
  if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
    expandMultiFileArtifact(zip, artifact);
  } else {
    const zipPath = resolveZipPath(artifact);
    if (zipPath) {
      zip.file(zipPath, artifact.content);
    }
  }
}

// Update _metadata.json to include forgeModel:
zip.file('_metadata.json', JSON.stringify({
  competitionId: id,
  briefId: competition.brief?.id ?? '',
  briefTitle: competition.brief?.title ?? '',
  forgeSource: run.source,
  forgeModel: run.forgeModel,    // NEW field
  generatedAt: run.generatedAt,
  arena4aiVersion: '2.0',
}, null, 2));
```

- [ ] **Step 3: Fix the archiver route in competitions.ts**

Find `GET /:id/forge/download` in `packages/orchestrator/src/server/routes/competitions.ts`.

Replace the broken `result.forge as unknown as ForgeOutput` cast:

```ts
// Replace:
const forge = result.forge as unknown as ForgeOutput;

// With:
const latestRun = Array.isArray(result.forge) ? result.forge.at(-1) as ForgeRun | undefined : undefined;
if (!latestRun) {
  res.status(404).json({ error: 'No forge run found' });
  return;
}
```

Replace the existing flat archiver loop with one that applies inline folder routing (same tables as `forge-zip-utils.ts`, duplicated here since orchestrator cannot import from web package):

```ts
const TYPE_OVERRIDES_INLINE: Record<string, string | null | undefined> = {
  project_readme:           'README.md',
  environment_template:     'infrastructure/.env.example',
  github_actions:           '.github/workflows/ci.yml',
  reference_implementation: null,
  test_suite_template:      null,
};
const FORMAT_FOLDERS_INLINE: Record<string, string> = {
  markdown: 'docs/', sql: 'infrastructure/', yaml: 'infrastructure/',
  dockerfile: 'infrastructure/', csv: 'data/', json: 'data/', text: 'infrastructure/',
};

for (const artifact of latestRun.artifacts) {
  // Multi-file types: expand from JSON file map
  if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
    const folder = artifact.type === 'reference_implementation' ? 'src/' : 'tests/';
    let fileMap: Record<string, string> = {};
    try { fileMap = JSON.parse(artifact.content) as Record<string, string>; } catch {}
    for (const [filename, content] of Object.entries(fileMap)) {
      archive.append(content, { name: `${folder}${filename}` });
    }
    continue;
  }
  // Type override
  if (artifact.type in TYPE_OVERRIDES_INLINE) {
    const override = TYPE_OVERRIDES_INLINE[artifact.type];
    if (override) archive.append(artifact.content, { name: override });
    continue;
  }
  // Format fallback
  const folder = FORMAT_FOLDERS_INLINE[artifact.outputFormat ?? 'markdown'] ?? 'docs/';
  archive.append(artifact.content, { name: `${folder}${artifact.filename ?? artifact.type + '.md'}` });
}

// Add _metadata.json (with forgeModel)
archive.append(JSON.stringify({
  competitionId: id,
  forgeSource: latestRun.source,
  forgeModel: latestRun.forgeModel,
  generatedAt: latestRun.generatedAt,
  arena4aiVersion: '2.0',
}, null, 2), { name: '_metadata.json' });
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no new errors

- [ ] **Step 5: Run /simplify on changed files**

```bash
git diff
```

Run `/simplify`, fix any findings.

- [ ] **Step 6: Commit**

```bash
git add packages/web/lib/forge-zip-utils.ts packages/web/lib/forge-zip-utils.test.ts \
  "packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts" \
  packages/orchestrator/src/server/routes/competitions.ts
git commit -m "feat(forge): ZIP folder routing via forge-zip-utils, fix archiver cast"
```

---

## Chunk 4: Starter Kit

### Task 9: Extract formatDeliverableFiles helper

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('formatDeliverableFiles', () => {
  it('truncates large files to 6000 bytes', () => {
    const largeContent = 'x'.repeat(10000);
    const deliverables = [{ teamId: 'team-a', files: [{ path: 'main.py', content: largeContent }] }];
    const result = formatDeliverableFiles(deliverables);
    // Content should be truncated — result must contain '--- main.py ---' and some content
    expect(result).toContain('--- main.py ---');
    expect(result.length).toBeLessThan(10000);
  });

  it('respects MAX_TOTAL_BYTES across multiple files', () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.py`,
      content: 'x'.repeat(3000),
    }));
    const deliverables = [{ teamId: 'team-a', files }];
    const result = formatDeliverableFiles(deliverables);
    expect(result.length).toBeLessThanOrEqual(41000); // roughly MAX_TOTAL_BYTES + headers
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'formatDeliverableFiles|FAIL|PASS'
```

Expected: FAIL

- [ ] **Step 3: Extract `formatDeliverableFiles` from `buildForgeUserPrompt`**

In `forge-orchestrator.ts`, find `buildForgeUserPrompt` and extract the file-formatting logic into:

```ts
export const MAX_TOTAL_BYTES = 40_000;

export function formatDeliverableFiles(
  deliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>
): string {
  let total = 0;
  const lines: string[] = [];
  for (const teamDels of deliverables) {
    for (const file of teamDels.files) {
      if (total >= MAX_TOTAL_BYTES) break;
      const truncated = file.content.length > 6000
        ? file.content.slice(0, 6000) + '\n... [truncated]'
        : file.content;
      lines.push(`--- ${file.path} ---\n${truncated}`);
      total += truncated.length;
    }
  }
  return lines.join('\n\n');
}
```

Update `buildForgeUserPrompt` to call `formatDeliverableFiles(...)` instead of the inline logic.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'formatDeliverableFiles|FAIL|PASS'
```

Expected: PASS

---

### Task 10: Implement generateStarterKit and restructure runForge

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`
- Test: `packages/orchestrator/src/forge/forge-orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('generateStarterKit', () => {
  it('is exported and callable', () => {
    expect(typeof generateStarterKit).toBe('function');
  });
});

describe('runForge starter kit integration', () => {
  it('includes starter kit artifacts for code brief with winner source', async () => {
    // This is an integration-style test — mock runClaude
    // If vitest mocking is used in this file, follow the existing pattern
    // Otherwise, test via the exported generateStarterKit function directly
    // with a mock that returns the expected JSON structure
  });
});
```

Note: Check how `runClaude` is currently mocked in existing tests. Follow that pattern. If tests mock at the module level with `vi.mock`, use the same approach.

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -E 'generateStarterKit|starter kit|FAIL|PASS'
```

Expected: FAIL

- [ ] **Step 3: Implement `generateStarterKit`**

Add to `forge-orchestrator.ts`:

```ts
export async function generateStarterKit(
  brief: Brief,
  primaryDeliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>
): Promise<ForgeArtifact[] | null> {
  const starterKitSystemPrompt = `You are generating a production-ready project starter kit from an AI hackathon winner.
Generate three artifacts:
1. A cleaned, well-commented reference implementation in the same language(s) — runnable, not pseudocode
2. A test suite template with meaningful test cases based on actual function/class signatures
3. A project README with setup instructions, usage examples, and extension notes

Respond with a single JSON object:
{
  "src": { "filename": "file contents" },
  "tests": { "filename": "file contents" },
  "readme": "README.md contents"
}`;

  const fileSection = formatDeliverableFiles(primaryDeliverables);
  const starterKitUserPrompt = `BRIEF TITLE: ${brief.title}
BRIEF PROBLEM: ${brief.problem}

WINNING CODE:
${fileSection}`;

  try {
    const raw = await runClaude(starterKitUserPrompt, starterKitSystemPrompt, 120_000);
    const json = JSON.parse(extractJson(raw)) as {
      src: Record<string, string>;
      tests: Record<string, string>;
      readme: string;
    };

    return [
      {
        type: 'reference_implementation',
        title: 'Reference Implementation',
        content: JSON.stringify(json.src),
        outputFormat: 'text',
        filename: 'src/',
        generatedAt: new Date().toISOString(),
      },
      {
        type: 'test_suite_template',
        title: 'Test Suite Template',
        content: JSON.stringify(json.tests),
        outputFormat: 'text',
        filename: 'tests/',
        generatedAt: new Date().toISOString(),
      },
      {
        type: 'project_readme',
        title: 'README',
        content: json.readme,
        outputFormat: 'markdown',
        filename: 'README.md',
        generatedAt: new Date().toISOString(),
      },
    ];
  } catch (err) {
    console.error('[generateStarterKit] failed:', err);
    return null;
  }
}
```

- [ ] **Step 4: Restructure `runForge` to use starter kit**

In `runForge`:

1. Change `const artifacts = await Promise.all(...)` → `let artifacts = await Promise.all(...)`

2. After `Promise.all`, before the return statement, add the starter kit pass:

```ts
const shouldRunStarterKit =
  (input.brief.deliverableType === 'code' || !input.brief.deliverableType) &&
  (input.source === 'winner' || input.source === 'loser') &&
  primaryDeliverables.length > 0 &&
  primaryDeliverables.some(d => d.files.length > 0);

if (shouldRunStarterKit) {
  const kitArtifacts = await generateStarterKit(input.brief, primaryDeliverables);
  if (kitArtifacts) artifacts = [...artifacts, ...kitArtifacts];
}
```

3. Ensure the return object uses the correct shape (as spec Section 4 shows):

```ts
return {
  id: randomUUID(),
  source: input.source,
  sourceTeamId: input.sourceTeamId,
  forgeModel: FORGE_MODEL_LABEL,
  artifacts,
  generatedAt: new Date().toISOString(),
  domain,
  selectedTypes,
};
```

- [ ] **Step 5: Run full test suite**

```bash
npm run test --workspace=packages/orchestrator
```

Expected: all tests pass

- [ ] **Step 6: Run /simplify on changed files**

```bash
git diff
```

Run `/simplify`, fix any findings.

- [ ] **Step 7: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts packages/orchestrator/src/forge/forge-orchestrator.test.ts
git commit -m "feat(forge): starter kit pass — generateStarterKit, formatDeliverableFiles, runForge restructure"
```

---

## Chunk 5: Per-Artifact Download + UI

### Task 11: Per-artifact download route

**Files:**
- Create: `packages/web/app/api/competitions/[id]/forge/[runId]/artifacts/[type]/download/route.ts`

- [ ] **Step 1: Confirm the directory structure exists**

```bash
ls "packages/web/app/api/competitions/[id]/forge/[runId]/"
```

If `artifacts/` directory doesn't exist, create the nested route file.

- [ ] **Step 2: Create the route handler**

Create `packages/web/app/api/competitions/[id]/forge/[runId]/artifacts/[type]/download/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import JSZip from 'jszip';
import type { ForgeArtifact, ForgeOutputFormat } from '@arena/shared';
import { expandMultiFileArtifact } from '../../../../../../../../../../../lib/forge-zip-utils';

const CONTENT_TYPES: Record<ForgeOutputFormat, string> = {
  markdown:   'text/markdown',
  sql:        'text/plain',
  yaml:       'text/yaml',
  dockerfile: 'text/plain',
  csv:        'text/csv',
  json:       'application/json',
  text:       'text/plain',
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string; type: string }> }
) {
  const { id, runId, type: artifactType } = await params;

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
  const forgeRes = await fetch(`${apiBase}/competitions/${id}/forge`);
  if (!forgeRes.ok) {
    return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  }

  const forgeData = await forgeRes.json() as { runs?: Array<{ id: string; artifacts: ForgeArtifact[] }> };
  const run = forgeData.runs?.find(r => r.id === runId);
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 });
  }

  const artifact = run.artifacts.find(a => a.type === artifactType);
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }

  // Multi-file types: return a sub-ZIP
  if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
    const zip = new JSZip();
    expandMultiFileArtifact(zip, artifact);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const zipName = artifact.type === 'reference_implementation' ? 'src-files.zip' : 'test-files.zip';
    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipName}"`,
      },
    });
  }

  // Single-file: return raw content
  const contentType = CONTENT_TYPES[artifact.outputFormat] ?? 'text/plain';
  const basename = path.basename(artifact.filename);
  return new NextResponse(artifact.content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${basename}"`,
    },
  });
}
```

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors

---

### Task 12: Format badge and download button on Forge artifact cards

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Read the current Forge tab section**

Search for the Forge tab rendering code:

```bash
grep -n 'forge\|ForgeRun\|artifact.type\|artifact.title' "packages/web/app/competitions/[id]/page.tsx" | head -40
```

Read the relevant section of `page.tsx` around the Forge tab card grid.

- [ ] **Step 2: Add format badge helper**

Add near the Forge tab rendering (or in the component scope):

```ts
function formatExtension(outputFormat: string): string {
  const ext: Record<string, string> = {
    markdown: '.md', sql: '.sql', csv: '.csv',
    yaml: '.yml', dockerfile: 'file', json: '.json', text: '.txt',
  };
  return ext[outputFormat] ?? '.md';
}
```

- [ ] **Step 3: Add format badge and download button to each artifact card**

In the 3-col artifact card grid, find where each card's content is rendered and add:

1. **Format badge** (top-right corner of card):

```tsx
{artifact.outputFormat && (
  <span style={{
    position: 'absolute',
    top: '0.4rem',
    right: '0.4rem',
    fontSize: '0.5rem',
    fontFamily: MONOSPACE_FONT,
    color: TEXT_MUTED,
    background: 'rgba(0,240,255,0.05)',
    border: `1px solid ${BORDER_MID}`,
    borderRadius: '3px',
    padding: '0.1rem 0.3rem',
  }}>
    {formatExtension(artifact.outputFormat)}
  </span>
)}
```

(Note: the card container needs `position: 'relative'` for this to work — add it if not present.)

2. **Download button** (bottom of card, next to existing content):

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    const url = `/api/competitions/${id}/forge/${run.id}/artifacts/${artifact.type}/download`;
    window.open(url, '_blank');
  }}
  style={{
    fontSize: '0.55rem',
    color: TEXT_MUTED,
    background: 'none',
    border: `1px solid ${BORDER_MID}`,
    borderRadius: '3px',
    padding: '0.2rem 0.5rem',
    cursor: 'pointer',
    fontFamily: MONOSPACE_FONT,
    marginTop: '0.5rem',
  }}
>
  ↓ {formatExtension(artifact.outputFormat)}
</button>
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors

---

### Task 13: Format-aware preview modal

**Files:**
- Modify: `packages/web/app/competitions/[id]/page.tsx`

- [ ] **Step 1: Find the artifact modal rendering**

```bash
grep -n 'selectedArtifact\|modal\|preview\|artifact.*content' "packages/web/app/competitions/[id]/page.tsx" | head -30
```

Read the section that renders the modal content to understand how markdown is currently rendered (look for a React markdown component, or `marked()`, or a raw `<pre>` block).

- [ ] **Step 2: Add a CSV table renderer helper**

Add near the modal section:

```ts
function parseCsvRows(content: string, maxRows = 50): string[][] {
  return content
    .split('\n')
    .filter(Boolean)
    .slice(0, maxRows + 1)
    .map(line => line.split(',').map(cell => cell.trim().replace(/^"|"$/g, '')));
}
```

- [ ] **Step 3: Replace modal content renderer with format-aware version**

In the modal body, wrap the existing content renderer so it branches on `selectedArtifact.outputFormat`:

```tsx
{/* Format-aware modal content */}
{selectedArtifact.outputFormat === 'csv' ? (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', fontSize: '0.65rem', fontFamily: MONOSPACE_FONT }}>
      {parseCsvRows(selectedArtifact.content).map((row, i) => (
        <tr key={i} style={{ borderBottom: '1px solid rgba(0,240,255,0.1)' }}>
          {row.map((cell, j) => (
            i === 0
              ? <th key={j} style={{ padding: '0.3rem 0.6rem', color: '#00f0ff', textAlign: 'left' }}>{cell}</th>
              : <td key={j} style={{ padding: '0.3rem 0.6rem', color: TEXT_MUTED }}>{cell}</td>
          ))}
        </tr>
      ))}
    </table>
  </div>
) : selectedArtifact.type === 'reference_implementation' || selectedArtifact.type === 'test_suite_template' ? (
  <div>
    {(() => {
      let fileMap: Record<string, string> = {};
      try { fileMap = JSON.parse(selectedArtifact.content) as Record<string, string>; } catch {}
      const entries = Object.entries(fileMap);
      const [firstFile, firstContent] = entries[0] ?? ['', selectedArtifact.content];
      return (
        <>
          <p style={{ fontSize: '0.62rem', color: TEXT_MUTED, marginBottom: '0.5rem' }}>
            {entries.length} file{entries.length !== 1 ? 's' : ''} — use Download to get all. Showing: <code>{firstFile}</code>
          </p>
          <pre style={{ overflowX: 'auto', fontSize: '0.65rem', fontFamily: MONOSPACE_FONT }}>
            {firstContent}
          </pre>
        </>
      );
    })()}
  </div>
) : ['sql', 'yaml', 'dockerfile', 'json', 'text'].includes(selectedArtifact.outputFormat) ? (
  <pre style={{ overflowX: 'auto', fontSize: '0.65rem', fontFamily: MONOSPACE_FONT, lineHeight: 1.5 }}>
    {selectedArtifact.content}
  </pre>
) : (
  /* markdown: reuse existing renderer — find how content is currently displayed and keep it unchanged */
  <ExistingMarkdownRenderer content={selectedArtifact.content} />
)}
```

Replace `<ExistingMarkdownRenderer content={selectedArtifact.content} />` with the actual existing markdown rendering code — do not change it, just move it into the final else branch.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```

Expected: no errors

- [ ] **Step 5: Run full test suite**

```bash
npm run test --workspace=packages/orchestrator
cd packages/web && npx vitest run lib/forge-zip-utils.test.ts
```

Expected: all tests pass

- [ ] **Step 6: Run /simplify on all changed files in this chunk**

```bash
git diff
```

Run `/simplify`, fix any findings.

- [ ] **Step 7: Commit**

```bash
git add \
  "packages/web/app/api/competitions/[id]/forge/[runId]/artifacts/[type]/download/route.ts" \
  "packages/web/app/competitions/[id]/page.tsx"
git commit -m "feat(forge): per-artifact download route, format badge, format-aware preview modal"
```

---

## Final verification

- [ ] **Run complete test suite**

```bash
npm run test --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
npm run typecheck --workspace=packages/orchestrator
```

Expected: all 159+ tests pass, zero type errors

- [ ] **Acceptance criteria checklist**

- [ ] `ForgeArtifact` type has `outputFormat` and `filename`; `generatedAt` and `universal` preserved; existing records normalize gracefully
- [ ] ZIP for a software competition contains `docs/`, `infrastructure/`, `.github/workflows/`, `src/`, `tests/`, `README.md`, `_metadata.json` (with `forgeModel`)
- [ ] Each artifact's content is clean (no markdown fences wrapping SQL/CSV/YAML)
- [ ] `dockerfile` and `github_actions` artifact types generate for software domain
- [ ] `gantt_timeline` generates for business domain
- [ ] `DOMAIN_TYPE_DEFAULTS` updated; `FORMAT_DOMAIN_DEFAULTS` unchanged
- [ ] `DOMAIN_SELECTION_SYSTEM_PROMPT` lists new domain types; `business_case`/`go_to_market`/`stakeholder_map` removed from prompt
- [ ] Starter kit pass triggers for `deliverableType === 'code'` + winner/loser source with non-empty deliverables
- [ ] Starter kit pass skips gracefully when conditions not met
- [ ] Multi-file artifacts expand into correct `src/` and `tests/` folders in both ZIP routes
- [ ] Per-artifact download returns correct Content-Type and filename for each format
- [ ] Per-artifact download for multi-file types returns a sub-ZIP
- [ ] Modal renders CSV as table, SQL/YAML/code as `<pre>`, markdown as rendered, multi-file as first-file preview
- [ ] "Download All" ZIP still works
- [ ] All existing tests still passing
