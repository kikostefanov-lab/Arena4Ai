# Sprint 2 — Brief Intelligence Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `deliverableType` and `domainHint` fields to the Brief schema so agents get format-specific instructions, Forge gets a reliable domain signal, and the competition creation UI exposes both fields.

**Architecture:** Two new optional fields are added to the shared `Brief` schema and type. The adapter's `injectBrief()` uses `deliverableType` to inject a `[DELIVERABLE FORMAT]` guidance block into every agent prompt. `selectDomainArtifacts()` short-circuits on `domainHint` (no AI call) or seeds the AI selection prompt when `deliverableType` is non-mixed. The brief creation UI adds icon-pill selection in Step 2 and an advanced collapsed section for `domainHint`.

**Tech Stack:** TypeScript, Zod (schema validation), Vitest (tests), React + Next.js 15 (UI), `html { font-size: 120% }` baseline (1rem = 19.2px)

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/shared/src/schemas/brief.schema.ts` | Modify | Add `deliverableType` enum + default; add `domainHint` optional enum |
| `packages/shared/src/types/competition.ts` | Modify | Add optional fields to `Brief` interface |
| `packages/orchestrator/src/adapters/base-adapter.ts` | Modify | Inject `[DELIVERABLE FORMAT]` section in `injectBrief()` |
| `packages/orchestrator/src/adapters/base-adapter.test.ts` | Create | Test prompt injection for each deliverable type |
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | Modify | Wire `domainHint` + `deliverableType` into `selectDomainArtifacts()` |
| `packages/orchestrator/src/forge/forge-orchestrator.test.ts` | Modify | Add domain selection tests for new signal paths |
| `packages/web/app/competitions/new/page.tsx` | Modify | Add deliverable type picker UI and domainHint advanced field |

---

## Chunk 1: Schema, Types, and Prompt Injection

---

### Task 1: Add `deliverableType` and `domainHint` to Brief schema and type

**Files:**
- Modify: `packages/shared/src/schemas/brief.schema.ts` (line 28, after `tags`)
- Modify: `packages/shared/src/types/competition.ts` (line 34, after `tags?`)
- Modify: `packages/orchestrator/src/brief/parser.test.ts` (add new test cases)

**Context:** The Zod schema is the single validation point for all Brief objects (YAML files, API bodies). Adding `.default('code')` on `deliverableType` makes existing briefs parse as `code` automatically — no migration needed. The parser calls `briefSchema.parse()` so no parser changes are needed.

- [ ] **Step 1: Read the current schema and type files**

  ```bash
  # Verify exact current state before editing
  cat packages/shared/src/schemas/brief.schema.ts
  cat packages/shared/src/types/competition.ts
  ```

- [ ] **Step 2: Write the failing parser tests**

  In `packages/orchestrator/src/brief/parser.test.ts`, add a new `describe` block:

  ```ts
  describe('deliverableType and domainHint', () => {
    const baseValid = {
      id: 'test-1',
      title: 'Test Brief',
      problem: 'Test problem',
      constraints: [],
      deliverables: ['output.md'],
      rubric: { criteria: [{ id: 'quality', weight: 1.0, maxScore: 10, description: 'Quality' }] },
      format: 'SPRINT',
      timeLimitMs: 300_000,
    };

    it('defaults deliverableType to "code" when omitted', () => {
      const result = parseBrief(yaml.dump(baseValid));
      expect(result.deliverableType).toBe('code');
    });

    it('accepts valid deliverableType values', () => {
      const types = ['code', 'document', 'analysis', 'presentation', 'plan', 'mixed'] as const;
      for (const t of types) {
        const result = parseBrief(yaml.dump({ ...baseValid, deliverableType: t }));
        expect(result.deliverableType).toBe(t);
      }
    });

    it('rejects invalid deliverableType', () => {
      expect(() => parseBrief(yaml.dump({ ...baseValid, deliverableType: 'video' }))).toThrow();
    });

    it('accepts valid domainHint values', () => {
      const domains = ['software', 'research', 'creative', 'security', 'business', 'ideation'] as const;
      for (const d of domains) {
        const result = parseBrief(yaml.dump({ ...baseValid, domainHint: d }));
        expect(result.domainHint).toBe(d);
      }
    });

    it('domainHint is omitted when not in YAML', () => {
      const result = parseBrief(yaml.dump(baseValid));
      expect(result.domainHint).toBeUndefined();
    });

    it('rejects invalid domainHint', () => {
      expect(() => parseBrief(yaml.dump({ ...baseValid, domainHint: 'finance' }))).toThrow();
    });
  });
  ```

- [ ] **Step 3: Run the tests to confirm they fail**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "deliverableType"
  ```

  Expected: FAIL — `deliverableType` not in schema yet, test errors on parse.

- [ ] **Step 4: Add fields to the Zod schema**

  In `packages/shared/src/schemas/brief.schema.ts`, after the `tags` line (currently line 28), add:

  ```ts
  deliverableType: z.enum(['code', 'document', 'analysis', 'presentation', 'plan', 'mixed']).default('code'),
  domainHint: z.enum(['software', 'research', 'creative', 'security', 'business', 'ideation']).optional(),
  ```

  The full `briefSchema` object should now end with:
  ```ts
    tags: z.array(z.string()).optional(),
    deliverableType: z.enum(['code', 'document', 'analysis', 'presentation', 'plan', 'mixed']).default('code'),
    domainHint: z.enum(['software', 'research', 'creative', 'security', 'business', 'ideation']).optional(),
  });
  ```

- [ ] **Step 5: Add fields to the Brief interface**

  In `packages/shared/src/types/competition.ts`, after `tags?: string[];` (currently line 34), add:

  ```ts
  /** Controls agent prompt guidance and Forge domain selection. Defaults to 'code'. */
  deliverableType?: 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  /** Explicit Forge domain override. Skips AI domain selection entirely when set. */
  domainHint?: 'software' | 'research' | 'creative' | 'security' | 'business' | 'ideation';
  ```

- [ ] **Step 6: Rebuild the shared package**

  ```bash
  npm run build --workspace=packages/shared
  ```

  Expected: No errors, `dist/` updated.

- [ ] **Step 7: Run the parser tests**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "deliverableType\|domainHint\|PASS\|FAIL"
  ```

  Expected: All 6 new tests PASS. Existing tests unaffected (178 → 184 total).

- [ ] **Step 8: Run orchestrator typecheck**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1
  ```

  Expected: No output (clean).

- [ ] **Step 9: Commit**

  ```bash
  git add packages/shared/src/schemas/brief.schema.ts \
          packages/shared/src/types/competition.ts \
          packages/shared/dist/ \
          packages/orchestrator/src/brief/parser.test.ts
  git commit -m "feat(schema): add deliverableType and domainHint to Brief schema and type"
  ```

---

### Task 2: Inject `[DELIVERABLE FORMAT]` guidance into agent prompt

**Files:**
- Modify: `packages/orchestrator/src/adapters/base-adapter.ts` (the `injectBrief()` method, ~lines 72–107)
- Create: `packages/orchestrator/src/adapters/base-adapter.test.ts`

**Context:** `injectBrief()` builds `this.promptText` as a `\n\n`-joined array of sections. The new `[DELIVERABLE FORMAT]` section should be injected immediately after `[BRIEF: ${brief.title}]` and the problem text, before `[DELIVERABLES]`. All 6 deliverable types need a guide string; `deliverableType` always has a value (defaults to `'code'`).

- [ ] **Step 1: Read the current `injectBrief()` method**

  ```bash
  grep -n "injectBrief\|DELIVERABLES\|BRIEF:\|promptText" packages/orchestrator/src/adapters/base-adapter.ts
  ```

- [ ] **Step 2: Write the failing tests**

  Create `packages/orchestrator/src/adapters/base-adapter.test.ts`:

  ```ts
  import { describe, it, expect, beforeEach } from 'vitest';
  import { BaseAdapter } from './base-adapter.js';
  import type { Brief } from '@arena/shared';

  // Minimal concrete subclass — BaseAdapter is abstract
  class TestAdapter extends BaseAdapter {
    async startExecution(): Promise<void> {}
  }

  const makeBrief = (overrides: Partial<Brief> = {}): Brief => ({
    id: 'test-brief',
    title: 'Test Brief',
    problem: 'Solve the problem.',
    constraints: ['No external libraries'],
    deliverables: ['solution.py'],
    rubric: { criteria: [{ id: 'correctness', weight: 1.0, maxScore: 10, description: 'Correct output' }] },
    format: 'SPRINT' as any,
    timeLimitMs: 300_000,
    deliverableType: 'code',
    ...overrides,
  });

  describe('BaseAdapter.injectBrief() deliverable format injection', () => {
    let adapter: TestAdapter;

    beforeEach(() => {
      adapter = new TestAdapter('team-a', 'claude', '/tmp/test', {} as any);
    });

    it('injects [DELIVERABLE FORMAT] section for code type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'code' }), 'architect');
      expect(adapter.promptText).toContain('[DELIVERABLE FORMAT]');
      expect(adapter.promptText).toContain('runnable code files');
    });

    it('injects document guidance for document type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'document' }), 'researcher');
      expect(adapter.promptText).toContain('Do NOT write code files');
    });

    it('injects analysis guidance for analysis type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'analysis' }), 'analyst');
      expect(adapter.promptText).toContain('data analysis output');
    });

    it('injects presentation guidance for presentation type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'presentation' }), 'designer');
      expect(adapter.promptText).toContain('presentation outline');
    });

    it('injects plan guidance for plan type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'plan' }), 'architect');
      expect(adapter.promptText).toContain('strategic plan');
    });

    it('injects mixed guidance for mixed type', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'mixed' }), 'pioneer');
      expect(adapter.promptText).toContain('combination of code and documents');
    });

    it('defaults to code guidance when deliverableType is undefined', async () => {
      const brief = makeBrief();
      delete (brief as any).deliverableType;
      await adapter.injectBrief(brief, 'architect');
      expect(adapter.promptText).toContain('runnable code files');
    });

    it('[DELIVERABLE FORMAT] section appears before [DELIVERABLES]', async () => {
      await adapter.injectBrief(makeBrief({ deliverableType: 'document' }), 'researcher');
      const formatIdx = adapter.promptText.indexOf('[DELIVERABLE FORMAT]');
      const deliverablesIdx = adapter.promptText.indexOf('[DELIVERABLES]');
      expect(formatIdx).toBeGreaterThan(-1);
      expect(formatIdx).toBeLessThan(deliverablesIdx);
    });
  });
  ```

- [ ] **Step 3: Run to confirm tests fail**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "injectBrief\|DELIVERABLE FORMAT"
  ```

  Expected: FAIL — `promptText` not accessible or section not present.

- [ ] **Step 4: Update `injectBrief()` in base-adapter.ts**

  Read the full method first (`grep -n "" packages/orchestrator/src/adapters/base-adapter.ts | head -120`), then apply these changes:

  **a)** Make `promptText` accessible in tests — check if it's already `public` or `protected`. If it's `private`, change it to `public` (it's used in tests and subclasses already access it).

  **b)** Add the deliverable guide map and inject it. Inside `injectBrief()`, after building `brief.problem` context and before the `[DELIVERABLES]` section, add:

  ```ts
  const DELIVERABLE_GUIDE: Record<string, string> = {
    code:         'Produce runnable code files. The output should be executable.',
    document:     'Produce written documents (.md, .txt). Do NOT write code files unless explicitly required.',
    analysis:     'Produce data analysis output (.csv, .md tables). Focus on data, not code.',
    presentation: 'Produce a presentation outline or slide content. Written format preferred.',
    plan:         'Produce a strategic plan, roadmap, or architecture document in Markdown.',
    mixed:        'Produce whichever combination of code and documents best addresses the brief.',
  };

  const deliverableFormatGuidance = `[DELIVERABLE FORMAT]\n${DELIVERABLE_GUIDE[brief.deliverableType ?? 'code']}`;
  ```

  Then in the `this.promptText = [...]` array, add `deliverableFormatGuidance` immediately after the problem text and before the `[DELIVERABLES]` section:

  ```ts
  this.promptText = [
    `[PERSONA]\n${persona}`,
    `[COMPETITION RULES]`,
    'You are an autonomous AI agent in a timed competition. There is NO human to interact with.',
    'Do NOT ask clarifying questions — no one will answer. Make reasonable assumptions and start working immediately.',
    'Your ONLY goal is to produce deliverable files in the current working directory before time runs out.',
    `[BRIEF: ${brief.title}]`,
    brief.problem,
    constraints,
    deliverableFormatGuidance,   // ← new section
    [
      '[DELIVERABLES]',
      // ... rest unchanged
    ].join('\n'),
    `[SCORING RUBRIC]\nYour work will be judged on the following criteria:\n${rubric}`,
    `[TIME LIMIT] ${Math.round(brief.timeLimitMs / 60_000)} minutes — work fast and write your output files before time runs out.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  ```

- [ ] **Step 5: Run the new tests**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "injectBrief\|PASS\|FAIL"
  ```

  Expected: All 8 new tests PASS.

- [ ] **Step 6: Run the full test suite**

  ```bash
  npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: All tests pass (192 total: 178 + 6 parser + 8 adapter).

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/adapters/base-adapter.ts \
          packages/orchestrator/src/adapters/base-adapter.test.ts
  git commit -m "feat(adapter): inject [DELIVERABLE FORMAT] guidance into agent prompt"
  ```

---

### Task 3: Wire `domainHint` and `deliverableType` into Forge domain selection

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts` (the `selectDomainArtifacts()` function, ~lines 624–649)
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.test.ts` (add domain selection tests)

**Context:** `selectDomainArtifacts()` currently: (1) builds a format-based fallback, (2) calls Claude to select domain, (3) falls back on error. Sprint 2 adds two new short-circuit paths BEFORE the Claude call:
- `brief.domainHint` set → return immediately using `DOMAIN_TYPE_DEFAULTS` (no AI call, no cost)
- `brief.deliverableType` set (non-mixed) → prepend a hint line to the AI selection prompt, then proceed normally

The `DOMAIN_TYPE_DEFAULTS` constant was already scaffolded in Sprint 1 (with a TODO comment).

- [ ] **Step 1: Read the current `selectDomainArtifacts()` function**

  ```bash
  grep -n "selectDomainArtifacts\|DOMAIN_TYPE_DEFAULTS\|FORMAT_DOMAIN_DEFAULTS\|GENERIC_DEFAULT\|domainHint\|deliverableType" \
    packages/orchestrator/src/forge/forge-orchestrator.ts
  ```

- [ ] **Step 2: Write the failing tests**

  In `packages/orchestrator/src/forge/forge-orchestrator.test.ts`, add a new describe block:

  ```ts
  describe('selectDomainArtifacts — domainHint and deliverableType signals', () => {
    // We test only the paths that do NOT call Claude (domainHint short-circuit).
    // deliverableType path calls Claude — tested manually via integration.

    it('domainHint "research" returns research artifacts without calling Claude', async () => {
      // If Claude were called, it would need ANTHROPIC_API_KEY — this test proves it isn't called.
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
  ```

  **Important:** `selectDomainArtifacts` is likely not exported currently. You may need to temporarily export it for testing, or restructure the test to verify via the public forge API surface. Check first: if it's not exported, add `export` to the function declaration.

- [ ] **Step 3: Run tests to confirm failure**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "domainHint\|FAIL"
  ```

  Expected: Tests fail — function not found or `domainHint` path not implemented.

- [ ] **Step 4: Update `selectDomainArtifacts()` to wire new signals**

  Export the function if not already exported:
  ```ts
  export async function selectDomainArtifacts(brief: Brief): Promise<{ domain: ForgeDomain; types: ForgeArtifactType[] }> {
  ```

  Add the two new paths AT THE TOP of the function body, before any existing logic:

  ```ts
  export async function selectDomainArtifacts(brief: Brief): Promise<{ domain: ForgeDomain; types: ForgeArtifactType[] }> {
    // Path 1: explicit domainHint — short-circuit, no AI call
    if (brief.domainHint) {
      const types = DOMAIN_TYPE_DEFAULTS[brief.domainHint] ?? GENERIC_DEFAULT.types;
      return { domain: brief.domainHint, types };
    }

    // Path 2: deliverableType hint — seed the AI selection prompt
    const TYPE_TO_DOMAIN: Record<string, ForgeDomain> = {
      code:         'software',
      document:     'creative',
      analysis:     'research',
      presentation: 'creative',
      plan:         'business',
      // 'mixed' intentionally omitted — falls through to unguided AI selection
    };
    const deliverableTypeHint = brief.deliverableType && brief.deliverableType !== 'mixed'
      ? `\nNote: The brief's deliverable type is "${brief.deliverableType}", suggesting a ${TYPE_TO_DOMAIN[brief.deliverableType]} domain focus.`
      : '';

    // ... existing logic continues here (format-based fallback, AI selection call, etc.)
    // Append deliverableTypeHint to the selection prompt before the runClaude call
  ```

  In the AI selection prompt construction (find where `selectionPrompt` or similar variable is built), append `deliverableTypeHint` to it:
  ```ts
  const selectionPrompt = `${DOMAIN_SELECTION_SYSTEM_PROMPT}${deliverableTypeHint}\n\n${JSON.stringify(briefContext)}`;
  ```

  Remove the `// TODO(sprint2)` comment from `DOMAIN_TYPE_DEFAULTS`.

- [ ] **Step 5: Run the new tests**

  ```bash
  npm run test --workspace=packages/orchestrator -- --reporter=verbose 2>&1 | grep -A3 "domainHint\|selectDomain"
  ```

  Expected: All 4 new tests PASS (they test only the domainHint path which has no network dependency).

- [ ] **Step 6: Run the full suite**

  ```bash
  npm run test --workspace=packages/orchestrator 2>&1 | tail -5
  ```

  Expected: All tests pass (196 total).

- [ ] **Step 7: Commit**

  ```bash
  git add packages/orchestrator/src/forge/forge-orchestrator.ts \
          packages/orchestrator/src/forge/forge-orchestrator.test.ts
  git commit -m "feat(forge): wire domainHint short-circuit and deliverableType hint into domain selection"
  ```

---

## Chunk 2: UI and Integration Check

---

### Task 4: Brief creation UI — deliverable type picker + domainHint field

**Files:**
- Modify: `packages/web/app/competitions/new/page.tsx`

**Context:** The form has 3 steps. Step 1 is the "Brief Definition" section (problem, deliverables, constraints, expectedOutput). Step 2 is the "Rubric" section. The deliverable type picker belongs in **Step 1**, immediately after the `expectedOutput` textarea and before the "Next" button. The `domainHint` field is an "Advanced" collapsed section below the picker. Both feed into the `brief` object in the form submission body. The picker also updates the `deliverables` textarea placeholder dynamically.

**Note:** The shared Brief schema (`packages/shared/src/schemas/brief.schema.ts`) is already updated by Task 1 (Chunk 1). No additional schema changes needed here. Fields submitted in the form body will be persisted automatically in the `brief` JSONB column.

**Design system reminder:** Pill labels use `MONOSPACE_FONT` (Orbitron); helper text uses `BODY_FONT` (SF Mono) at minimum `0.62rem`. `html { font-size: 120% }` so 1rem = 19.2px.

- [ ] **Step 1: Read the current Step 1 form area**

  ```bash
  grep -n "deliverable\|expectedOutput\|expandedStep\|Step 1\|step.*1\|constraints" \
    packages/web/app/competitions/new/page.tsx | head -40
  ```

  Identify the exact line where `expectedOutput` textarea ends and the "Next" / step navigation begins in Step 1.

- [ ] **Step 2: Add state variables and type alias**

  At the top of the file (near other type declarations, before the component), add:

  ```ts
  type DeliverableType = 'code' | 'document' | 'analysis' | 'presentation' | 'plan' | 'mixed';
  ```

  In the component state declarations section (near other `useState` calls), add:

  ```tsx
  const [deliverableType, setDeliverableType] = useState<DeliverableType>('code');
  const [domainHint, setDomainHint] = useState<string>('');
  const [domainHintOpen, setDomainHintOpen] = useState(false);
  ```

- [ ] **Step 2b: Update `parseSimpleBriefYaml` for YAML import support**

  The web form has a "Import YAML" path using `parseSimpleBriefYaml` and a `ParsedBriefYaml` type. Find them (search for `parseSimpleBriefYaml` in the file). Update:

  In the `ParsedBriefYaml` type, add:
  ```ts
  deliverableType?: DeliverableType;
  domainHint?: string;
  ```

  In the `parseSimpleBriefYaml` function body, after parsing other top-level fields, add:
  ```ts
  if (raw.deliverableType) result.deliverableType = raw.deliverableType as DeliverableType;
  if (raw.domainHint) result.domainHint = String(raw.domainHint);
  ```

  In the `handleYamlImport` function (where `parseSimpleBriefYaml` result is applied to state), add:
  ```ts
  if (parsed.deliverableType) setDeliverableType(parsed.deliverableType);
  if (parsed.domainHint) setDomainHint(parsed.domainHint);
  ```

- [ ] **Step 3: Add the deliverable type picker UI**

  After the `expectedOutput` textarea section and before the Next button in Step 1, add:

  ```tsx
  {/* Deliverable Type picker */}
  <div style={{ marginTop: '1.25rem' }}>
    <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1.5px', color: '#4a8fa8', textTransform: 'uppercase', marginBottom: '0.6rem', fontFamily: MONOSPACE_FONT }}>
      Deliverable Type
    </div>
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {([
        { value: 'code',         label: '</> Code',         hint: 'e.g. solution.py, main.ts' },
        { value: 'document',     label: '📄 Document',      hint: 'e.g. report.md, analysis.txt' },
        { value: 'analysis',     label: '📊 Analysis',      hint: 'e.g. results.csv, summary.md' },
        { value: 'presentation', label: '🎨 Presentation',  hint: 'e.g. slides.md, deck-outline.md' },
        { value: 'plan',         label: '🗺 Plan',           hint: 'e.g. roadmap.md, architecture.md' },
        { value: 'mixed',        label: '⚡ Mixed',          hint: 'e.g. thesis.md, model.py' },
      ] as const).map(({ value, label }) => {
        const active = deliverableType === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setDeliverableType(value)}
            style={{
              fontSize: '0.65rem', fontWeight: 700, padding: '0.3rem 0.75rem',
              borderRadius: '5px', cursor: 'pointer', fontFamily: MONOSPACE_FONT,
              letterSpacing: '0.5px', border: active ? '1px solid rgba(0,240,255,0.5)' : '1px solid #0a2235',
              background: active ? 'rgba(0,240,255,0.1)' : 'transparent',
              color: active ? '#00f0ff' : '#4a8fa8',
              transition: 'all 0.15s ease',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
    <div style={{ fontSize: '0.65rem', color: '#3d7d94', marginTop: '0.4rem', fontFamily: BODY_FONT }}>
      {({
        code:         'Agents will produce runnable code files.',
        document:     'Agents will produce written documents — no code files.',
        analysis:     'Agents will produce data tables or CSV output.',
        presentation: 'Agents will produce slide outlines or visual content.',
        plan:         'Agents will produce strategy or architecture documents.',
        mixed:        'Agents choose whichever format best fits the brief.',
      })[deliverableType]}
    </div>
  </div>

  {/* Advanced: domainHint */}
  <div style={{ marginTop: '1rem' }}>
    <button
      type="button"
      onClick={() => setDomainHintOpen(o => !o)}
      style={{
        fontSize: '0.62rem', color: '#3d7d94', background: 'none', border: 'none',
        cursor: 'pointer', padding: 0, fontFamily: MONOSPACE_FONT, letterSpacing: '1px',
        display: 'flex', alignItems: 'center', gap: '0.3rem',
      }}
    >
      {domainHintOpen ? '▼' : '▶'} Advanced
    </button>
    {domainHintOpen && (
      <div style={{ marginTop: '0.6rem' }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '1.5px', color: '#4a8fa8', textTransform: 'uppercase', marginBottom: '0.4rem', fontFamily: MONOSPACE_FONT }}>
          Domain Hint (optional)
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {(['', 'software', 'research', 'creative', 'security', 'business', 'ideation'] as const).map((d) => {
            const active = domainHint === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDomainHint(d)}
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '0.2rem 0.6rem',
                  borderRadius: '4px', cursor: 'pointer', fontFamily: MONOSPACE_FONT,
                  border: active ? '1px solid rgba(0,240,255,0.4)' : '1px solid #0a2235',
                  background: active ? 'rgba(0,240,255,0.08)' : 'transparent',
                  color: active ? '#00f0ff' : '#3d7d94',
                  transition: 'all 0.15s ease',
                }}
              >
                {d === '' ? 'Auto' : d}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: '0.62rem', color: '#1e4a5a', marginTop: '0.35rem', fontFamily: BODY_FONT }}>
          Overrides AI domain detection for Forge artifact selection. Leave on Auto unless you know the domain.
        </div>
      </div>
    )}
  </div>
  ```

- [ ] **Step 4: Update the deliverables placeholder dynamically**

  Find the `deliverables` textarea in Step 1. It likely has a static `placeholder` prop. Change it to use the deliverable type hint:

  ```tsx
  placeholder={({
    code:         'e.g. solution.py, main.ts, README.md',
    document:     'e.g. report.md, findings.txt, analysis.pdf',
    analysis:     'e.g. results.csv, summary.md, charts.json',
    presentation: 'e.g. slides.md, deck-outline.md, visuals.md',
    plan:         'e.g. roadmap.md, architecture.md, strategy.md',
    mixed:        'e.g. thesis.md, model.py, README.md',
  })[deliverableType]}
  ```

- [ ] **Step 5: Include `deliverableType` and `domainHint` in form submission**

  Find the form submission `body` object (around line 549). Update the `brief` object:

  ```ts
  brief: {
    // ... existing fields unchanged ...
    ...(expectedOutput.trim() ? { expectedOutput: expectedOutput.trim() } : {}),
    deliverableType,
    ...(domainHint ? { domainHint } : {}),
  },
  ```

- [ ] **Step 6: Pre-populate deliverableType and domainHint when loading from briefSlug**

  Find where `?briefSlug` pre-populates form fields (search for `briefSlug` in the file). The inline type annotation for the briefs array likely looks like `{ id: string; title: string; ... }[]`. Update it to include:
  ```ts
  deliverableType?: DeliverableType;
  domainHint?: string;
  ```

  Then after the existing pre-population logic, add:
  ```ts
  if (matchedBrief.deliverableType) setDeliverableType(matchedBrief.deliverableType);
  if (matchedBrief.domainHint) setDomainHint(matchedBrief.domainHint);
  ```

- [ ] **Step 6b: Pre-populate deliverableType and domainHint when loading from `?from=<id>` (copy competition)**

  Find the `?from` query param effect (search for `from` and `useSearchParams` or `router` usage). This effect rebuilds form state from a prior competition. After the existing pre-population logic, add:
  ```ts
  if (fromComp.brief?.deliverableType) setDeliverableType(fromComp.brief.deliverableType as DeliverableType);
  if (fromComp.brief?.domainHint) setDomainHint(fromComp.brief.domainHint);
  ```

- [ ] **Step 7: Typecheck the web package**

  ```bash
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1
  ```

  Expected: No output (clean).

- [ ] **Step 8: Commit**

  ```bash
  git add packages/web/app/competitions/new/page.tsx
  git commit -m "feat(ui): add deliverable type picker and domainHint advanced field to brief creation"
  ```

---

### Task 5: Final integration check

**Files:** None (read-only verification)

- [ ] **Step 1: Run full orchestrator test suite**

  ```bash
  npm run test --workspace=packages/orchestrator 2>&1 | tail -10
  ```

  Expected: All tests pass. Count should be 196+ (178 original + 6 parser + 8 adapter + 4 forge).

- [ ] **Step 2: Typecheck all packages**

  ```bash
  npm run typecheck --workspace=packages/orchestrator 2>&1 && \
  npx tsc --noEmit -p packages/web/tsconfig.json 2>&1 && \
  npx tsc --noEmit -p packages/shared/tsconfig.json 2>&1
  echo "All typechecks passed"
  ```

  Expected: "All typechecks passed" with no errors above.

- [ ] **Step 3: Smoke test the brief creation UI**

  Start the dev server if not running:
  ```bash
  cd packages/web && npm run dev
  ```

  Navigate to `http://localhost:3001/competitions/new`. In Step 1:
  - Verify the deliverable type pills appear and highlight on click
  - Verify the helper text below the pills changes per selection
  - Verify the deliverables textarea placeholder changes
  - Click ▶ Advanced — verify domainHint pills appear
  - Select "document" deliverable type + "research" domain hint
  - Proceed to Step 3 and confirm the form submits

- [ ] **Step 4: Smoke test a YAML brief with new fields**

  Create a test brief file:
  ```bash
  cat > /tmp/test-sprint2.yml << 'EOF'
  id: test-sprint2
  title: Test Sprint 2 Brief
  format: SPRINT
  problem: Write a 1-page investment thesis on renewable energy.
  constraints:
    - No code — written output only
  deliverables:
    - thesis.md
  timeLimitMs: 300000
  deliverableType: document
  domainHint: research
  rubric:
    criteria:
      - id: clarity
        weight: 1.0
        maxScore: 10
        description: Clear and well-argued thesis
  EOF
  ```

  Run the parser on it:
  ```bash
  DATABASE_URL=postgresql://localhost/arena \
    npx tsx packages/orchestrator/src/cli.ts run /tmp/test-sprint2.yml \
    --team-a claude:architect --team-b claude:speedrunner \
    --skip-sandbox --time-limit 60000 --log-dir /tmp/sprint2-test 2>&1 | head -30
  ```

  Expected: Competition starts, agent prompt contains `[DELIVERABLE FORMAT]` with document guidance (check log files in `/tmp/sprint2-test`).

- [ ] **Step 5: Commit any fixes, then final commit**

  ```bash
  git add -p  # stage any incidental fixes
  git commit -m "test(sprint2): integration verified — 196 tests, all typechecks clean"
  ```
