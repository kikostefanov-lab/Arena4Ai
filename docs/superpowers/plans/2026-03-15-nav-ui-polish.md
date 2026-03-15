# Sprint 7A: Nav & UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 6 nav items to 4, add score bars to gallery cards, create tabbed Stats page, and clean up dead code.

**Architecture:** All web UI changes except one small backend tweak (add scorecards to list endpoint). No engine/adapter/forge changes. Old routes become redirects.

**Tech Stack:** Next.js 15, React, TypeScript, Drizzle ORM

**Spec:** `docs/superpowers/specs/2026-03-15-nav-ui-polish-design.md`

---

## Task 1: Update TopBar nav links

**Files:**
- Modify: `packages/web/components/TopBar.tsx`

- [ ] **Step 1: Update NAV_LINKS array**

Replace the `NAV_LINKS` array (lines 8-15) with:

```ts
const NAV_LINKS = [
  { href: '/', label: 'Competitions' },
  { href: '/briefs', label: 'Briefs' },
  { href: '/stats', label: 'Stats' },
  { href: '/agent-armory', label: 'Armory' },
];
```

- [ ] **Step 2: Fix active state for root path**

The current active detection uses `pathname === href`. For `/` this means the "Competitions" link will be active on every page since `pathname` starts with `/`. Change to:

```ts
const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
```

Find the two places where active state is computed (desktop nav ~line 59 and mobile dropdown ~line 95) and apply this logic.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/TopBar.tsx
git commit -m "feat(nav): consolidate TopBar to 4 items — Competitions, Briefs, Stats, Armory"
```

---

## Task 2: Create tabbed Stats page

**Files:**
- Create: `packages/web/app/stats/page.tsx`

- [ ] **Step 1: Create the Stats page**

This page has a hero header + 3 tab buttons + conditional content rendering. The content for each tab is the existing page content extracted inline.

The page should:
- Be a `'use client'` component
- Read `?tab` from `useSearchParams()` (default: `'analytics'`)
- Show 3 tab buttons: Analytics, Leaderboard, Compare
- Update the URL via `router.replace('/stats?tab=X')` on tab click (no full navigation)
- Conditionally render the appropriate content

Since the analytics page is a server component (no `'use client'`), and leaderboard/compare are client components, the simplest approach is to make the Stats page a client component that fetches data directly (like leaderboard/compare already do). For the analytics tab, convert the server-side fetch to a client-side `useEffect`.

Each tab's content should be extracted from its current page file into the Stats page. Given the pages are 350-620 lines each, this will be a large file — but it's a single page with three views, which is appropriate.

The hero header:
```
◆ ARENA4AI | STATS
Model Performance & Competition Analytics
```

Tab bar styled to match the existing TRON aesthetic (cyan active border, dim inactive).

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/stats/page.tsx
git commit -m "feat(stats): create tabbed Stats page with Analytics, Leaderboard, Compare"
```

---

## Task 3: Redirect old routes

**Files:**
- Modify: `packages/web/app/analytics/page.tsx`
- Modify: `packages/web/app/leaderboard/page.tsx`
- Modify: `packages/web/app/compare/page.tsx`
- Modify: `packages/web/app/personas/page.tsx`

- [ ] **Step 1: Replace each page with a redirect**

For analytics:
```tsx
import { redirect } from 'next/navigation';
export default function AnalyticsPage() {
  redirect('/stats?tab=analytics');
}
```

For leaderboard:
```tsx
import { redirect } from 'next/navigation';
export default function LeaderboardPage() {
  redirect('/stats?tab=leaderboard');
}
```

For compare:
```tsx
import { redirect } from 'next/navigation';
export default function ComparePage() {
  redirect('/stats?tab=compare');
}
```

For personas (update existing redirect):
```tsx
import { redirect } from 'next/navigation';
export default function PersonasPage() {
  redirect('/agent-armory?tab=personas');
}
```

Use `redirect()` (307) not `permanentRedirect()` (308) to avoid stale browser caches.

- [ ] **Step 2: Update agent-armory to read tab from URL**

In `packages/web/app/agent-armory/page.tsx`, update the `activeTab` initialization to read from searchParams:

```ts
const searchParams = useSearchParams();
const initialTab = searchParams.get('tab');
const [activeTab, setActiveTab] = useState<Tab>(
  initialTab && ['roster', 'personas', 'builder'].includes(initialTab)
    ? initialTab as Tab
    : 'roster'
);
```

Add `import { useSearchParams } from 'next/navigation'` if not already imported.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/analytics/page.tsx packages/web/app/leaderboard/page.tsx packages/web/app/compare/page.tsx packages/web/app/personas/page.tsx packages/web/app/agent-armory/page.tsx
git commit -m "feat(nav): redirect old routes to /stats and /agent-armory with tab params"
```

---

## Task 4: Add scores to gallery API

**Files:**
- Modify: `packages/orchestrator/src/db/repository.ts`

- [ ] **Step 1: Add scorecards to listSummary select**

In `listSummary()` (around line 174), the current select includes `results.winnerId`. Add `results.scorecards`:

```ts
// Current:
winnerId: results.winnerId,
// Add:
scorecards: results.scorecards,
```

- [ ] **Step 2: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/db/repository.ts
git commit -m "feat(api): include scorecards in competition list for gallery score display"
```

---

## Task 5: Add score bars to gallery cards

**Files:**
- Modify: `packages/web/app/page.tsx`

- [ ] **Step 1: Extend CompetitionSummary interface**

Add to the `CompetitionSummary` interface (around line 23):

```ts
scorecards?: Array<{ teamId: string; finalScore: number }> | null;
```

- [ ] **Step 2: Extract scores from API response**

The API returns raw `scorecards` JSONB which has the full scorecard shape. In the card rendering, extract what we need:

```ts
// Inside the card map, after existing variables:
const scores = (() => {
  if (!comp.scorecards || !Array.isArray(comp.scorecards)) return null;
  return (comp.scorecards as Array<Record<string, unknown>>)
    .map(sc => ({
      teamId: sc.teamId as string,
      score: (sc.finalScore as number) ?? 0,
    }))
    .sort((a, b) => b.score - a.score);
})();
```

- [ ] **Step 3: Add score bars to card JSX**

Inside each competition card, after the team matchup row and before the bottom metadata, add a score bar section (only for completed competitions):

```tsx
{scores && isComplete && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', margin: '0.5rem 0' }}>
    {scores.map((s, i) => {
      const team = comp.teams.find((t: Team) => t.id === s.teamId);
      const color = team ? getModelColor(team.model) : '#4a8fa8';
      const label = team ? resolveTeamLabel(team) : s.teamId;
      const isWinner = s.teamId === comp.winnerId;
      return (
        <div key={s.teamId} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{
            flex: 1, height: '4px', background: '#0a2235', borderRadius: '2px', overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.round(s.score * 100)}%`, height: '100%',
              background: color, borderRadius: '2px',
            }} />
          </div>
          <span style={{ fontSize: '0.55rem', fontWeight: 700, color, minWidth: '2rem', textAlign: 'right' }}>
            {Math.round(s.score * 100)}%
          </span>
          <span style={{ fontSize: '0.5rem', color: '#4a8fa8', minWidth: '3.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          {isWinner && <span style={{ fontSize: '0.55rem' }}>🏆</span>}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add packages/web/app/page.tsx
git commit -m "feat(gallery): add score bars with team colors on competition cards"
```

---

## Task 6: Dead code cleanup

**Files:**
- Create: `packages/orchestrator/src/db/migrations/0011_drop_agent_profiles.sql`
- Modify: `packages/orchestrator/src/db/schema.ts`
- Delete: `packages/orchestrator/src/db/agent-profile-repository.ts`

- [ ] **Step 1: Create migration**

```sql
-- 0011_drop_agent_profiles.sql
-- Sprint 7A: Remove dead agent_profiles table (replaced by agents in migration 0009)
DROP TABLE IF EXISTS agent_profiles;
```

- [ ] **Step 2: Remove agentProfiles from schema.ts**

Delete the `agentProfiles` table definition from `packages/orchestrator/src/db/schema.ts` (lines 98-117).

- [ ] **Step 3: Delete agent-profile-repository.ts**

```bash
rm packages/orchestrator/src/db/agent-profile-repository.ts
```

- [ ] **Step 4: Check for imports of deleted code**

Search for any remaining imports of `agentProfiles` or `AgentProfileRepository` and remove them:

```bash
grep -r "agent-profile-repository\|agentProfiles" packages/orchestrator/src/ --include="*.ts"
grep -r "agent-profile-repository\|AgentProfileRepository" packages/web/ --include="*.ts" --include="*.tsx"
```

Remove any found references.

- [ ] **Step 5: Run migration**

```bash
cd packages/orchestrator && DATABASE_URL=postgresql://localhost/arena npm run db:migrate
```

If Drizzle doesn't pick up the migration from the journal, apply manually:
```bash
/opt/homebrew/opt/postgresql@16/bin/psql postgresql://localhost/arena -f packages/orchestrator/src/db/migrations/0011_drop_agent_profiles.sql
```

- [ ] **Step 6: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All tests pass

- [ ] **Step 7: Type check web**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`

- [ ] **Step 8: Commit**

```bash
git add -A packages/orchestrator/src/db/
git commit -m "chore: drop dead agent_profiles table and repository (migration 0011)"
```

---

## Task 7: Update CLAUDE.md and final validation

- [ ] **Step 1: Update CLAUDE.md**

Update the web UI pages section to reflect the new nav structure and Stats page. Update test count if changed.

- [ ] **Step 2: Run full validation**

```bash
npm run test --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
```

- [ ] **Step 3: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Sprint 7A — nav consolidation, Stats page, gallery scores"
git push
```
