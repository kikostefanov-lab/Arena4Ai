# Sprint 7B: Backend Quality

**Date:** 2026-03-15
**Status:** Design approved, pending implementation plan
**Goal:** Improve forge artifact relevance, agent stats tracking, adversarial judging, and artifact format quality.

## Changes

### 1. Domain → Artifact Tightening

**Problem:** Forge generates irrelevant artifacts (Dockerfiles for education briefs, SQL schemas for writing competitions) because `DOMAIN_TYPE_DEFAULTS` blindly includes all artifacts for a domain, and the domain fallback defaults to `software` regardless of `deliverableType`.

**Fix — Three layers:**

**Layer 1: deliverableType-based domain fallback**

When the AI domain classifier fails and `brief.domainHint` is not set, the fallback currently always goes to `software`. Replace with a `deliverableType`-aware fallback:

| deliverableType | Fallback domain |
|---|---|
| `code` | `software` |
| `document` | `research` |
| `analysis` | `business` |
| `plan` | `strategy` |
| `presentation` | `creative` |
| `mixed` | `software` (last resort) |

**Layer 2: Relevance keyword filter**

After domain selection produces a candidate artifact list, filter out artifacts whose relevance keywords don't match the brief content. Applied to `brief.problem + brief.constraints.join(' ') + brief.deliverables.join(' ')` (lowercased).

```ts
const ARTIFACT_RELEVANCE_KEYWORDS: Record<string, string[]> = {
  dockerfile: ['docker', 'container', 'deploy', 'kubernetes', 'k8s', 'devops', 'image'],
  sql_schema: ['database', 'sql', 'schema', 'postgres', 'mysql', 'table', 'query', 'migration'],
  github_actions: ['ci', 'cd', 'pipeline', 'github', 'workflow', 'actions', 'deploy'],
  environment_template: ['env', 'config', 'secret', 'api key', 'credentials', '.env'],
};
```

Rules:
- If an artifact type has keywords defined AND none match → exclude it
- If an artifact type has no keywords defined → always include (roadmap, task_graph, etc.)
- Universal artifacts (executive_summary, next_steps, tool_recommendations) bypass this filter entirely

**Layer 3: Universal artifacts always generate**

The 3 universal artifacts are domain-agnostic and always run. No change needed — this is already the case.

**Full chain:**
```
brief.domainHint → short-circuit to domain
     ↓ (not set)
AI classifier → domain
     ↓ (AI fails)
deliverableType fallback → domain
     ↓
DOMAIN_TYPE_DEFAULTS[domain] → candidate artifacts
     ↓
relevance keyword filter → filtered artifacts
     ↓
+ universal artifacts → forge run
```

**Modified file:** `packages/orchestrator/src/forge/forge-orchestrator.ts`
- Add `ARTIFACT_RELEVANCE_KEYWORDS` constant
- Add `filterByRelevance(candidates, brief)` function
- Update `DELIVERABLE_TYPE_DOMAIN_FALLBACK` mapping (replace or augment `FORMAT_DOMAIN_DEFAULTS`)
- Call `filterByRelevance()` after `selectDomainArtifacts()` returns

---

### 2. Agent Stats — Auto-resolve agentId

**Problem:** Agent stats (`statsWins`, `statsLosses`, `statsTotal`, `statsAvgScore`) only update when teams have `agentId` set. Competitions started from New Battle with manual `model:persona` strings don't set `agentId`, so stats never accumulate for those runs.

**Fix:** In `competition-runner.ts`, after teams are constructed but before execution starts, attempt to resolve each team's `model:persona` to an existing agent in the DB:

```ts
// For each team, try to find a matching agent by provider + name
for (const team of teams) {
  if (team.agentId) continue; // already set (Armory launch)
  const [provider] = team.model.split(':');
  const match = await agentRepo.findByProviderAndName(provider, team.persona);
  if (match) team.agentId = match.id;
}
```

This requires adding a `findByProviderAndName(provider, name)` method to `AgentRepository`.

The existing `incrementStats` call at lines 381-390 already handles the rest — it fires for any team with an `agentId`. With auto-resolution, stats accumulate regardless of how the competition was launched.

**Modified files:**
- `packages/orchestrator/src/db/agent-repository.ts` — add `findByProviderAndName()`
- `packages/orchestrator/src/engine/competition-runner.ts` — add agent resolution before execution

---

### 3. Adversarial Judge Mode

**Problem:** Dual-judge code exists (adversarial judge prompt with "look for weaknesses") but there's no way to enable it.

**Fix — Three entry points:**

**Entry 1: New Battle page**

Add an "Adversarial Judge" toggle in the competition form's Advanced section. When enabled, sets `adversarialJudge: true` in the `POST /competitions` body.

**Entry 2: CLI flag**

Add `--adversarial-judge` flag to the `run` command. Passes `adversarialJudge: true` to `RunOptions`.

**Entry 3: Score tab re-judge button**

On the Score drawer of completed competitions, add a "⚖ Re-judge (adversarial)" button. Calls `POST /api/competitions/:id/re-judge` which triggers a re-evaluation with the adversarial judge and averages the results with the existing scores.

**How dual judging works:**

When `adversarialJudge` is true in the competition runner:
1. For each team's deliverables, run TWO `aiJudge()` calls in parallel:
   - Standard judge (`JUDGE_IDS.aiClaude`)
   - Adversarial judge (`JUDGE_IDS.aiAdversarial`)
2. Average the scores per criterion: `(standardScore + adversarialScore) / 2`
3. Store both `JudgeResult` entries in the scorecard's `judgeResults[]` array
4. The `computeOverallScore()` function already handles multiple judge results

**Re-judge endpoint:**

New endpoint: `POST /competitions/:id/re-judge`
- Body: `{ adversarial?: boolean }` (default true)
- Requires COMPLETE/FORGE_COMPLETE state
- Archives current results (via `archiveResult`)
- Re-runs judging with both standard + adversarial judges
- Updates scorecards and winnerId
- Returns new scores

**Modified files:**
- `packages/orchestrator/src/engine/competition-runner.ts` — dual judge logic when `adversarialJudge` is true
- `packages/orchestrator/src/server/routes/competitions.ts` — add `POST /:id/re-judge` endpoint
- `packages/web/app/competitions/new/page.tsx` — add adversarial toggle in Advanced section
- `packages/web/app/competitions/[id]/page.tsx` — add re-judge button on Score drawer
- `packages/web/app/api/competitions/[id]/re-judge/route.ts` — web proxy
- `packages/orchestrator/src/cli.ts` — add `--adversarial-judge` flag

---

### 4. Forge Artifact Format Stripping

**Problem:** Claude wraps SQL/YAML/Dockerfile output in markdown code fences (` ```sql ... ``` `) even when instructed not to. This breaks direct file usage and confuses the format-aware modal renderer.

**Fix:** Add `stripMarkdownFences(content, outputFormat)` post-processing in `generateArtifact()`:

```ts
function stripMarkdownFences(content: string, format: ForgeOutputFormat): string {
  if (format === 'markdown') return content; // don't touch markdown
  const lines = content.split('\n');
  // Check if first line is a fence
  if (lines[0]?.trim().startsWith('```')) {
    lines.shift(); // remove opening fence
    // Remove closing fence if present
    const lastIdx = lines.length - 1;
    if (lastIdx >= 0 && lines[lastIdx].trim() === '```') {
      lines.pop();
    }
  }
  return lines.join('\n').trim();
}
```

Applied in `generateArtifact()` after `runClaude()` returns, before constructing the `ForgeArtifact` object. Only strips if `outputFormat` is `sql`, `csv`, `yaml`, `text`, `dockerfile`, or `json`.

**Modified file:** `packages/orchestrator/src/forge/forge-orchestrator.ts`

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `packages/web/app/api/competitions/[id]/re-judge/route.ts` | Web proxy for re-judge endpoint |

### Modified Files

| File | Change |
|---|---|
| `packages/orchestrator/src/forge/forge-orchestrator.ts` | Relevance filter, deliverableType fallback, format stripping |
| `packages/orchestrator/src/engine/competition-runner.ts` | Agent ID resolution, dual judge logic |
| `packages/orchestrator/src/db/agent-repository.ts` | Add `findByProviderAndName()` |
| `packages/orchestrator/src/server/routes/competitions.ts` | Add `POST /:id/re-judge` endpoint |
| `packages/orchestrator/src/cli.ts` | Add `--adversarial-judge` flag |
| `packages/web/app/competitions/new/page.tsx` | Adversarial judge toggle in Advanced |
| `packages/web/app/competitions/[id]/page.tsx` | Re-judge button on Score drawer |

### Unchanged

- Adapters, WebSocket, battle visualization, brief pipeline, Remotion
- Database schema (no new tables or migrations)
- TopBar, Stats page, gallery (Sprint 7A changes)

---

## Success Criteria

1. A brief about "analyze restaurant failure rates" with `deliverableType: 'analysis'` does NOT generate Dockerfiles or SQL schemas
2. Competitions started from New Battle auto-resolve agent IDs and update stats
3. `--adversarial-judge` CLI flag produces dual-judge scorecards with averaged scores
4. New Battle has an adversarial judge toggle in Advanced settings
5. Completed competitions have a "Re-judge (adversarial)" button on the Score tab
6. SQL/YAML/Dockerfile forge artifacts don't contain markdown fences
7. All 255+ tests pass
