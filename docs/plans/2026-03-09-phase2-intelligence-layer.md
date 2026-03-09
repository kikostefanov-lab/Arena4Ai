# Phase 2 — Intelligence Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the synthesis engine, multi-judge panel, format preset picker, replay viewer, and analytics dashboard — completing the Phase 2 intelligence layer that makes Agent Arena genuinely valuable beyond just "who won."

**Architecture:** Synthesis runs as a new SYNTHESIZING lifecycle state inserted between SCORED and COMPLETE; a Claude-powered merge engine reads both teams' deliverables and produces an attributed hybrid stored in the results table. A neutral second AI judge improves scoring quality. The replay viewer fetches all events from a new HTTP endpoint and plays them back with controls. Analytics are computed from existing Postgres tables on demand.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Node.js child_process (Claude CLI), Next.js 14 App Router, existing ws/Express stack.

---

## Reference: Key Files

| File | Role |
|------|------|
| `packages/shared/src/constants/states.ts` | State machine enum + VALID_TRANSITIONS |
| `packages/orchestrator/src/engine/competition-runner.ts` | Full competition lifecycle |
| `packages/orchestrator/src/judging/ai-judge.ts` | Claude AI judge (already parameterized by judgeId) |
| `packages/orchestrator/src/judging/rubric-scorer.ts` | Automated scorer |
| `packages/orchestrator/src/judging/score-aggregator.ts` | `aggregate()` + `computeOverallScore()` |
| `packages/orchestrator/src/db/schema.ts` | Drizzle table definitions |
| `packages/orchestrator/src/db/repository.ts` | `saveResult()`, `getResult()`, `getEvents()` |
| `packages/orchestrator/src/server/routes/competitions.ts` | HTTP routes, event wiring |
| `packages/orchestrator/src/brief/presets.ts` | `applyPreset()` + PRESETS map |
| `packages/web/app/competitions/new/page.tsx` | Brief Builder form |
| `packages/web/app/competitions/[id]/page.tsx` | Live competition view |

## Current State Summary

- **State machine:** DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING → JUDGING → SCORED → COMPLETE (no SYNTHESIZING)
- **Judges:** 2 (automated + ai-claude). Both run on all deliverables.
- **Results table:** `competitionId`, `scorecards` (jsonb), `winnerId`, `summary`. No synthesis column.
- **Events endpoint:** WebSocket only (ws://). No HTTP GET /competitions/:id/events.
- **Format presets:** `applyPreset()` exists in presets.ts but is NOT called in the route — brief is used as-is.
- **Analytics:** No endpoint, no UI.

---

## Task 1: SYNTHESIZING State + DB Schema Migration

**What:** Add SYNTHESIZING to the state machine between SCORED and COMPLETE. Add a `synthesis` text column to the results table. Both are needed before any code uses them.

**Files:**
- Modify: `packages/shared/src/constants/states.ts`
- Modify: `packages/shared/src/constants/states.test.ts`
- Modify: `packages/orchestrator/src/db/schema.ts`
- Create: `packages/orchestrator/src/db/migrations/0003_add_synthesis.sql`
- Modify: `packages/orchestrator/src/db/repository.ts` (add synthesis to saveResult/getResult)

**Step 1: Update state machine in shared package**

Open `packages/shared/src/constants/states.ts`. Change it to:

```typescript
export enum CompetitionState {
  DRAFT = 'DRAFT',
  CONFIGURED = 'CONFIGURED',
  LAUNCHING = 'LAUNCHING',
  RUNNING = 'RUNNING',
  TIME_UP = 'TIME_UP',
  COLLECTING = 'COLLECTING',
  JUDGING = 'JUDGING',
  SCORED = 'SCORED',
  SYNTHESIZING = 'SYNTHESIZING',   // NEW
  COMPLETE = 'COMPLETE',
}

export const VALID_TRANSITIONS: Record<CompetitionState, CompetitionState[]> = {
  [CompetitionState.DRAFT]: [CompetitionState.CONFIGURED],
  [CompetitionState.CONFIGURED]: [CompetitionState.LAUNCHING],
  [CompetitionState.LAUNCHING]: [CompetitionState.RUNNING],
  [CompetitionState.RUNNING]: [CompetitionState.TIME_UP],
  [CompetitionState.TIME_UP]: [CompetitionState.COLLECTING],
  [CompetitionState.COLLECTING]: [CompetitionState.JUDGING],
  [CompetitionState.JUDGING]: [CompetitionState.SCORED],
  [CompetitionState.SCORED]: [CompetitionState.SYNTHESIZING],   // changed
  [CompetitionState.SYNTHESIZING]: [CompetitionState.COMPLETE], // NEW
  [CompetitionState.COMPLETE]: [],
};
```

**Step 2: Update the states test**

Open `packages/shared/src/constants/states.test.ts`. Add this test (keep existing tests):

```typescript
it('allows SCORED → SYNTHESIZING → COMPLETE', () => {
  expect(VALID_TRANSITIONS[CompetitionState.SCORED]).toContain(CompetitionState.SYNTHESIZING);
  expect(VALID_TRANSITIONS[CompetitionState.SYNTHESIZING]).toContain(CompetitionState.COMPLETE);
});

it('does not allow SCORED → COMPLETE directly', () => {
  expect(VALID_TRANSITIONS[CompetitionState.SCORED]).not.toContain(CompetitionState.COMPLETE);
});
```

**Step 3: Run the states test to verify it fails first**

```bash
npm run test --workspace=packages/shared -- --testPathPattern=states
```
Expected: FAIL (test about SCORED → SYNTHESIZING fails because SYNTHESIZING doesn't exist yet)

**Step 4: After implementing Step 1 above, run test again**

```bash
npm run test --workspace=packages/shared -- --testPathPattern=states
```
Expected: PASS

**Step 5: Update DB schema to add synthesis column**

Open `packages/orchestrator/src/db/schema.ts`. Add `synthesis` to the results table:

```typescript
export const results = pgTable('results', {
  competitionId: text('competition_id').primaryKey().references(() => competitions.id),
  scorecards:    jsonb('scorecards').notNull(),
  winnerId:      text('winner_id'),
  summary:       text('summary'),
  synthesis:     text('synthesis'),   // NEW: synthesized hybrid solution (markdown)
});
```

**Step 6: Create migration file**

Create `packages/orchestrator/src/db/migrations/0003_add_synthesis.sql`:

```sql
ALTER TABLE "results" ADD COLUMN "synthesis" text;
```

**Step 7: Update migration journal**

Open `packages/orchestrator/src/db/migrations/meta/_journal.json`. Add entry:

```json
{
  "idx": 3,
  "version": "7",
  "when": 1741521600000,
  "tag": "0003_add_synthesis",
  "breakpoints": true
}
```

**Step 8: Apply migration to local DB**

```bash
DATABASE_URL=postgresql://localhost/arena npx drizzle-kit migrate --config packages/orchestrator/drizzle.config.ts
```
Expected: "1 migration applied"

Verify:
```bash
/opt/homebrew/Cellar/postgresql@16/16.13/bin/psql arena -c "\d results"
```
Expected: `synthesis | text | ...` column appears

**Step 9: Update repository to include synthesis in saveResult/getResult**

Open `packages/orchestrator/src/db/repository.ts`. Find `saveResult` and update its type signature and implementation:

```typescript
async saveResult(
  competitionId: string,
  result: { scorecards: ScoreCard[]; winner: string | null; synthesis?: string | null },
): Promise<void> {
  await this.db.insert(results).values({
    competitionId,
    scorecards: result.scorecards as unknown as Record<string, unknown>[],
    winnerId: result.winner,
    synthesis: result.synthesis ?? null,
  });
}
```

Find `getResult` and update the return type to include synthesis. The SELECT already returns all columns, so just update the type:

```typescript
async getResult(competitionId: string): Promise<{
  competitionId: string;
  scorecards: ScoreCard[];
  winnerId: string | null;
  summary: string | null;
  synthesis: string | null;  // NEW
} | null> {
  const row = await this.db
    .select()
    .from(results)
    .where(eq(results.competitionId, competitionId))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!row) return null;
  return {
    competitionId: row.competitionId,
    scorecards: row.scorecards as unknown as ScoreCard[],
    winnerId: row.winnerId,
    summary: row.summary,
    synthesis: row.synthesis,
  };
}
```

**Step 10: Run typecheck to verify schema changes compile**

```bash
npm run typecheck --workspace=packages/orchestrator
```
Expected: 0 errors

**Step 11: Commit**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add packages/shared/src/constants/states.ts packages/shared/src/constants/states.test.ts
git add packages/orchestrator/src/db/schema.ts packages/orchestrator/src/db/migrations/0003_add_synthesis.sql packages/orchestrator/src/db/migrations/meta/_journal.json
git add packages/orchestrator/src/db/repository.ts
git commit -m "feat: add SYNTHESIZING state and synthesis column to results"
```

---

## Task 2: Synthesis Merge Engine

**What:** Build `merge-engine.ts` — a Claude-powered function that reads both teams' deliverables and produces a hybrid solution in markdown. This is the "killer feature" of Phase 2.

**Files:**
- Create: `packages/orchestrator/src/synthesis/merge-engine.ts`
- Create: `packages/orchestrator/src/synthesis/merge-engine.test.ts`

**Step 1: Write the failing test**

Create `packages/orchestrator/src/synthesis/merge-engine.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { synthesizeDeliverables } from './merge-engine.js';
import type { Deliverable, BriefInput } from '@arena/shared';
import { CompetitionFormat } from '@arena/shared';

// Mock child_process.spawn so tests don't actually call Claude
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require('node:events').EventEmitter;
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    // Simulate successful Claude response
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from('# Synthesis\n\nBest of both teams combined.'));
      child.emit('close', 0);
    }, 10);
    return child;
  }),
}));

const mockBrief: BriefInput = {
  id: 'test-brief',
  title: 'Test Brief',
  format: CompetitionFormat.SPRINT,
  problem: 'Write a hello world program',
  constraints: [],
  deliverables: ['solution.py'],
  timeLimitMs: 60000,
  rubric: {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  },
};

const teamA: Deliverable = {
  teamId: 'team-a',
  files: [{ path: 'solution.py', content: 'print("Hello, World!")' }],
};

const teamB: Deliverable = {
  teamId: 'team-b',
  files: [{ path: 'solution.py', content: 'print("Hello from Team B!")' }],
};

describe('synthesizeDeliverables', () => {
  it('returns a non-empty markdown string', async () => {
    const result = await synthesizeDeliverables(mockBrief, [teamA, teamB], {});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns null-safe fallback when no deliverables', async () => {
    const result = await synthesizeDeliverables(mockBrief, [], {});
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=merge-engine
```
Expected: FAIL — `merge-engine.ts` doesn't exist

**Step 3: Implement merge-engine.ts**

Create `packages/orchestrator/src/synthesis/merge-engine.ts`:

```typescript
import { spawn } from 'node:child_process';
import type { BriefInput, Deliverable } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';

export interface SynthesisOptions {
  /** Path to the claude CLI binary. Defaults to 'claude'. */
  claudeBin?: string;
}

/**
 * Synthesize the best elements from multiple team deliverables into a single
 * hybrid solution using Claude as the synthesis agent.
 *
 * Returns markdown text with attribution, or null if there are no deliverables
 * (e.g. both teams produced empty output).
 */
export async function synthesizeDeliverables(
  brief: BriefInput,
  deliverables: Deliverable[],
  options: SynthesisOptions,
): Promise<string | null> {
  const { claudeBin = 'claude' } = options;

  const nonEmpty = deliverables.filter((d) => d.files.length > 0);
  if (nonEmpty.length === 0) return null;

  const deliverablesSections = nonEmpty
    .map((d) => {
      const files = d.files
        .map((f) => `#### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
        .join('\n\n');
      return `### ${d.teamId} Deliverables\n\n${files}`;
    })
    .join('\n\n---\n\n');

  const criteriaList = brief.rubric.criteria
    .map((c) => `- **${c.id}**: ${c.description}`)
    .join('\n');

  const prompt = `You are a synthesis expert. ${nonEmpty.length} competing AI teams worked on the same problem and produced their best solutions. Your job is to create a hybrid that combines the strongest elements from each.

## Problem
${brief.problem}

## Rubric
${criteriaList}

## Team Submissions
${deliverablesSections}

## Your Task
1. Identify the 2-3 strongest elements from each team's submission
2. Create a synthesized solution that combines these elements into a coherent whole
3. For each major element you include, add an inline attribution comment like <!-- from: team-a --> or <!-- from: team-b -->

Return ONLY the synthesized solution as a markdown document. No preamble, no explanation outside the document itself. Start with a # heading.`;

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        ['--print', prompt, '--output-format', 'text', '--dangerously-skip-permissions'],
        { env: claudeEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let out = '';
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      child.on('close', (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Synthesis agent exited with code ${code}`));
      });
      child.on('error', reject);

      // Cap at 3 minutes — synthesis is post-competition, blocking COMPLETE
      setTimeout(() => {
        child.kill();
        reject(new Error('Synthesis timed out after 3 minutes'));
      }, 180_000);
    });

    return output || null;
  } catch (err) {
    console.error('[arena] synthesis failed:', (err as Error).message);
    return null; // Non-fatal — competition still completes
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=merge-engine
```
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add packages/orchestrator/src/synthesis/merge-engine.ts packages/orchestrator/src/synthesis/merge-engine.test.ts
git commit -m "feat: synthesis merge engine — Claude-powered deliverable fusion"
```

---

## Task 3: Wire Synthesis into Competition Runner

**What:** After SCORED, advance to SYNTHESIZING, call `synthesizeDeliverables()`, store the result, then advance to COMPLETE. The runner must hold onto deliverables through the judging phase.

**Files:**
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`

**Step 1: Write a test for the synthesis phase in competition-runner**

Open or create `packages/orchestrator/src/engine/competition-runner.test.ts`. Find the section that tests the full competition lifecycle and add:

```typescript
it('emits SYNTHESIZING state between SCORED and COMPLETE', async () => {
  const states: string[] = [];
  runner.on('stateChange', (s) => states.push(s));
  await runner.run();
  const synthesizingIdx = states.indexOf('SYNTHESIZING');
  const completeIdx = states.indexOf('COMPLETE');
  expect(synthesizingIdx).toBeGreaterThan(-1);
  expect(completeIdx).toBeGreaterThan(synthesizingIdx);
});

it('includes synthesis in the emitted result', async () => {
  const result = await runner.run();
  // synthesis may be null if adapters produce no files, but key must exist
  expect('synthesis' in result).toBe(true);
});
```

**Step 2: Run the test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=competition-runner
```
Expected: FAIL — no SYNTHESIZING state emitted, no synthesis in result

**Step 3: Update CompetitionResult type**

In `packages/orchestrator/src/engine/competition-runner.ts`, update the interface:

```typescript
export interface CompetitionResult {
  competition: Competition;
  scorecards: ScoreCard[];
  winner: string | null;
  synthesis: string | null;  // NEW
}
```

**Step 4: Import merge engine and update RunOptions**

Add to imports in `competition-runner.ts`:

```typescript
import { synthesizeDeliverables } from '../synthesis/merge-engine.js';
```

Add to `RunOptions`:

```typescript
/**
 * Skip synthesis phase (useful in tests or when Claude is unavailable).
 * Competition still reaches COMPLETE — synthesis field in result will be null.
 */
skipSynthesis?: boolean;
```

In the constructor, add to `this.options`:

```typescript
skipSynthesis: options.skipSynthesis ?? false,
```

**Step 5: Replace the SCORED/COMPLETE block in run()**

Find the block:
```typescript
// ── SCORED / COMPLETE ─────────────────────────────────────────────────
this.advance(CompetitionState.SCORED);
this.advance(CompetitionState.COMPLETE);
this.competition.completedAt = new Date().toISOString();
```

Replace with:
```typescript
// ── SCORED ───────────────────────────────────────────────────────────
this.advance(CompetitionState.SCORED);

// ── SYNTHESIZING ─────────────────────────────────────────────────────
this.advance(CompetitionState.SYNTHESIZING);
let synthesis: string | null = null;
if (!this.options.skipSynthesis) {
  console.log('[arena] synthesizing deliverables...');
  synthesis = await synthesizeDeliverables(brief, deliverables, {
    claudeBin: this.options.claudeBin,
  });
}

// ── COMPLETE ──────────────────────────────────────────────────────────
this.advance(CompetitionState.COMPLETE);
this.competition.completedAt = new Date().toISOString();
```

Also update the result object at the end of run():
```typescript
const result: CompetitionResult = {
  competition: { ...this.competition },
  scorecards,
  winner: scorecards.find((c) => c.rank === 1)?.teamId ?? null,
  synthesis,   // NEW
};
```

**Step 6: Update competition route to pass synthesis to saveResult**

Open `packages/orchestrator/src/server/routes/competitions.ts`. Find the `result` event listener:

```typescript
runner.on('result', (result) => {
  repo.saveResult(competitionId, {
    scorecards: result.scorecards,
    winner: result.winner,
  }).catch(console.error);
});
```

Update to:
```typescript
runner.on('result', (result) => {
  repo.saveResult(competitionId, {
    scorecards: result.scorecards,
    winner: result.winner,
    synthesis: result.synthesis,   // NEW
  }).catch(console.error);
});
```

**Step 7: Run tests**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=competition-runner
```
Expected: PASS (new tests pass because runner now emits SYNTHESIZING and includes synthesis)

**Step 8: Run full test suite to check for regressions**

```bash
npm run test --workspace=packages/orchestrator
```
Expected: All tests pass

**Step 9: Typecheck**

```bash
npm run typecheck --workspace=packages/orchestrator
```
Expected: 0 errors

**Step 10: Commit**

```bash
git add packages/orchestrator/src/engine/competition-runner.ts packages/orchestrator/src/server/routes/competitions.ts
git commit -m "feat: wire synthesis phase into competition runner (SCORED → SYNTHESIZING → COMPLETE)"
```

---

## Task 4: Expose Synthesis in API + Show in Competition UI

**What:** The GET /competitions/:id endpoint should return synthesis in the result object. The live competition page should show a synthesis panel after the competition completes.

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts` (result already includes synthesis via getResult)
- Modify: `packages/web/app/competitions/[id]/page.tsx`

**Step 1: Verify synthesis is returned by GET /competitions/:id**

The route already calls `repo.getResult(id)` and returns it. Since `getResult` now returns `synthesis`, it's automatically included. Verify by checking the GET /:id handler:

```typescript
// In routes/competitions.ts around the GET /:id handler
const [eventCount, result] = await Promise.all([
  repo.countEvents(id),
  repo.getResult(id),
]);
res.json({ id, state: comp.state, eventCount, result });
```

`result` will now include `{ ..., synthesis: string | null }`. No change needed to the route.

**Step 2: Update the competition view to display synthesis**

Open `packages/web/app/competitions/[id]/page.tsx`.

Find where the scoreboard is displayed after COMPLETE. After the scoreboard section, add a synthesis panel. The state type will need to include synthesis from the result.

Find the result state type (likely something like `result: { scorecards, winnerId, ... } | null`). Update it to include synthesis:

```typescript
// Update the result type in useState (wherever result is stored):
const [result, setResult] = useState<{
  scorecards: Array<{
    rank: number;
    teamId: string;
    finalScore: number;
    criteriaScores?: Array<{ criterionId: string; score: number; commentary: string }>;
  }>;
  winnerId: string | null;
  synthesis: string | null;  // NEW
} | null>(null);
```

When the WebSocket receives a `result` message, make sure the synthesis field is included in the parsed data (it's passed through the WebSocket from the server, so verify in websocket.ts that the result is forwarded as-is).

After the scoreboard JSX, add:

```tsx
{result?.synthesis && (
  <div className="mt-8 border border-purple-800 rounded-lg overflow-hidden">
    <div className="bg-purple-900/30 px-4 py-3 border-b border-purple-800 flex items-center gap-2">
      <span className="text-purple-400 font-mono text-xs font-bold tracking-widest uppercase">
        ✦ Synthesis
      </span>
      <span className="text-slate-400 text-xs ml-2">
        Best elements from both teams, combined by the synthesis agent
      </span>
    </div>
    <div className="p-6 bg-slate-900">
      <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
        {result.synthesis}
      </pre>
    </div>
  </div>
)}
```

**Step 3: Check the WebSocket server passes synthesis through**

Open `packages/orchestrator/src/server/websocket.ts`. Find the `onResult` handler that sends the result to clients. Make sure the synthesis field is included when the result is sent. It should already be there if the `normalizeResult()` function passes through all fields. If not, update `normalizeResult()` to include `synthesis`:

```typescript
function normalizeResult(result: CompetitionResult) {
  return {
    winnerId: result.winner,
    synthesis: result.synthesis,   // ensure this is included
    teams: result.scorecards.map((sc) => ({
      teamId: sc.teamId,
      rank: sc.rank,
      finalScore: sc.finalScore,
      judgeResults: sc.judgeResults,
    })),
  };
}
```

**Step 4: Also expose synthesis from getResult in the HTTP route**

The GET /competitions/:id HTTP route returns `result` which now includes synthesis from the repository. No change needed.

**Step 5: Typecheck web package**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```
Expected: 0 errors

**Step 6: Commit**

```bash
git add packages/web/app/competitions/[id]/page.tsx packages/orchestrator/src/server/websocket.ts
git commit -m "feat: show synthesis output in competition view"
```

---

## Task 5: Neutral Second AI Judge

**What:** Run a second AI judge with a deliberately critical lens ("adversarial judge") to surface weaknesses the first judge might miss. This judge uses the same `aiJudge()` function but with a different system prompt injected via a different judgeId. Adds a `judgeCount` option to RunOptions.

**Files:**
- Modify: `packages/orchestrator/src/judging/ai-judge.ts`
- Modify: `packages/orchestrator/src/engine/competition-runner.ts`
- Modify: `packages/orchestrator/src/judging/ai-judge.test.ts` (if it exists, else create)

**Step 1: Write test for neutral judge**

Create or open `packages/orchestrator/src/judging/ai-judge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { aiJudge, buildJudgePrompt } from './ai-judge.js';

describe('buildJudgePrompt', () => {
  const rubric = {
    criteria: [{ id: 'correctness', description: 'Correct', weight: 1, maxScore: 10 }],
  };
  const deliverable = {
    teamId: 'team-a',
    files: [{ path: 'solution.py', content: 'print("hello")' }],
  };

  it('includes adversarial instructions when judgeId contains "adversarial"', () => {
    const prompt = buildJudgePrompt(deliverable, rubric, 'ai-adversarial');
    expect(prompt).toContain('weaknesses');
  });

  it('uses standard instructions for default judge', () => {
    const prompt = buildJudgePrompt(deliverable, rubric, 'ai-claude');
    expect(prompt).not.toContain('weaknesses');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=ai-judge
```
Expected: FAIL — `buildJudgePrompt` is not exported

**Step 3: Refactor ai-judge.ts to export buildJudgePrompt**

Open `packages/orchestrator/src/judging/ai-judge.ts`. Extract the prompt-building logic into an exported function:

```typescript
export const JUDGE_IDS = {
  automated: 'automated',
  aiClaude: 'ai-claude',
  aiAdversarial: 'ai-adversarial',   // NEW
} as const;

/**
 * Build the prompt for the AI judge. Exported for testing.
 * When judgeId contains 'adversarial', adds critical evaluation instructions.
 */
export function buildJudgePrompt(
  deliverable: Deliverable,
  rubric: Rubric,
  judgeId: string,
): string {
  const criteriaList = rubric.criteria
    .map((c) => `- ${c.id}: ${c.description} (max ${c.maxScore} points)`)
    .join('\n');

  const filesText = deliverable.files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  const adversarialClause = judgeId.includes('adversarial')
    ? '\n\nIMPORTANT: You are an adversarial judge. Look for weaknesses, gaps, and missed edge cases. Score critically — be specific about what is missing or wrong.'
    : '';

  return `You are an impartial competition judge. Evaluate the following deliverable against each rubric criterion.${adversarialClause}

## Rubric Criteria
${criteriaList}

## Deliverable Files
${filesText || '(no files submitted)'}

## Instructions
Return ONLY a JSON object with this exact shape (no markdown, no prose):
{
  "scores": [
    { "criterionId": "<id>", "score": <number 0–maxScore>, "commentary": "<1–2 sentences>" }
  ]
}`;
}
```

Then update `aiJudge()` to use `buildJudgePrompt()`:

```typescript
export async function aiJudge(
  deliverable: Deliverable,
  rubric: Rubric,
  options: AiJudgeOptions,
): Promise<JudgeResult> {
  const { judgeId, claudeBin = 'claude' } = options;
  const prompt = buildJudgePrompt(deliverable, rubric, judgeId);
  // ... rest of the function unchanged, just replace the inline prompt with the variable
```

**Step 4: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=ai-judge
```
Expected: PASS

**Step 5: Add aiJudgeCount to RunOptions and wire second judge**

In `packages/orchestrator/src/engine/competition-runner.ts`:

Add to `RunOptions`:
```typescript
/** Number of AI judges to spawn per deliverable. Default 1. Max 2. */
aiJudgeCount?: 1 | 2;
```

Add to `this.options` defaults:
```typescript
aiJudgeCount: options.aiJudgeCount ?? 1,
```

In the JUDGING section, replace:
```typescript
const judgeResults = await Promise.all([
  ...deliverables.map((d) => scoreDeliverable(JUDGE_IDS.automated, d, brief.rubric, brief)),
  ...deliverables.map((d) => aiJudge(d, brief.rubric, {
    judgeId: JUDGE_IDS.aiClaude,
    claudeBin: this.options.claudeBin,
  })),
]);
```

With:
```typescript
const aiJudgePromises = [
  ...deliverables.map((d) => aiJudge(d, brief.rubric, {
    judgeId: JUDGE_IDS.aiClaude,
    claudeBin: this.options.claudeBin,
  })),
];

// Second AI judge with adversarial lens (critical evaluation)
if (this.options.aiJudgeCount >= 2) {
  aiJudgePromises.push(
    ...deliverables.map((d) => aiJudge(d, brief.rubric, {
      judgeId: JUDGE_IDS.aiAdversarial,
      claudeBin: this.options.claudeBin,
    })),
  );
}

const judgeResults = await Promise.all([
  ...deliverables.map((d) => scoreDeliverable(JUDGE_IDS.automated, d, brief.rubric, brief)),
  ...aiJudgePromises,
]);
```

**Step 6: Run full test suite**

```bash
npm run test --workspace=packages/orchestrator
```
Expected: All tests pass

**Step 7: Typecheck**

```bash
npm run typecheck --workspace=packages/orchestrator
```

**Step 8: Commit**

```bash
git add packages/orchestrator/src/judging/ai-judge.ts packages/orchestrator/src/engine/competition-runner.ts
git add packages/orchestrator/src/judging/ai-judge.test.ts
git commit -m "feat: neutral adversarial AI judge + aiJudgeCount option"
```

---

## Task 6: Format Preset Picker in Brief Builder

**What:** Add a "Start from preset" dropdown to the Brief Builder that populates form fields with preset defaults for SPRINT, HACKATHON, RELAY_RACE, and RED_VS_BLUE. Wire `applyPreset()` in the competition route so the server also applies format defaults.

**Files:**
- Modify: `packages/web/app/competitions/new/page.tsx`
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`

**Step 1: Add preset constants to Brief Builder**

Open `packages/web/app/competitions/new/page.tsx`. Add preset defaults near the top of the file (before the component):

```typescript
type Format = 'SPRINT' | 'HACKATHON' | 'RELAY_RACE' | 'RED_VS_BLUE';

const FORMAT_PRESETS: Record<Format, {
  timeLimitMins: number;
  constraints: string;
  deliverables: string;
  criteria: Array<{ id: string; description: string; maxScore: number; weight: number }>;
}> = {
  SPRINT: {
    timeLimitMins: 15,
    constraints: 'Stay within the time limit.',
    deliverables: 'solution.md',
    criteria: [
      { id: 'correctness', description: 'Solution is correct', maxScore: 10, weight: 0.5 },
      { id: 'quality', description: 'Code / writing quality', maxScore: 10, weight: 0.3 },
      { id: 'speed', description: 'Delivered promptly', maxScore: 10, weight: 0.2 },
    ],
  },
  HACKATHON: {
    timeLimitMins: 120,
    constraints: 'Use only approved libraries.',
    deliverables: 'README.md\nsource code',
    criteria: [
      { id: 'innovation', description: 'Creative and novel approach', maxScore: 10, weight: 0.35 },
      { id: 'completeness', description: 'Deliverables are complete', maxScore: 10, weight: 0.35 },
      { id: 'presentation', description: 'README and docs are clear', maxScore: 10, weight: 0.3 },
    ],
  },
  RELAY_RACE: {
    timeLimitMins: 30,
    constraints: 'Do not redo prior work. Build on what the previous agent produced.',
    deliverables: 'incremental solution',
    criteria: [
      { id: 'continuity', description: 'Builds coherently on prior work', maxScore: 10, weight: 0.4 },
      { id: 'correctness', description: 'Incremental output is correct', maxScore: 10, weight: 0.4 },
      { id: 'clarity', description: 'Handoff notes are clear', maxScore: 10, weight: 0.2 },
    ],
  },
  RED_VS_BLUE: {
    timeLimitMins: 60,
    constraints: 'Stay within the defined scope. Document all findings.',
    deliverables: 'attack/defense report',
    criteria: [
      { id: 'effectiveness', description: 'Attack or defense is effective', maxScore: 10, weight: 0.5 },
      { id: 'documentation', description: 'Report documents findings clearly', maxScore: 10, weight: 0.3 },
      { id: 'scope', description: 'Stays within defined scope', maxScore: 10, weight: 0.2 },
    ],
  },
};
```

**Step 2: Update format state type and add applyPreset handler**

In the component, update the format state:

```typescript
const [format, setFormat] = useState<Format>('SPRINT');
```

Add an `applyPreset` handler:

```typescript
const applyPreset = (selectedFormat: Format) => {
  setFormat(selectedFormat);
  const preset = FORMAT_PRESETS[selectedFormat];
  setTimeLimitMins(preset.timeLimitMins);
  setConstraints(preset.constraints);
  setDeliverables(preset.deliverables);
  setCriteria(preset.criteria);
};
```

**Step 3: Add preset picker to the form JSX**

Near the top of the form (before the title input), add:

```tsx
<div className="mb-6">
  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">
    Start From Preset
  </label>
  <div className="flex gap-2 flex-wrap">
    {(['SPRINT', 'HACKATHON', 'RELAY_RACE', 'RED_VS_BLUE'] as Format[]).map((f) => (
      <button
        key={f}
        type="button"
        onClick={() => applyPreset(f)}
        className={`px-3 py-1.5 rounded text-xs font-mono font-bold border transition-colors ${
          format === f
            ? 'bg-orange-500/20 border-orange-500 text-orange-400'
            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
        }`}
      >
        {f.replace('_', ' ')}
      </button>
    ))}
  </div>
  <p className="text-slate-500 text-xs mt-1">
    Selecting a preset fills in defaults you can then customize.
  </p>
</div>
```

Also update the format select (already in the form) to call applyPreset instead of setFormat:

```tsx
<select value={format} onChange={(e) => applyPreset(e.target.value as Format)}>
  <option value="SPRINT">Sprint</option>
  <option value="HACKATHON">Hackathon</option>
  <option value="RELAY_RACE">Relay Race</option>
  <option value="RED_VS_BLUE">Red vs Blue</option>
</select>
```

**Step 4: Wire applyPreset() in the competition route**

Open `packages/orchestrator/src/server/routes/competitions.ts`. Find where the brief is used after validation. Add preset application:

```typescript
import { applyPreset } from '../../brief/presets.js';
import { CompetitionFormat } from '@arena/shared';

// After briefResult.success check:
const rawBrief = briefResult.data;
// Apply format preset defaults for any unset fields
const mergedBrief = rawBrief.format
  ? applyPreset(rawBrief.format as CompetitionFormat, rawBrief as Record<string, unknown>)
  : rawBrief;
```

Then use `mergedBrief` instead of `briefResult.data` when creating the runner:

```typescript
const runner = new CompetitionRunner(mergedBrief, teams, options);
await repo.create(competitionId, mergedBrief, teams);
```

**Step 5: Typecheck both packages**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```
Expected: 0 errors

**Step 6: Commit**

```bash
git add packages/web/app/competitions/new/page.tsx packages/orchestrator/src/server/routes/competitions.ts
git commit -m "feat: format preset picker in Brief Builder + server-side applyPreset"
```

---

## Task 7: GET /competitions/:id/events HTTP Endpoint

**What:** Add an HTTP endpoint that returns all stored events for a competition in seq order. This is needed by the replay viewer (Task 8) and for any client that wants the full event history without WebSocket.

**Files:**
- Modify: `packages/orchestrator/src/server/routes/competitions.ts`
- Create: `packages/web/app/api/competitions/[id]/events/route.ts`

**Step 1: Add GET /:id/events to the competition router**

Open `packages/orchestrator/src/server/routes/competitions.ts`. After the GET /:id route, add:

```typescript
// GET /competitions/:id/events — full event history for replay
competitionsRouter.get('/:id/events', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const afterSeq = req.query.afterSeq ? Number(req.query.afterSeq) : undefined;

  const comp = await repo.getCompetition(id);
  if (!comp) {
    res.status(404).json({ error: 'Competition not found' });
    return;
  }

  const evts = await repo.getEvents(id, afterSeq);
  res.json(evts);
});
```

**Step 2: Add Next.js proxy route**

Create `packages/web/app/api/competitions/[id]/events/route.ts`:

```typescript
import { orchestratorUrl, orchestratorHeaders } from '../../../../../lib/orchestrator';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const res = await fetch(
    orchestratorUrl(`/competitions/${params.id}/events`),
    { headers: orchestratorHeaders() },
  );
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

**Step 3: Manual smoke test**

With the orchestrator running:
```bash
curl -s "http://localhost:3000/competitions/50ccbcaf-8ce7-4fdf-81e7-735bfc50a584/events" | python3 -c "import sys,json; events=json.load(sys.stdin); print(f'{len(events)} events, first seq={events[0][\"seq\"] if events else \"N/A\"}')"
```
Expected: `42 events, first seq=1` (or similar)

**Step 4: Test afterSeq cursor**

```bash
curl -s "http://localhost:3000/competitions/50ccbcaf-8ce7-4fdf-81e7-735bfc50a584/events?afterSeq=10" | python3 -c "import sys,json; events=json.load(sys.stdin); print(f'{len(events)} events after seq 10')"
```
Expected: Fewer than 42 events

**Step 5: Typecheck**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

**Step 6: Commit**

```bash
git add packages/orchestrator/src/server/routes/competitions.ts
git add packages/web/app/api/competitions/[id]/events/route.ts
git commit -m "feat: GET /competitions/:id/events endpoint for replay"
```

---

## Task 8: Replay Viewer Web Page

**What:** A dedicated web page at `/competitions/[id]/replay` that fetches all events and replays them at configurable speed with playback controls (play/pause, 1x/2x/4x speed, progress scrubber).

**Files:**
- Create: `packages/web/app/competitions/[id]/replay/page.tsx`

**Step 1: Create the replay page**

Create `packages/web/app/competitions/[id]/replay/page.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface ArenaEvent {
  id: string;
  competitionId: string;
  teamId: string;
  timestamp: string;
  type: string;
  payload: Record<string, unknown> | null;
  seq: number;
}

const EVENT_COLORS: Record<string, string> = {
  TOOL_CALL: 'text-blue-400',
  FILE_CREATE: 'text-green-400',
  FILE_MODIFY: 'text-yellow-400',
  ERROR: 'text-red-400',
  REASONING: 'text-slate-400',
  TIME_WARNING: 'text-orange-400',
  TIME_UP: 'text-red-500',
  JUDGE_SCORE: 'text-purple-400',
  COMPETITION_START: 'text-cyan-400',
  COMPETITION_COMPLETE: 'text-cyan-400',
  DEFAULT: 'text-slate-500',
};

const SPEEDS = [1, 2, 4, 10] as const;
type Speed = (typeof SPEEDS)[number];

export default function ReplayPage() {
  const { id } = useParams<{ id: string }>();
  const [allEvents, setAllEvents] = useState<ArenaEvent[]>([]);
  const [visibleEvents, setVisibleEvents] = useState<ArenaEvent[]>([]);
  const [cursor, setCursor] = useState(0); // index into allEvents
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const teamARef = useRef<HTMLDivElement>(null);
  const teamBRef = useRef<HTMLDivElement>(null);

  // Fetch all events on mount
  useEffect(() => {
    fetch(`/api/competitions/${id}/events`)
      .then((r) => r.json())
      .then((events: ArenaEvent[]) => {
        setAllEvents(events);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Playback loop — advances cursor based on speed
  const tick = useCallback(() => {
    setCursor((prev) => {
      const next = Math.min(prev + speed, allEvents.length);
      setVisibleEvents(allEvents.slice(0, next));
      if (next >= allEvents.length) {
        setPlaying(false);
      }
      return next;
    });
  }, [allEvents, speed]);

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(tick, 200); // 5 ticks/sec × speed events/tick
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, tick]);

  // Auto-scroll lanes
  useEffect(() => {
    teamARef.current?.scrollTo({ top: teamARef.current.scrollHeight, behavior: 'smooth' });
    teamBRef.current?.scrollTo({ top: teamBRef.current.scrollHeight, behavior: 'smooth' });
  }, [visibleEvents]);

  const handleScrub = (value: number) => {
    const idx = Math.round(value);
    setCursor(idx);
    setVisibleEvents(allEvents.slice(0, idx));
  };

  const teams = [...new Set(allEvents.map((e) => e.teamId))].sort();
  const teamA = teams[0] ?? 'team-a';
  const teamB = teams[1] ?? 'team-b';

  const eventsForTeam = (teamId: string) =>
    visibleEvents.filter((e) => e.teamId === teamId);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        Loading replay...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-red-400 font-mono text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-mono flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <a href={`/competitions/${id}`} className="text-slate-500 hover:text-slate-300 text-sm">
          ← Back to Live View
        </a>
        <span className="text-slate-600">|</span>
        <span className="text-orange-400 font-bold text-sm tracking-widest uppercase">
          ▶ Replay
        </span>
        <span className="text-slate-500 text-xs ml-auto">
          {allEvents.length} events total
        </span>
      </div>

      {/* Controls */}
      <div className="px-6 py-3 border-b border-slate-800 flex items-center gap-4">
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={cursor >= allEvents.length && !playing}
          className="px-4 py-1.5 rounded text-xs font-bold border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40"
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>

        <button
          onClick={() => { setCursor(0); setVisibleEvents([]); setPlaying(false); }}
          className="px-3 py-1.5 rounded text-xs border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-400"
        >
          ↩ Reset
        </button>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                speed === s
                  ? 'border-orange-500 bg-orange-500/20 text-orange-400'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex-1 flex items-center gap-2">
          <span className="text-slate-500 text-xs">{cursor}</span>
          <input
            type="range"
            min={0}
            max={allEvents.length}
            value={cursor}
            onChange={(e) => handleScrub(Number(e.target.value))}
            className="flex-1 accent-orange-500"
          />
          <span className="text-slate-500 text-xs">{allEvents.length}</span>
        </div>
      </div>

      {/* Lane view */}
      <div className="flex-1 grid grid-cols-2 gap-0 min-h-0">
        {[teamA, teamB].map((teamId, idx) => (
          <div
            key={teamId}
            className={`flex flex-col min-h-0 ${idx === 0 ? 'border-r border-slate-800' : ''}`}
          >
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900 flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${idx === 0 ? 'bg-orange-400' : 'bg-blue-400'}`}
              />
              <span className="text-xs font-bold">{teamId}</span>
              <span className="text-slate-600 text-xs ml-auto">
                {eventsForTeam(teamId).length} events
              </span>
            </div>
            <div
              ref={idx === 0 ? teamARef : teamBRef}
              className="flex-1 overflow-y-auto p-3 space-y-0.5"
            >
              {eventsForTeam(teamId).map((event) => (
                <div key={event.id} className="flex gap-2 text-xs py-0.5">
                  <span className="text-slate-600 min-w-[40px] font-mono">
                    {event.seq}
                  </span>
                  <span
                    className={`font-bold min-w-[120px] ${
                      EVENT_COLORS[event.type] ?? EVENT_COLORS.DEFAULT
                    }`}
                  >
                    {event.type}
                  </span>
                  <span className="text-slate-500 truncate">
                    {event.payload
                      ? JSON.stringify(event.payload).slice(0, 80)
                      : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Add a "Replay" link to the competition view**

Open `packages/web/app/competitions/[id]/page.tsx`. In the header area (near the competition ID or state badge), add:

```tsx
<a
  href={`/competitions/${params.id}/replay`}
  className="text-xs text-slate-500 hover:text-slate-300 border border-slate-700 rounded px-2 py-1 font-mono"
>
  ▶ Replay
</a>
```

Also add to the gallery cards in `packages/web/app/page.tsx` (optional: "Replay" link on COMPLETE competitions):

```tsx
{comp.state === 'COMPLETE' && (
  <a
    href={`/competitions/${comp.id}/replay`}
    onClick={(e) => e.stopPropagation()}
    className="text-xs text-slate-500 hover:text-orange-400 font-mono"
  >
    ▶ Replay
  </a>
)}
```

**Step 3: Typecheck web**

```bash
npx tsc --noEmit -p packages/web/tsconfig.json
```
Expected: 0 errors

**Step 4: Smoke test**

With orchestrator + web running:
1. Go to `http://localhost:3001/competitions/<smoke-test-id>/replay`
2. Verify events load
3. Click Play — events should appear in both lanes progressively
4. Try 4× speed — events advance faster
5. Drag scrubber — events jump to that position
6. Click Reset — lanes clear

**Step 5: Commit**

```bash
git add packages/web/app/competitions/[id]/replay/page.tsx
git add packages/web/app/competitions/[id]/page.tsx packages/web/app/page.tsx
git commit -m "feat: replay viewer with playback controls (play/pause/speed/scrub)"
```

---

## Task 9: Analytics Endpoint + Dashboard

**What:** A GET /analytics endpoint that aggregates competition data from Postgres. A web dashboard at `/analytics` showing win rates by model, completion rate, and top events.

**Files:**
- Create: `packages/orchestrator/src/analytics/stats-aggregator.ts`
- Create: `packages/orchestrator/src/analytics/stats-aggregator.test.ts`
- Modify: `packages/orchestrator/src/server/app.ts` (mount analytics router)
- Create: `packages/orchestrator/src/server/routes/analytics.ts`
- Create: `packages/web/app/api/analytics/route.ts`
- Create: `packages/web/app/analytics/page.tsx`

**Step 1: Write test for stats aggregator**

Create `packages/orchestrator/src/analytics/stats-aggregator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeWinRate, computeCompletionRate } from './stats-aggregator.js';

describe('computeWinRate', () => {
  it('counts wins and totals correctly', () => {
    const competitions = [
      { teams: JSON.stringify([{ id: 'team-a', model: 'claude:speedrunner' }, { id: 'team-b', model: 'gemini:architect' }]) },
      { teams: JSON.stringify([{ id: 'team-a', model: 'claude:architect' }, { id: 'team-b', model: 'codex:speedrunner' }]) },
    ];
    const results = [
      { competitionId: 'c1', winnerId: 'team-a' },
      { competitionId: 'c2', winnerId: 'team-b' },
    ];
    const rates = computeWinRate(competitions as never, results as never);
    expect(rates['claude'].wins).toBe(1);
    expect(rates['claude'].total).toBe(2);
    expect(rates['gemini'].wins).toBe(0);
    expect(rates['gemini'].total).toBe(1);
    expect(rates['codex'].wins).toBe(1);
    expect(rates['codex'].total).toBe(1);
  });

  it('returns empty object for no competitions', () => {
    expect(computeWinRate([], [])).toEqual({});
  });
});

describe('computeCompletionRate', () => {
  it('calculates ratio of COMPLETE competitions', () => {
    const comps = [
      { state: 'COMPLETE' },
      { state: 'COMPLETE' },
      { state: 'RUNNING' },
    ];
    expect(computeCompletionRate(comps as never)).toBeCloseTo(2 / 3);
  });

  it('returns 0 for empty', () => {
    expect(computeCompletionRate([])).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=stats-aggregator
```
Expected: FAIL — module not found

**Step 3: Implement stats-aggregator.ts**

Create `packages/orchestrator/src/analytics/stats-aggregator.ts`:

```typescript
/** Row shape from the competitions table (only the fields we need). */
interface CompetitionRow {
  id: string;
  teams: unknown;  // jsonb → parse as Team[]
  state: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

interface ResultRow {
  competitionId: string;
  winnerId: string | null;
}

export interface ModelStats {
  model: string;
  wins: number;
  total: number;
  winRate: number;
}

interface TeamInRow {
  id: string;
  model: string;
}

/** Extract model prefix from team.model string (e.g. 'claude:speedrunner' → 'claude'). */
function modelPrefix(model: string): string {
  return model.split(':')[0] ?? model;
}

/**
 * Compute win rates per model prefix from raw DB rows.
 * Returns a map of model → { wins, total }.
 */
export function computeWinRate(
  competitions: CompetitionRow[],
  results: ResultRow[],
): Record<string, { wins: number; total: number }> {
  const resultMap = new Map(results.map((r) => [r.competitionId, r.winnerId]));
  const stats: Record<string, { wins: number; total: number }> = {};

  for (const comp of competitions) {
    const teams = comp.teams as TeamInRow[];
    const winnerId = resultMap.get(comp.id) ?? null;

    for (const team of teams) {
      const model = modelPrefix(team.model);
      if (!stats[model]) stats[model] = { wins: 0, total: 0 };
      stats[model].total += 1;
      if (team.id === winnerId) stats[model].wins += 1;
    }
  }

  return stats;
}

/**
 * Compute the fraction of competitions that reached COMPLETE state.
 */
export function computeCompletionRate(competitions: CompetitionRow[]): number {
  if (competitions.length === 0) return 0;
  const completed = competitions.filter((c) => c.state === 'COMPLETE').length;
  return completed / competitions.length;
}

/**
 * Compute average duration in ms for COMPLETE competitions.
 * Returns null if no completed competitions exist.
 */
export function computeAvgDurationMs(competitions: CompetitionRow[]): number | null {
  const completed = competitions.filter(
    (c) => c.state === 'COMPLETE' && c.startedAt && c.completedAt,
  );
  if (completed.length === 0) return null;
  const total = completed.reduce((sum, c) => {
    return sum + (c.completedAt!.getTime() - c.startedAt!.getTime());
  }, 0);
  return Math.round(total / completed.length);
}
```

**Step 4: Run test to verify it passes**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=stats-aggregator
```
Expected: PASS (4 tests)

**Step 5: Create analytics route**

Create `packages/orchestrator/src/server/routes/analytics.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import { repo } from '../repo.js';
import { computeWinRate, computeCompletionRate, computeAvgDurationMs } from '../../analytics/stats-aggregator.js';

export const analyticsRouter = Router();

analyticsRouter.get('/summary', async (_req: Request, res: Response) => {
  // Fetch all competitions (up to 200 for aggregation — enough for Phase 2 meta-dataset)
  const competitions = await repo.list(200);

  // Fetch results for completed competitions
  const results = await Promise.all(
    competitions
      .filter((c) => c.state === 'COMPLETE')
      .map((c) => repo.getResult(c.id)),
  );
  const validResults = results.filter(Boolean) as Array<{
    competitionId: string;
    winnerId: string | null;
    scorecards: unknown[];
    summary: string | null;
    synthesis: string | null;
  }>;

  const winRates = computeWinRate(competitions as never, validResults as never);
  const completionRate = computeCompletionRate(competitions as never);
  const avgDurationMs = computeAvgDurationMs(competitions as never);

  const modelStats = Object.entries(winRates).map(([model, { wins, total }]) => ({
    model,
    wins,
    total,
    winRate: total > 0 ? Number((wins / total).toFixed(3)) : 0,
  })).sort((a, b) => b.winRate - a.winRate);

  res.json({
    totalCompetitions: competitions.length,
    completedCompetitions: competitions.filter((c) => c.state === 'COMPLETE').length,
    completionRate: Number(completionRate.toFixed(3)),
    avgDurationMs,
    byModel: modelStats,
    synthesisCount: validResults.filter((r) => r.synthesis).length,
  });
});
```

**Step 6: Mount analytics router in app.ts**

Open `packages/orchestrator/src/server/app.ts`. Add:

```typescript
import { analyticsRouter } from './routes/analytics.js';

// Inside createApp(), alongside competitionsRouter:
app.use('/analytics', analyticsRouter);
```

**Step 7: Create Next.js proxy route for analytics**

Create `packages/web/app/api/analytics/route.ts`:

```typescript
import { orchestratorUrl, orchestratorHeaders } from '../../../lib/orchestrator';

export async function GET() {
  const res = await fetch(orchestratorUrl('/analytics/summary'), {
    headers: orchestratorHeaders(),
  });
  const data = await res.json();
  return Response.json(data, { status: res.status });
}
```

**Step 8: Create analytics dashboard page**

Create `packages/web/app/analytics/page.tsx`:

```tsx
import { orchestratorUrl } from '../../lib/orchestrator';

interface ModelStat {
  model: string;
  wins: number;
  total: number;
  winRate: number;
}

interface AnalyticsSummary {
  totalCompetitions: number;
  completedCompetitions: number;
  completionRate: number;
  avgDurationMs: number | null;
  byModel: ModelStat[];
  synthesisCount: number;
}

async function getAnalytics(): Promise<AnalyticsSummary | null> {
  try {
    const res = await fetch(orchestratorUrl('/analytics/summary'), {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export default async function AnalyticsPage() {
  const data = await getAnalytics();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-mono p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-center gap-4">
          <a href="/" className="text-slate-500 hover:text-slate-300 text-sm">← Gallery</a>
          <h1 className="text-orange-400 font-bold tracking-widest uppercase text-sm">
            ◆ Analytics
          </h1>
        </div>

        {!data ? (
          <div className="text-slate-500 text-sm">
            Could not reach orchestrator. Is it running?
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
              {[
                { label: 'Total', value: data.totalCompetitions },
                { label: 'Completed', value: data.completedCompetitions },
                { label: 'Avg Duration', value: formatDuration(data.avgDurationMs) },
                { label: 'Syntheses', value: data.synthesisCount },
              ].map(({ label, value }) => (
                <div key={label} className="border border-slate-800 rounded-lg p-4 bg-slate-900">
                  <div className="text-slate-500 text-xs uppercase tracking-widest mb-1">{label}</div>
                  <div className="text-2xl font-bold text-slate-100">{value}</div>
                </div>
              ))}
            </div>

            {/* Win rates by model */}
            <div className="border border-slate-800 rounded-lg overflow-hidden">
              <div className="bg-slate-900 px-4 py-3 border-b border-slate-800">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                  Win Rate by Model
                </span>
              </div>
              {data.byModel.length === 0 ? (
                <div className="p-6 text-slate-500 text-sm text-center">
                  No completed competitions yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-4 py-2 text-slate-500 text-xs uppercase">Model</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Wins</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Total</th>
                      <th className="text-right px-4 py-2 text-slate-500 text-xs uppercase">Win Rate</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModel.map((stat) => (
                      <tr key={stat.model} className="border-b border-slate-800/50 hover:bg-slate-900/50">
                        <td className="px-4 py-3 text-orange-400 font-bold">{stat.model}</td>
                        <td className="px-4 py-3 text-right text-slate-300">{stat.wins}</td>
                        <td className="px-4 py-3 text-right text-slate-400">{stat.total}</td>
                        <td className="px-4 py-3 text-right text-slate-200 font-bold">
                          {(stat.winRate * 100).toFixed(0)}%
                        </td>
                        <td className="px-4 py-3">
                          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden w-24">
                            <div
                              className="h-full bg-orange-500 rounded-full"
                              style={{ width: `${stat.winRate * 100}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

**Step 9: Add analytics link to gallery**

Open `packages/web/app/page.tsx`. In the header, add an analytics link:

```tsx
<a href="/analytics" className="text-xs text-slate-500 hover:text-slate-300 font-mono border border-slate-800 rounded px-2 py-1">
  ◆ Analytics
</a>
```

**Step 10: Run tests**

```bash
npm run test --workspace=packages/orchestrator -- --testPathPattern=stats-aggregator
```
Expected: PASS

**Step 11: Typecheck both packages**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

**Step 12: Smoke test**

```bash
curl -s http://localhost:3000/analytics/summary | python3 -m json.tool
```
Expected: JSON with totalCompetitions, byModel, etc.

Open `http://localhost:3001/analytics` — verify the dashboard renders.

**Step 13: Commit**

```bash
git add packages/orchestrator/src/analytics/stats-aggregator.ts packages/orchestrator/src/analytics/stats-aggregator.test.ts
git add packages/orchestrator/src/server/routes/analytics.ts packages/orchestrator/src/server/app.ts
git add packages/web/app/api/analytics/route.ts packages/web/app/analytics/page.tsx packages/web/app/page.tsx
git commit -m "feat: analytics endpoint + dashboard — win rates by model, completion rate, avg duration"
```

---

## Task 10: Full Test Suite + Gate 2 Verification

**What:** Run all tests, fix any regressions, then do a manual Gate 2 smoke test: full competition → synthesis output appears → replay viewer works → analytics show the competition.

**Step 1: Run full test suite**

```bash
npm run test
```
Expected: All tests pass. If any fail, fix them before continuing.

**Step 2: Typecheck all packages**

```bash
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

**Step 3: Gate 2 smoke test**

With orchestrator + web running:

```bash
# 1. Launch a new competition (brief builder or curl)
COMP_ID=$(curl -s -X POST http://localhost:3000/competitions \
  -H "Content-Type: application/json" \
  -d '{
    "brief": {
      "id": "gate2-test",
      "title": "Gate 2 Verification",
      "format": "SPRINT",
      "problem": "Write a Python function that returns the Fibonacci sequence up to n terms",
      "constraints": ["Must include docstring", "Must include at least one test"],
      "deliverables": ["solution.py"],
      "timeLimitMs": 60000,
      "rubric": {
        "criteria": [
          { "id": "correctness", "description": "Function is correct", "maxScore": 10, "weight": 0.5 },
          { "id": "quality", "description": "Code quality", "maxScore": 10, "weight": 0.5 }
        ]
      }
    },
    "teams": [
      { "id": "team-a", "model": "claude:speedrunner" },
      { "id": "team-b", "model": "claude:architect" }
    ],
    "options": { "claudeBin": "claude", "logDir": "/tmp/arena-logs", "skipSandbox": true }
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['competitionId'])")

echo "Competition: $COMP_ID"
```

```bash
# 2. Poll until COMPLETE
for i in $(seq 1 30); do
  STATE=$(curl -s "http://localhost:3000/competitions/$COMP_ID" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['state'])")
  echo "[$i] $STATE"
  [[ "$STATE" == "COMPLETE" ]] && break
  sleep 10
done
```

```bash
# 3. Verify synthesis is present
curl -s "http://localhost:3000/competitions/$COMP_ID" | python3 -c "
import sys, json
d = json.load(sys.stdin)
synth = d.get('result', {}).get('synthesis') if d.get('result') else None
print('synthesis:', 'PRESENT' if synth else 'MISSING', f'({len(synth)} chars)' if synth else '')
print('winner:', d.get('result', {}).get('winnerId'))
"
```
Expected: `synthesis: PRESENT (NNN chars)`

```bash
# 4. Verify analytics show the competition
curl -s http://localhost:3000/analytics/summary | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('total:', d['totalCompetitions'])
print('completed:', d['completedCompetitions'])
print('by model:', [(m['model'], m['wins'], m['total']) for m in d['byModel']])
print('syntheses:', d['synthesisCount'])
"
```

Gate 2 checklist:
- [ ] Competition reaches COMPLETE state ✓ (Gate 1 verified)
- [ ] SYNTHESIZING state appears in state history
- [ ] Synthesis text appears in competition view (open `http://localhost:3001/competitions/$COMP_ID`)
- [ ] Replay viewer works at `http://localhost:3001/competitions/$COMP_ID/replay`
- [ ] Analytics dashboard at `http://localhost:3001/analytics` shows the competition
- [ ] Format preset picker in Brief Builder pre-fills form fields
- [ ] All tests pass

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: phase 2 complete — synthesis, multi-judge, presets, replay, analytics"
```

---

## Summary: What Phase 2 Delivers

| Feature | Gate 2 Criterion |
|---------|-----------------|
| Synthesis engine (SYNTHESIZING state + merge-engine) | "Synthesized solutions rated higher than any individual" |
| Neutral adversarial AI judge (aiJudgeCount option) | Improved judging quality and confidence |
| Format preset picker + applyPreset wiring | "All formats tested and working; operator can switch" |
| Replay viewer (play/pause/speed/scrub) | "Replay matches live experience in 5/5 test cases" |
| Analytics dashboard (win rates, duration, syntheses) | "10+ competitions logged with full analytics" |
| GET /competitions/:id/events endpoint | Enables replay + any future client-side analysis |

**Run commands:**
```bash
npm run test                                     # all tests
npm run test --workspace=packages/orchestrator  # orchestrator only
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```
