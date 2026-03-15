# Sprint 7B: Backend Quality — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve forge artifact relevance, auto-resolve agent stats, enable adversarial judging, and strip markdown fences from non-markdown artifacts.

**Architecture:** All backend changes in the orchestrator package. Two small web UI additions (adversarial toggle + re-judge button). No new DB tables.

**Tech Stack:** TypeScript, Express, Drizzle ORM, Claude CLI

**Spec:** `docs/superpowers/specs/2026-03-15-backend-quality-design.md`

---

## Task 1: Forge artifact relevance filter + deliverableType domain fallback

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Add deliverableType → domain fallback map**

After `GENERIC_DEFAULT` (around line 700), add:

```ts
/** When AI domain selection fails and no domainHint is set, fall back based on deliverableType */
const DELIVERABLE_TYPE_FALLBACK: Record<string, { domain: ForgeDomain; types: ForgeArtifactType[] }> = {
  code:         DOMAIN_TYPE_DEFAULTS.software ? { domain: 'software', types: DOMAIN_TYPE_DEFAULTS.software } : GENERIC_DEFAULT,
  document:     { domain: 'research', types: DOMAIN_TYPE_DEFAULTS.research ?? [] },
  analysis:     { domain: 'business', types: DOMAIN_TYPE_DEFAULTS.business ?? [] },
  plan:         { domain: 'strategy', types: DOMAIN_TYPE_DEFAULTS.strategy ?? [] },
  presentation: { domain: 'creative', types: DOMAIN_TYPE_DEFAULTS.creative ?? [] },
  mixed:        GENERIC_DEFAULT,
};
```

- [ ] **Step 2: Add relevance keyword filter**

```ts
/** Keywords that must appear in brief text for an artifact type to be included */
const ARTIFACT_RELEVANCE_KEYWORDS: Partial<Record<ForgeArtifactType, string[]>> = {
  dockerfile: ['docker', 'container', 'deploy', 'kubernetes', 'k8s', 'devops', 'image'],
  sql_schema: ['database', 'sql', 'schema', 'postgres', 'mysql', 'table', 'query', 'migration'],
  github_actions: ['ci', 'cd', 'pipeline', 'github', 'workflow', 'actions', 'deploy'],
  environment_template: ['env', 'config', 'secret', 'api key', 'credentials', '.env'],
};

/** Filter artifact types by relevance to brief content */
function filterByRelevance(types: ForgeArtifactType[], brief: { problem: string; constraints?: string[]; deliverables?: string[] }): ForgeArtifactType[] {
  const text = [
    brief.problem,
    ...(brief.constraints ?? []),
    ...(brief.deliverables ?? []),
  ].join(' ').toLowerCase();

  return types.filter(type => {
    const keywords = ARTIFACT_RELEVANCE_KEYWORDS[type];
    if (!keywords) return true; // no keywords = always include
    return keywords.some(kw => text.includes(kw));
  });
}
```

- [ ] **Step 3: Update selectDomainArtifacts() to use deliverableType fallback**

In `selectDomainArtifacts()`, update the exception catch block (around line 762) and the `GENERIC_DEFAULT` fallback points to use `DELIVERABLE_TYPE_FALLBACK` when available:

Replace `return GENERIC_DEFAULT;` at the catch block with:
```ts
const dtFallback = DELIVERABLE_TYPE_FALLBACK[brief.deliverableType ?? 'code'];
return dtFallback ?? GENERIC_DEFAULT;
```

Also apply this to the other `GENERIC_DEFAULT` return points (invalid domain at ~line 756, empty types at ~line 758).

- [ ] **Step 4: Apply filterByRelevance in runForge()**

In `runForge()`, after `selectDomainArtifacts()` returns (around line 965), filter the types:

```ts
const { domain, types: rawTypes } = await selectDomainArtifacts(input.brief);
const selectedTypes = filterByRelevance(rawTypes, input.brief);
```

Replace references to the old `types` variable with `selectedTypes`.

- [ ] **Step 5: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts
git commit -m "feat(forge): deliverableType domain fallback + relevance keyword filter for artifacts

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Agent stats auto-resolve + CLI agentRepo wiring

**Files:**
- Modify: `packages/orchestrator/src/db/agent-repository.ts`
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`
- Modify: `packages/orchestrator/src/cli.ts`

- [ ] **Step 1: Add findByProviderAndModel to AgentRepository**

The existing `getByProviderAndPersonaName()` (line 195) joins agents + personas by persona name. We need a simpler lookup that matches by `provider` column and agent `name` (which stores the persona string):

```ts
async findByProviderAndModel(provider: string, personaOrName: string): Promise<{ id: string } | null> {
  const rows = await this.db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.provider, provider),
        eq(agents.name, personaOrName),
        eq(agents.retired, false),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Add agent resolution in competition-runner.ts**

In `run()`, after teams are constructed and adapters are created (after the adapter routing block, around line 255), add agent ID resolution:

```ts
// Auto-resolve agentId for teams that don't have one
if (this.agentRepo) {
  for (const team of teams) {
    if (team.agentId) continue;
    const [provider] = team.model.split(':');
    const persona = team.persona ?? 'pragmatist';
    try {
      const match = await this.agentRepo.findByProviderAndModel(provider, persona);
      if (match) team.agentId = match.id;
    } catch { /* non-fatal */ }
  }
}
```

Place this BEFORE `adapter.injectBrief()` calls so the agentId is set before execution starts.

- [ ] **Step 3: Wire agentRepo in CLI run command**

In `cli.ts`, inside the DB persistence block (around line 82-112), after `const repo = new CompetitionRepository(db)`, add:

```ts
const { AgentRepository } = await import('./db/agent-repository.js');
const agentRepo = new AgentRepository(db);
```

Then pass `agentRepo` to the `CompetitionRunner` constructor. Find where the runner is created (around line 65):

```ts
const runner = new CompetitionRunner(brief, teams, {
  // ... existing options
  agentRepo,  // ADD THIS
});
```

Note: `agentRepo` needs to be available at runner construction time, but the DB import is inside the `if (process.env.DATABASE_URL)` block. Move the runner construction inside or after the DB block, or create the agentRepo conditionally and pass it.

The simplest approach: declare `let agentRepo: any = undefined;` before the DB block, set it inside if DB is available, then pass to the runner.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/db/agent-repository.ts packages/orchestrator/src/engine/competition-runner.ts packages/orchestrator/src/cli.ts
git commit -m "feat: auto-resolve agentId for stats tracking, wire agentRepo in CLI

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Adversarial judge mode — backend

**Files:**
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Modify: `packages/orchestrator/src/cli.ts`

- [ ] **Step 1: Add adversarialJudge to RunOptions**

In `RunOptions` (around line 37), the `aiJudgeCount` field already exists. Add a more user-friendly alias:

```ts
/** Enable adversarial (dual) judging — runs both standard and adversarial judge, averages scores */
adversarialJudge?: boolean;
```

In the constructor, map it to `aiJudgeCount`:
```ts
if (options.adversarialJudge) this.options.aiJudgeCount = 2;
```

- [ ] **Step 2: Pass adversarialJudge from POST /competitions**

In `competitions.ts`, in the `POST /competitions` handler (around line 55-62), add to the options construction:

```ts
adversarialJudge: body.adversarialJudge === true,
```

- [ ] **Step 3: Add --adversarial-judge CLI flag**

In `cli.ts`, add to the `run` command options:
```ts
.option('--adversarial-judge', 'Enable dual judging with adversarial cross-check')
```

And in the action handler, pass it to RunOptions:
```ts
adversarialJudge: opts.adversarialJudge ?? false,
```

- [ ] **Step 4: Add POST /:id/re-judge endpoint**

In `competitions.ts`, add a new route:

```ts
// POST /competitions/:id/re-judge — re-run judging with optional adversarial mode
competitionsRouter.post('/:id/re-judge', async (req: Request, res: Response) => {
  const { id } = req.params;
  const { adversarial = true } = req.body as { adversarial?: boolean };

  const comp = await repo.getCompetition(id);
  if (!comp) { res.status(404).json({ error: 'Competition not found' }); return; }

  const result = await repo.getResult(id);
  if (!result) { res.status(400).json({ error: 'No results to re-judge' }); return; }

  const brief = comp.brief as Brief;
  const deliverables = (result.deliverables ?? []) as Deliverable[];
  if (deliverables.length === 0) { res.status(400).json({ error: 'No deliverables' }); return; }

  // Archive current results
  await repo.archiveResult(id, 'judge');

  // Re-judge
  const judgeResults: JudgeResult[] = [];
  for (const d of deliverables) {
    const standard = await aiJudge(brief, d, brief.rubric, { judgeId: JUDGE_IDS.aiClaude });
    judgeResults.push(standard);
    if (adversarial) {
      const adv = await aiJudge(brief, d, brief.rubric, { judgeId: JUDGE_IDS.aiAdversarial });
      judgeResults.push(adv);
    }
  }

  // Build scorecards — group by teamId, average scores across judges
  const teamScores = new Map<string, JudgeResult[]>();
  for (const jr of judgeResults) {
    const arr = teamScores.get(jr.teamId) ?? [];
    arr.push(jr);
    teamScores.set(jr.teamId, arr);
  }

  const scorecards = [...teamScores.entries()].map(([teamId, results]) => {
    const avgScore = results.reduce((sum, r) => sum + r.overallScore, 0) / results.length;
    return { teamId, finalScore: avgScore, judgeResults: results };
  }).sort((a, b) => b.finalScore - a.finalScore);

  const winnerId = scorecards[0]?.teamId ?? null;
  await repo.updateScorecards(id, scorecards, winnerId);

  res.json({ winnerId, scorecards: scorecards.map(s => ({ teamId: s.teamId, finalScore: s.finalScore })) });
});
```

Add necessary imports at the top of the file (`aiJudge`, `JUDGE_IDS`, `Brief`, `Deliverable`, `JudgeResult`).

- [ ] **Step 5: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/orchestrator/src/engine/competition-runner.ts packages/orchestrator/src/server/routes/competitions.ts packages/orchestrator/src/cli.ts
git commit -m "feat(judge): adversarial judge mode — CLI flag, API option, re-judge endpoint

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Adversarial judge mode — web UI

**Files:**
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/web/app/competitions/[id]/page.tsx`
- Create: `packages/web/app/api/competitions/[id]/re-judge/route.ts`

- [ ] **Step 1: Add adversarial toggle to New Battle page**

In `/competitions/new/page.tsx`, find the Advanced settings section (look for "TIME LIMIT" or the `<details>` / expandable section). Add a toggle:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}>
  <input
    type="checkbox"
    id="adversarial-judge"
    checked={adversarialJudge}
    onChange={(e) => setAdversarialJudge(e.target.checked)}
    style={{ accentColor: '#00f0ff' }}
  />
  <label htmlFor="adversarial-judge" style={{ fontSize: '0.62rem', color: '#4a8fa8', cursor: 'pointer' }}>
    ⚖ Adversarial judge (dual scoring — standard + critical judge, averaged)
  </label>
</div>
```

Add state: `const [adversarialJudge, setAdversarialJudge] = useState(false);`

Pass it in the competition launch body: `adversarialJudge`.

- [ ] **Step 2: Create re-judge web proxy route**

Create `packages/web/app/api/competitions/[id]/re-judge/route.ts`:

```ts
import { NextResponse } from 'next/server';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const apiBase = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
  try {
    const body = await req.json();
    const res = await fetch(`${apiBase}/competitions/${id}/re-judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: 'Re-judge failed' }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Re-judge failed' }, { status: 500 });
  }
}
```

- [ ] **Step 3: Add re-judge button on Score drawer**

In `/competitions/[id]/page.tsx`, find the ScoreDrawer component (defined inline). In the Scores tab header area (where the tab title and column headers are), add a button:

```tsx
<button
  onClick={handleReJudge}
  disabled={reJudging}
  style={actionBtn(
    reJudging ? '#1e4a5a' : '#eab308',
    reJudging ? 'transparent' : 'rgba(234,179,8,0.08)',
    { disabled: reJudging },
  )}
>
  {reJudging ? '⟳ Re-judging...' : '⚖ Re-judge (adversarial)'}
</button>
```

Add state and handler:
```ts
const [reJudging, setReJudging] = useState(false);
const handleReJudge = async () => {
  setReJudging(true);
  try {
    const res = await fetch(`/api/competitions/${competitionId}/re-judge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adversarial: true }),
    });
    if (res.ok) {
      // Refresh the page to show new scores
      window.location.reload();
    }
  } catch { /* ignore */ }
  finally { setReJudging(false); }
};
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/competitions/new/page.tsx "packages/web/app/competitions/[id]/page.tsx" "packages/web/app/api/competitions/[id]/re-judge/route.ts"
git commit -m "feat(web): adversarial judge toggle on New Battle + re-judge button on Score tab

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Forge artifact format stripping

**Files:**
- Modify: `packages/orchestrator/src/forge/forge-orchestrator.ts`

- [ ] **Step 1: Add stripMarkdownFences function**

Near the top of the file (after imports), add:

```ts
/** Strip markdown code fences from non-markdown artifact content */
function stripMarkdownFences(content: string, format: ForgeOutputFormat): string {
  if (format === 'markdown') return content;
  const lines = content.split('\n');
  if (lines[0]?.trim().startsWith('```')) {
    lines.shift();
    const lastIdx = lines.length - 1;
    if (lastIdx >= 0 && lines[lastIdx].trim() === '```') {
      lines.pop();
    }
  }
  return lines.join('\n').trim();
}
```

- [ ] **Step 2: Apply in generateArtifact()**

In the `generateArtifact()` closure (around line 981-1001), after `runClaude()` returns the content and before constructing the `ForgeArtifact`, apply the stripping:

```ts
const rawContent = await runClaude(userPrompt, buildPrompt(spec));
const content = stripMarkdownFences(rawContent, spec.outputFormat);
```

Then use `content` (not `rawContent`) in the returned artifact object.

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/forge/forge-orchestrator.ts
git commit -m "feat(forge): strip markdown fences from SQL/YAML/Dockerfile/CSV artifacts

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final validation + CLAUDE.md

- [ ] **Step 1: Run all tests**

```bash
npm run test --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 2: Update CLAUDE.md**

Add under Key Architecture:
- Adversarial judge: `--adversarial-judge` CLI flag, `adversarialJudge` body param, `POST /competitions/:id/re-judge` endpoint
- Forge relevance filter: `ARTIFACT_RELEVANCE_KEYWORDS` + `DELIVERABLE_TYPE_FALLBACK`

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Sprint 7B — adversarial judge, forge relevance, agent stats

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push
```
