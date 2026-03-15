# Sprint 7A: Nav & UI Polish

**Date:** 2026-03-15
**Status:** Design approved, pending implementation plan
**Goal:** Consolidate navigation, add gallery scores, and clean up dead code for a tighter, more informative UI.

## Changes

### 1. TopBar Restructure

**Current nav (6 items + CTA):**
```
Briefs | Leaderboard | Analytics | Tournaments | Compare | Armory | ⚔ New Battle
```

**New nav (4 items + CTA):**
```
Competitions | Briefs | Stats | Armory | ⚔ New Battle
```

| Change | Detail |
|---|---|
| Add **Competitions** | Links to `/` (gallery). Explicit nav to competition list — no longer rely on logo click. |
| Remove **Leaderboard**, **Analytics**, **Compare** | Consolidated into Stats. |
| Add **Stats** | Links to `/stats`. New tabbed page housing all three views. |
| Remove **Tournaments** | Accessible from the gallery page's tournament section. Low usage doesn't justify top-level slot. |
| **Armory** | Unchanged. |

**Modified file:** `packages/web/components/TopBar.tsx`

### 2. Stats Page (Tabbed)

**New route:** `/stats`

A single page with 3 tabs: **Analytics** (default), **Leaderboard**, **Compare**.

```
┌─────────────────────────────────────────────┐
│  ◆ ARENA4AI | STATS                         │
│  Model Performance & Competition Analytics  │
│                                             │
│  [Analytics]  [Leaderboard]  [Compare]      │
│  ─────────────────────────────────────────  │
│                                             │
│  (content of the selected tab)              │
│                                             │
└─────────────────────────────────────────────┘
```

Tab selection persisted in URL via `?tab=analytics|leaderboard|compare` (default: `analytics`). Tab state also readable from URL on direct navigation.

Each tab renders the existing page component's content wholesale — no redesign of the individual views. The existing pages (`/analytics`, `/leaderboard`, `/compare`) become thin redirects.

**New file:** `packages/web/app/stats/page.tsx`

**Content sources:** Extract the main content from each existing page into importable components, or inline them directly in the stats page. Given the pages are moderate size, the simplest approach is to move the content into the stats page and have the old routes redirect.

### 3. Old Route Redirects

| Old route | Redirects to |
|---|---|
| `/analytics` | `/stats?tab=analytics` |
| `/leaderboard` | `/stats?tab=leaderboard` |
| `/compare` | `/stats?tab=compare` |
| `/personas` | `/agent-armory?tab=personas` |

Implemented via Next.js `redirect()` (307, not `permanentRedirect`) in each old page file. Keeps bookmarks and shared links working. Avoids stale 308 browser caches.

**Note:** `/agent-armory/page.tsx` must be updated to read `?tab` from `useSearchParams()` and initialize `activeTab` from it — currently it always defaults to `'roster'`. Without this, the `/personas` → `/agent-armory?tab=personas` redirect would land on the wrong tab.

### 4. Gallery Score Display

Each competition card in the gallery shows final scores for completed competitions.

**Visual design:**
```
┌──────────────────────────────────────┐
│  SQL Murder Mystery          SPRINT  │
│  codex:standard vs gemini:standard   │
│                                      │
│  ██████████████░░░░  86%  CODEX  🏆  │
│  █████████░░░░░░░░░  48%  GEMINI     │
│                                      │
│  5 criteria · 20 min · 2 hours ago   │
└──────────────────────────────────────┘
```

- Score bars use team model color (from `getModelColor()` / `MODEL_COLORS`)
- Winner gets 🏆 icon
- Bars proportional to score (max score = full width)
- Only renders for COMPLETE/FORGE_COMPLETE states
- Running/pending competitions show state badge as today

**API change:** The orchestrator `GET /competitions` list endpoint currently returns `winnerId` from the results join but no scores. Add per-team score extraction from the `scorecards` JSONB column:

```ts
// In listSummary() or list(), extract scores from results.scorecards
scores?: Array<{ teamId: string; finalScore: number }>;
```

**Edge cases:** Handle null results (left join), missing `finalScore` on legacy scorecards (default to 0), and the fact that `scorecards` is `jsonb` (parsed JS object, not typed). Return `scores: null` when no results exist.

The web proxy at `packages/web/app/api/competitions/route.ts` passes this through unchanged.

**Modified files:**
- `packages/orchestrator/src/db/repository.ts` — `listSummary()` extracts scores
- `packages/orchestrator/src/server/routes/competitions.ts` — include scores in list response
- `packages/web/app/page.tsx` — render score bars on cards

### 5. Dead Code Cleanup

| Item | Action |
|---|---|
| `agentProfiles` table | New migration `0011_drop_agent_profiles.sql`: `DROP TABLE IF EXISTS agent_profiles` |
| `agentProfiles` in schema.ts | Remove the Drizzle table definition |
| `agent-profile-repository.ts` | Delete the file |
| `/personas` page | Replace content with redirect to `/agent-armory?tab=personas` |
| `/tournaments/new` from TopBar | Already removed by nav restructure (item 1) |

**New file:** `packages/orchestrator/src/db/migrations/0011_drop_agent_profiles.sql`

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `packages/web/app/stats/page.tsx` | Tabbed Stats page (Analytics + Leaderboard + Compare) |
| `packages/orchestrator/src/db/migrations/0011_drop_agent_profiles.sql` | Drop agent_profiles table |

### Modified Files

| File | Change |
|---|---|
| `packages/web/components/TopBar.tsx` | 4 nav items: Competitions, Briefs, Stats, Armory |
| `packages/web/app/page.tsx` | Add score bars to competition cards |
| `packages/web/app/analytics/page.tsx` | Replace with redirect to `/stats?tab=analytics` |
| `packages/web/app/leaderboard/page.tsx` | Replace with redirect to `/stats?tab=leaderboard` |
| `packages/web/app/compare/page.tsx` | Replace with redirect to `/stats?tab=compare` |
| `packages/web/app/personas/page.tsx` | Replace with redirect to `/agent-armory?tab=personas` |
| `packages/orchestrator/src/db/repository.ts` | Extract scores in listSummary() |
| `packages/orchestrator/src/server/routes/competitions.ts` | Include scores in list response |
| `packages/orchestrator/src/db/schema.ts` | Remove agentProfiles table definition |
| `packages/web/app/api/competitions/route.ts` | Pass through scores field |
| `packages/web/app/agent-armory/page.tsx` | Read `?tab` from searchParams to initialize activeTab |

### Deleted Files

| File | Reason |
|---|---|
| `packages/orchestrator/src/db/agent-profile-repository.ts` | Dead code — replaced by agent-repository.ts |

### Unchanged

- All orchestrator engine code (adapters, judge, forge, synthesis)
- Battle visualization
- Competition detail page
- Brief generation pipeline
- Remotion reels

---

## Success Criteria

1. TopBar has exactly 4 nav items + CTA: Competitions, Briefs, Stats, Armory, ⚔ New Battle
2. `/stats` shows tabbed view with Analytics (default), Leaderboard, Compare
3. Old routes (`/analytics`, `/leaderboard`, `/compare`, `/personas`) redirect correctly
4. Gallery cards show score bars with team colors for completed competitions
5. `agent_profiles` table dropped, repository file deleted
6. All 255+ tests pass, web typecheck clean
