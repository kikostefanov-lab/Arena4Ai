# UX Audit Agent Team — Design Spec

**Date:** 2026-03-11
**Project:** Arena4Ai (`packages/web` + `marketing/`)
**Goal:** Audit the web app for design inconsistencies against the marketing landing page, then produce a dual-format report for human review before any code changes.

---

## Background

The marketing landing page (`marketing/index.html`) establishes a strong TRON-inspired design language. The web app (`packages/web`) shares the same color palette and grid concept but diverges in several key areas — grid sizing, scanlines, corner bracket HUD elements, font application, badge styling, and ambient glow. The audit will catalogue every gap with severity ratings and suggested fixes. No code changes are made until the report is reviewed and approved.

---

## Design Decisions

- **Report-first:** All 4 agents produce findings only. Implementation is a separate session.
- **Dual-format output:** `docs/ux-audit.md` (repo-committed markdown) + visual HTML report (browser companion, color-coded by severity).
- **Orchestrator-first pipeline:** Senior orchestrator reads all key files before dispatching specialists, ensuring clean non-overlapping domain assignments.
- **3 specialist domains:** Background Systems, Typography & Badges, Pages & Components.

---

## Agent Team Structure

### Phase 1 — Orchestration (sequential)

**Senior UX Orchestrator** (`subagent_type: Explore`)

Reads all key files and produces domain briefs for the 3 specialists:

- `marketing/index.html` — source of truth for the target design language
- `packages/web/app/globals.css` — current grid/animation definitions
- `packages/web/lib/design-tokens.ts` — color and typography tokens
- `packages/web/app/layout.tsx` — root layout, font loading
- All page files: `app/page.tsx`, `app/competitions/[id]/page.tsx`, `app/leaderboard/page.tsx`, `app/analytics/page.tsx`, `app/tournaments/[id]/page.tsx`, `app/tournaments/new/page.tsx`, `app/competitions/new/page.tsx`

Output: structured domain briefs passed to each specialist agent prompt.

### Phase 2 — Specialist Review (parallel, all `subagent_type: Explore`)

**Agent 1 — Background Systems**
- Focus: grid (size, opacity, fixed vs scroll), scanlines overlay, corner bracket HUD elements, ambient/radial glow, body background consistency
- Files: `globals.css`, `layout.tsx`, `marketing/index.html`
- Severity criteria: gaps that are visible on every page = Critical

**Agent 2 — Typography & Badges**
- Focus: Orbitron font application (where used vs where missing), monospace vs sans-serif mixing, state badge styling, stamp element pattern, letter-spacing and text-transform consistency, design-tokens.ts vs actual component usage
- Files: `design-tokens.ts`, all `page.tsx` files, `globals.css`
- Severity criteria: inconsistencies visible in primary UI flows = Major

**Agent 3 — Pages & Components**
- Focus: navigation bar pattern, card/panel border and glow styles, button styles across pages, spacing and layout rhythm, marketing section feel vs app section feel
- Files: all `page.tsx` files, `competitions/[id]/page.tsx`
- Severity criteria: per-page deviations = Major/Minor depending on page prominence

### Phase 3 — Synthesis (sequential, orchestrator)

Senior orchestrator receives all 3 specialist reports, deduplicates overlapping findings, assigns final severity (Critical / Major / Minor), and produces both deliverables.

---

## Deliverables

### `docs/ux-audit.md`
- Executive summary (3–5 bullet overview)
- Findings table: `| Severity | Domain | Finding | File(s) | Suggested Fix |`
- Per-domain detail sections with rationale
- Implementation priority order (Critical first)

### Visual HTML Report (`ux-audit-report.html` in brainstorm session dir)
- Color-coded severity badges: red = Critical, yellow = Major, blue = Minor
- Side-by-side comparison: marketing vs app for each finding
- Grouped by domain (Background / Typography / Components)

---

## Severity Definitions

| Level | Definition |
|-------|-----------|
| **Critical** | Visible on every page, breaks brand coherence immediately |
| **Major** | Visible on primary user flows, noticeably inconsistent |
| **Minor** | Edge cases, secondary pages, or subtle polish gaps |

---

## Known Gaps (Pre-Audit Observations)

These were identified during brainstorming and will be verified/detailed by the agents:

| Area | Marketing | Web App | Gap |
|------|-----------|---------|-----|
| Grid size | 48px | 40px | ~17% smaller |
| Grid opacity | 0.025 | 0.035 | 40% brighter |
| Grid position | `fixed` | `background-image` on body (scrolls) | Scrolls with content |
| Scanlines | Present | Missing | — |
| Corner brackets | Present (4 corners) | Missing | — |
| Ambient glow | Radial center glow | Missing | — |
| Font | Monospace system | Orbitron (inconsistently applied) | — |
| Stamp badges | Present | Missing | — |
| Nav top bar | Gradient fade + blur | Varies per page | — |

---

## Success Criteria

- All findings have a severity rating, affected file(s), and a concrete suggested fix
- No duplicate findings across agents
- Markdown report committed to repo
- Visual report accessible in browser companion
- Zero code changes made during this phase

---

## Out of Scope

- Implementation of any fixes (separate session, requires human approval of this report)
- Mobile/responsive audit
- Accessibility audit
- Performance audit
