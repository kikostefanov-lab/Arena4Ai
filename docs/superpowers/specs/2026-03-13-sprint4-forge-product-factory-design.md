# Sprint 4 — Forge as Product Factory: Design Spec

**Date:** 2026-03-13
**Sprint:** 4 of 4
**Depends on:** Sprint 1 (forge catalog additions), Sprint 2 (deliverableType + domainHint signals)

---

## Goal

Transform Forge output from a set of markdown planning documents into a structured, immediately usable launchpad — "Thor's hammer." The user picks the source (winner/loser/synthesis), Forge produces a ZIP they can drop into a repo, hand to a dev team, or present to stakeholders, and start building from.

---

## Architecture

Option A (Incremental Layers) was selected:

1. **Layer 1 — Format Routing Infrastructure:** Artifacts declare their `outputFormat` and `filename`; ZIP organizes by folder; download headers use correct extensions.
2. **Layer 2 — New Artifact Content Types:** Domain-specific file types per `domainHint` (`.sql`, `.env.example`, Dockerfile, CI YAML, `.csv`, slide deck, Gantt).
3. **Layer 3 — Code Consumption / Starter Kit:** For code competitions, Forge reads winning deliverables and produces cleaned reference implementation + test scaffold + README.
4. **Layer 4 — Per-Artifact Download UI:** Individual download buttons and format-aware preview modal per artifact.

---

## Section 1: Core Data Model

### `ArtifactSpec` updated (internal to forge-orchestrator.ts)

Add `outputFormat` and `filename` to the private `ArtifactSpec` interface:

```ts
interface ArtifactSpec {
  type: ForgeArtifactType;
  title: string;
  systemPrompt: string;
  universal?: boolean;    // existing — preserve
  outputFormat: ForgeOutputFormat;  // NEW
  filename: string;                  // NEW
}
```

### `ForgeOutputFormat` type (new — packages/shared/src/types/forge.ts)

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

### `ForgeArtifact` updated (packages/shared/src/types/forge.ts)

Add two fields to the **existing** interface — do not remove `generatedAt` or `universal`:

```ts
export interface ForgeArtifact {
  type: ForgeArtifactType;
  title: string;
  content: string;
  generatedAt: string;              // existing — preserve
  universal?: boolean;              // existing — preserve
  outputFormat: ForgeOutputFormat;  // NEW
  filename: string;                  // NEW
}
```

**Backward compatibility:** Existing persisted `ForgeArtifact` records lack `outputFormat` and `filename`. Normalize in `repository.ts` on read:
```ts
artifact.outputFormat ??= 'markdown';
artifact.filename ??= `${artifact.type}.md`;
```

### ZIP folder routing

ZIP placement is determined by **artifact type first** (for known special cases), then **`{folder}/{artifact.filename}`** as fallback. This logic lives in `packages/web/lib/forge-zip-utils.ts` and is duplicated inline in the orchestrator archiver route (which cannot import from `packages/web`).

`resolveZipPath(artifact: ForgeArtifact): string` algorithm:
1. Look up `artifact.type` in the type-override table — if found, return the full ZIP path directly.
2. Otherwise: determine folder from `outputFormat` fallback table, return `{folder}/{artifact.filename}`.

`artifact.filename` is **never** used directly as the ZIP path — it is always combined with a folder (or overridden by the type table). This makes `github_actions` consistent: its type-override returns `.github/workflows/ci.yml` (ZIP root), not `infrastructure/.github/workflows/ci.yml`.

**Type-based overrides (full ZIP path — checked first):**

| artifact type | Full ZIP path |
|---|---|
| `project_readme` | `README.md` |
| `reference_implementation` | *(multi-file — expanded by `expandMultiFileArtifact`, not a single path)* |
| `test_suite_template` | *(multi-file — expanded by `expandMultiFileArtifact`, not a single path)* |
| `environment_template` | `infrastructure/.env.example` |
| `github_actions` | `.github/workflows/ci.yml` |

**Format-based folder fallback (for all other artifacts):**

| outputFormat | ZIP folder |
|---|---|
| `markdown` | `docs/` |
| `sql` | `infrastructure/` |
| `yaml` | `infrastructure/` |
| `dockerfile` | `infrastructure/` |
| `csv` | `data/` |
| `json` | `data/` |
| `text` | `infrastructure/` |

Note: `dockerfile` artifact has `outputFormat: 'dockerfile'` and `filename: 'Dockerfile'`. No type override is defined for it, so it falls through to the format fallback, producing ZIP path `infrastructure/Dockerfile`. This is the intended path.

**ZIP root always contains `_metadata.json`.** This adds `forgeModel` as a new field (previously absent from the web route's `_metadata.json`):
```json
{
  "competitionId": "...",
  "briefId": "...",
  "briefTitle": "...",
  "forgeSource": "winner",
  "forgeModel": "claude-sonnet-4-6",
  "generatedAt": "...",
  "arena4aiVersion": "2.0"
}
```
Note: key name `forgeSource` (not `source`) is preserved from the existing route to avoid breaking any consumers.

---

## Section 2: Layer 1 — Format Routing Infrastructure

### Artifact catalog

Every entry in `ARTIFACT_CATALOG` gains `outputFormat` and `filename`. Existing types (all get `markdown` / `{type}.md`):

| type | outputFormat | filename |
|---|---|---|
| `roadmap` | markdown | `roadmap.md` |
| `task_graph` | markdown | `task_graph.md` |
| `repo_blueprint` | markdown | `repo_blueprint.md` |
| `api_contracts` | markdown | `api_contracts.md` |
| `risk_register` | markdown | `risk_register.md` |
| `decision_log` | markdown | `decision_log.md` |
| `executive_summary` | markdown | `executive_summary.md` |
| `competitive_analysis` | markdown | `competitive_analysis.md` |
| `evaluation_matrix` | markdown | `evaluation_matrix.md` |
| `vendor_scorecard` | markdown | `vendor_scorecard.md` |
| `decision_framework` | markdown | `decision_framework.md` |
| `concept_canvas` | markdown | `concept_canvas.md` |
| `mvp_definition` | markdown | `mvp_definition.md` |
| `hypothesis_backlog` | markdown | `hypothesis_backlog.md` |
| `messaging_guide` | markdown | `messaging_guide.md` |
| `presentation_structure` | markdown | `presentation_structure.md` |
| `content_outline` | markdown | `content_outline.md` |
| `sql_schema` | sql | `schema.sql` |
| `environment_template` | text | `.env.example` |
| `slide_deck` | markdown | `slide_deck.md` |
| `spreadsheet_export` | csv | `data.csv` |

If `sql_schema`, `environment_template`, `slide_deck`, or `spreadsheet_export` are absent from `ARTIFACT_CATALOG`, add them now (full specs in Section 3).

### `generateArtifact` update

Pass `outputFormat` and `filename` from the spec through to the returned `ForgeArtifact`. **Include `universal` field** (do not regress it):

```ts
return {
  type: spec.type,
  title: spec.title,
  content,
  generatedAt: new Date().toISOString(),
  universal: spec.universal ?? false,  // preserve
  outputFormat: spec.outputFormat,      // NEW
  filename: spec.filename,               // NEW
};
```

### `buildPrompt` helper

Add a helper that returns a modified **system prompt** string with a format instruction appended. The call site becomes `runClaude(userPrompt, buildPrompt(spec))`:

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

Update `generateArtifact` to use it:
```ts
const content = await runClaude(userPrompt, buildPrompt(spec));
```

### ZIP builder changes — two locations

**1. `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts`** (uses JSZip):
Replace the flat-file loop with `resolveZipPath` from `forge-zip-utils.ts`:
```ts
import { resolveZipPath, expandMultiFileArtifact } from '../../../../../../../../../lib/forge-zip-utils';

for (const artifact of run.artifacts) {
  if (artifact.type === 'reference_implementation' || artifact.type === 'test_suite_template') {
    expandMultiFileArtifact(zip, artifact);  // adds src/ or tests/ files
  } else {
    zip.file(resolveZipPath(artifact), artifact.content);
  }
}
zip.file('_metadata.json', JSON.stringify({ ...metadata, forgeModel: run.forgeModel }, null, 2));
```

**2. `packages/orchestrator/src/server/routes/competitions.ts`** (uses `archiver`, `GET /:id/forge/download`):
This endpoint ZIPs **only the most recent ForgeRun** (current behavior). The current code incorrectly casts `result.forge as unknown as ForgeOutput` — **replace this cast** with:
```ts
const latestRun = result.forge.at(-1) as ForgeRun | undefined;
if (!latestRun) {
  res.status(404).json({ error: 'No forge run found' });
  return;
}
```
Then update the archiver loop to iterate `latestRun.artifacts`, applying the inline folder-routing logic (same type-override and format-fallback tables from Section 1 — no import from web). The inline type-override table must include all entries from Section 1, including `project_readme → README.md` (ZIP root) — not just the two multi-file types. Multi-file artifacts (`reference_implementation`, `test_suite_template`) are expanded inline by parsing `content` as a JSON file map. Add `_metadata.json` entry (including `forgeModel: latestRun.forgeModel` as a new field).

**Implementation order note:** The catalog entries (Section 3) must be added before or in the same commit as the `DOMAIN_SELECTION_SYSTEM_PROMPT` update. The AI domain selector validates returned types against `Object.keys(ARTIFACT_CATALOG)` — listing a type in the prompt that isn't in the catalog causes it to be silently dropped.

### `DOMAIN_SELECTION_SYSTEM_PROMPT` update

The `DOMAIN_SELECTION_SYSTEM_PROMPT` in `forge-orchestrator.ts` lists available artifact types per domain for the AI domain selector. Update it so **each domain's listed types exactly match `DOMAIN_TYPE_DEFAULTS`** (keeping them permanently in sync):

- **Software:** `roadmap`, `sql_schema`, `environment_template`, `dockerfile`, `github_actions`, `api_contracts`
- **Research:** `evaluation_matrix`, `spreadsheet_export`, `decision_framework`, `decision_log`
- **Creative:** `slide_deck`, `concept_canvas`, `messaging_guide`
- **Business:** `roadmap`, `gantt_timeline`, `risk_register`, `decision_log`
- **Ideation:** `concept_canvas`, `mvp_definition`, `hypothesis_backlog`, `decision_framework`
- **Security:** `risk_register`, `api_contracts`, `repo_blueprint`, `decision_log`

**Do NOT list** `reference_implementation`, `test_suite_template`, or `project_readme` — these are triggered automatically by the starter kit pass and are not selectable by the AI domain selector.

**Explicitly remove** the current business domain types from the selector prompt: `business_case`, `go_to_market`, and `stakeholder_map` are removed from `DOMAIN_SELECTION_SYSTEM_PROMPT` and from `DOMAIN_TYPE_DEFAULTS`. They remain in `ARTIFACT_CATALOG` (so they can still be individually selected via `selectedTypes` if explicitly passed), but are no longer auto-selected for any domain.

---

## Section 3: Layer 2 — New Artifact Content Types

### New `ForgeArtifactType` values (packages/shared/src/types/forge.ts)

Extend the union with:
```ts
| 'dockerfile'
| 'github_actions'
| 'gantt_timeline'
| 'reference_implementation'
| 'test_suite_template'
| 'project_readme'
```

(`sql_schema`, `environment_template`, `slide_deck`, `spreadsheet_export` are confirmed present in the union — no change needed there.)

### New catalog entries with system prompts

**`dockerfile`**
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
```

**`github_actions`**
```ts
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
```

**`gantt_timeline`**
```ts
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

**`sql_schema`** (add to catalog if missing):
```ts
sql_schema: {
  type: 'sql_schema',
  title: 'Database Schema',
  outputFormat: 'sql',
  filename: 'schema.sql',
  systemPrompt: `You are a database architect. Generate a complete SQL DDL schema for the project described in the brief.
Requirements:
- Define all core tables with appropriate column types
- Include primary keys, foreign keys, and indexes
- Add comments on each table explaining its purpose
- Use PostgreSQL syntax`,
},
```

**`environment_template`** (add to catalog if missing):
```ts
environment_template: {
  type: 'environment_template',
  title: 'Environment Template',
  outputFormat: 'text',
  filename: '.env.example',
  systemPrompt: `You are a backend engineer. Generate a .env.example file for the project described in the brief.
Requirements:
- List all environment variables the project would need
- Provide placeholder values (not real secrets)
- Add a comment above each variable explaining what it is
- Group related variables with section comments`,
},
```

**`slide_deck`** (add to catalog if missing):
```ts
slide_deck: {
  type: 'slide_deck',
  title: 'Slide Deck',
  outputFormat: 'markdown',
  filename: 'slide_deck.md',
  systemPrompt: `You are a presentation expert. Generate a complete slide deck with actual copy for the project described in the brief.
Requirements:
- 8–12 slides
- Each slide: ## Slide N: Title, then actual bullet points or paragraph copy (not just topic labels)
- Include: problem, solution, key features, market, roadmap, call to action
Format as a markdown document with ## headings per slide.`,
},
```

**`spreadsheet_export`** (add to catalog if missing):
```ts
spreadsheet_export: {
  type: 'spreadsheet_export',
  title: 'Comparison Matrix',
  outputFormat: 'csv',
  filename: 'data.csv',
  systemPrompt: `You are a research analyst. Generate a CSV comparison matrix based on the competition brief.
Requirements:
- First column: item/option/competitor names
- Subsequent columns: evaluation criteria relevant to the brief
- Populate cells with real data or reasoned estimates (not blanks)
- Include a header row`,
},
```

### `DOMAIN_TYPE_DEFAULTS` update

Update `DOMAIN_TYPE_DEFAULTS` (domain-keyed — used when `brief.domainHint` is set). **Do not modify `FORMAT_DOMAIN_DEFAULTS`** (brief-format-keyed — used as AI fallback; keyed by `SPRINT`/`HACKATHON`/etc.):

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

---

## Section 4: Layer 3 — Code Consumption / Starter Kit

### Trigger condition

After the main `Promise.all` artifact generation completes inside `runForge`, check using already-computed locals:
1. `brief.deliverableType === 'code'` (or absent — `'code'` is the default), AND
2. `input.source === 'winner' || input.source === 'loser'` (not `'synthesis'`), AND
3. `primaryDeliverables` (already computed at top of `runForge` from `input.deliverables.filter(d => d.teamId === input.sourceTeamId)`) is non-empty

No new field on `ForgeInput` is needed — `primaryDeliverables` is already a local variable at the right scope in `runForge`. If all three conditions hold, run the **starter kit pass**. On any failure, log the error and return the ForgeRun with standard artifacts only — do not throw.

### Starter kit Claude call

Single Claude call — **does NOT use `buildPrompt`** (the system prompt already instructs JSON output; applying `buildPrompt` would append a conflicting format instruction):

```ts
const raw = await runClaude(starterKitUserPrompt, starterKitSystemPrompt, 120_000);
```

- **`starterKitSystemPrompt`** (role/instruction):
```
You are generating a production-ready project starter kit from an AI hackathon winner.
Generate three artifacts:
1. A cleaned, well-commented reference implementation in the same language(s) — runnable, not pseudocode
2. A test suite template with meaningful test cases based on actual function/class signatures
3. A project README with setup instructions, usage examples, and extension notes

Respond with a single JSON object:
{
  "src": { "filename": "file contents" },
  "tests": { "filename": "file contents" },
  "readme": "README.md contents"
}
```

- **`starterKitUserPrompt`** (deliverable content, built in `runForge`):
```
BRIEF TITLE: {brief.title}
BRIEF PROBLEM: {brief.problem}

WINNING CODE:
{iterate ALL elements of primaryDeliverables — for each teamDels in primaryDeliverables, for each file in teamDels.files}
--- {path} ---
{content}
```

**Code context cap:** use the same `MAX_TOTAL_BYTES = 40_000` constant and per-file `6000`-byte truncation logic already used in `buildForgeUserPrompt`. Extract this logic into a shared helper `formatDeliverableFiles(deliverables: Array<...>): string` called by both `buildForgeUserPrompt` and the starter kit prompt builder.

### Parsing and artifact construction

```ts
const raw = await runClaude(starterKitUserPrompt, starterKitSystemPrompt, 120_000);
const json = JSON.parse(extractJson(raw)) as {
  src: Record<string, string>;
  tests: Record<string, string>;
  readme: string;
};

const starterKitArtifacts: ForgeArtifact[] = [
  {
    type: 'reference_implementation',
    title: 'Reference Implementation',
    content: JSON.stringify(json.src),   // serialized file map
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
// Append before constructing the ForgeRun return value.
// NOTE: `runForge` currently declares `const artifacts = await Promise.all(...)`.
// Change this declaration to `let artifacts = await Promise.all(...)` and restructure
// the try block so the starter kit pass runs BEFORE the return statement:
artifacts = [...artifacts, ...starterKitArtifacts];
```

**`runForge` restructuring required:**

Extract the starter kit logic into a named internal async function `generateStarterKit` with this signature:
```ts
async function generateStarterKit(
  brief: Brief,
  primaryDeliverables: Array<{ teamId: string; files: { path: string; content: string }[] }>
): Promise<ForgeArtifact[] | null>
```
Returns the three starter kit `ForgeArtifact` objects on success, or `null` on any error (catch all errors, log them, return null).

Then restructure `runForge` to call it:
```ts
// Before:
const artifacts = await Promise.all(allSpecs.map(generateArtifact));
return { id: randomUUID(), ...artifacts, ... };

// After (inside the same try block):
let artifacts = await Promise.all(allSpecs.map(generateArtifact));

const shouldRunStarterKit =
  (input.brief.deliverableType === 'code' || !input.brief.deliverableType) &&
  (input.source === 'winner' || input.source === 'loser') &&
  primaryDeliverables.length > 0 &&
  primaryDeliverables.some(d => d.files.length > 0);

if (shouldRunStarterKit) {
  const kitArtifacts = await generateStarterKit(input.brief, primaryDeliverables);
  if (kitArtifacts) artifacts = [...artifacts, ...kitArtifacts];
}

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

### `forge-zip-utils.ts` — shared utility

New file: `packages/web/lib/forge-zip-utils.ts`

Exports:
- `resolveZipPath(artifact: ForgeArtifact): string` — type-override then format-fallback table
- `expandMultiFileArtifact(zip: JSZip, artifact: ForgeArtifact): void` — parses `content` as JSON file map and adds entries to the JSZip instance

This file is imported by the full-ZIP route and the new per-artifact download route. The orchestrator `competitions.ts` (archiver-based) duplicates the routing logic inline since it cannot import from `packages/web`.

### Modal preview for multi-file artifacts

`reference_implementation` and `test_suite_template`: parse `content` as JSON, show **first file** in a syntax-highlighted monospace block, with a note: *"N files — use Download to get all."*

`project_readme`: render as standard markdown.

### Per-artifact download for multi-file types

The per-artifact download route for `reference_implementation` and `test_suite_template` returns a **sub-ZIP** containing only that artifact's files. Uses `expandMultiFileArtifact` from `forge-zip-utils.ts`. Content-Type: `application/zip`, filename: `src-files.zip` or `test-files.zip`.

---

## Section 5: Layer 4 — Per-Artifact Download UI

### Artifact card changes

Each card in the 3-col Forge tab grid gains:
- **Format badge** (top-right): file extension pill (`.sql`, `.md`, `.csv`, etc.) — use `TEXT_MUTED`/`BORDER_MID` tokens from `design-tokens.ts`
- **Download button** (bottom of card): `↓ .sql` label — calls new per-artifact route

### New API route (Next.js web)

`GET /api/competitions/[id]/forge/[runId]/artifacts/[type]/download`

**Route handler signature** — `type` is a TypeScript reserved word; alias it:
```ts
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string; type: string }> }
) {
  const { id, runId, type: artifactType } = await params;
  // use artifactType throughout
}
```

Use the same `NEXT_PUBLIC_API_URL ?? 'http://localhost:3000'` pattern as all other web proxy routes:
```ts
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';
const forgeRes = await fetch(`${apiBase}/competitions/${id}/forge`);
```

Find run by `runId`, find artifact by `type`, then:

| outputFormat | Content-Type |
|---|---|
| `markdown` | `text/markdown` |
| `sql` | `text/plain` |
| `yaml` | `text/yaml` |
| `dockerfile` | `text/plain` |
| `csv` | `text/csv` |
| `json` | `application/json` |
| `text` | `text/plain` |

`Content-Disposition: attachment; filename="{basename}"`

where `basename = path.basename(artifact.filename)` — **always use `path.basename`**, not the raw `filename` field. This ensures `github_actions` (whose `filename` is `.github/workflows/ci.yml`) produces `Content-Disposition: attachment; filename="ci.yml"` rather than embedding illegal path separators in the header.

For `reference_implementation` / `test_suite_template`: return sub-ZIP using `expandMultiFileArtifact` from `forge-zip-utils.ts`.

### Format-aware preview modal

Extend the artifact modal in `packages/web/app/competitions/[id]/page.tsx`:

| outputFormat | Rendered as |
|---|---|
| `markdown` | Rendered markdown (no change) |
| `sql` / `yaml` / `dockerfile` / `json` / `text` | Scrollable `<pre>` monospace code block |
| `csv` | Parse CSV rows, render as simple HTML `<table>` (first 50 rows) |
| `reference_implementation` / `test_suite_template` | First file in monospace block + *"N files — use Download to get all"* |

### "Download All" ZIP

Preserved as-is. Per-artifact is additive.

---

## Files to Create / Modify

### Shared types
- `packages/shared/src/types/forge.ts` — add `ForgeOutputFormat`, add `outputFormat`/`filename` to `ForgeArtifact`, extend `ForgeArtifactType` union

### Orchestrator
- `packages/orchestrator/src/forge/forge-orchestrator.ts` — `ArtifactSpec` gains `outputFormat`/`filename`; all catalog entries updated; `generateArtifact` passes fields through (preserve `universal`); `buildPrompt` helper; new catalog entries with system prompts; starter kit pass after main `Promise.all`; `DOMAIN_TYPE_DEFAULTS` update; `DOMAIN_SELECTION_SYSTEM_PROMPT` updated to list new domain types
- `packages/orchestrator/src/repository.ts` — backward-compat normalization (`outputFormat ??= 'markdown'`, `filename ??= '{type}.md'`)
- `packages/orchestrator/src/server/routes/competitions.ts` — `GET /:id/forge/download` (archiver) updated with inline folder-routing logic and `_metadata.json` addition of `forgeModel`

### Web
- `packages/web/lib/forge-zip-utils.ts` — **new** — `resolveZipPath` + `expandMultiFileArtifact` shared utilities
- `packages/web/app/api/competitions/[id]/forge/[runId]/download/route.ts` — **existing, modify** — use `resolveZipPath`/`expandMultiFileArtifact` from `forge-zip-utils.ts`; add `forgeModel` to `_metadata.json`
- `packages/web/app/api/competitions/[id]/forge/[runId]/artifacts/[type]/download/route.ts` — **new** — per-artifact download with correct Content-Type/Content-Disposition; sub-ZIP for multi-file types
- `packages/web/app/competitions/[id]/page.tsx` — Forge tab: format badge + download button per card; format-aware preview in modal

---

## Acceptance Criteria

- [ ] `ForgeArtifact` type has `outputFormat` and `filename`; `generatedAt` and `universal` preserved; existing records normalize gracefully
- [ ] ZIP for a software competition contains `docs/`, `infrastructure/`, `.github/workflows/`, `src/`, `tests/`, `README.md`, `_metadata.json` (with `forgeModel`)
- [ ] Each artifact's content is clean (no markdown fences wrapping SQL/CSV/YAML)
- [ ] `dockerfile` and `github_actions` artifact types generate for software domain
- [ ] `gantt_timeline` generates for business domain
- [ ] `DOMAIN_TYPE_DEFAULTS` updated; `FORMAT_DOMAIN_DEFAULTS` unchanged
- [ ] `DOMAIN_SELECTION_SYSTEM_PROMPT` lists new domain types
- [ ] Starter kit pass triggers for `deliverableType === 'code'` + winner/loser source with non-empty deliverables
- [ ] Starter kit pass skips gracefully (no error surfaced) when conditions not met
- [ ] Multi-file artifacts expand into correct `src/` and `tests/` folders in both ZIP routes
- [ ] Per-artifact download returns correct Content-Type and filename for each format
- [ ] Per-artifact download for multi-file types returns a sub-ZIP
- [ ] Modal renders CSV as table, SQL/YAML/code as syntax block, markdown as rendered, multi-file as first-file preview
- [ ] "Download All" ZIP still works
- [ ] All existing tests still passing; new catalog entries, ZIP routing, and starter kit pass have unit tests
