> **Historical design document, March 2026.** Model ids, APIs and file paths referenced below are as of that date and are **not current**. It is kept as a record of what was decided then, not as guidance. See `README.md` for current models and `CLAUDE.md` for current usage.

# UX Audit Agent Team — Implementation Plan

> **Status: COMPLETE**

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dispatch a 4-agent UX review team (1 senior orchestrator + 3 specialists) to audit the Arena4Ai web app for design inconsistencies against the marketing landing page, producing `docs/ux-audit.md` and a visual HTML report — no code changes made.

**Architecture:** Phase 1 orchestrator reads all key files and produces structured domain briefs. Phase 2 dispatches 3 specialist Explore agents in parallel using dispatching-parallel-agents. Phase 3 orchestrator synthesizes all findings into both deliverables.

**Tech Stack:** Agent dispatching (Explore subagents), Markdown, HTML, Arena4Ai codebase (`packages/web`, `marketing/`)

**Spec:** `docs/superpowers/specs/2026-03-11-ux-audit-agent-team-design.md`

---

## Chunk 1: Phase 1 — Senior UX Orchestrator

### Task 1: Dispatch Senior UX Orchestrator

**Files read (no writes — Explore agent is read-only):**
- `marketing/index.html`
- `packages/web/app/globals.css`
- `packages/web/lib/design-tokens.ts`
- `packages/web/app/layout.tsx`
- `packages/web/app/page.tsx`
- `packages/web/app/competitions/[id]/page.tsx`
- `packages/web/app/leaderboard/page.tsx`
- `packages/web/app/analytics/page.tsx`
- `packages/web/app/tournaments/[id]/page.tsx`
- `packages/web/app/competitions/new/page.tsx`

- [ ] **Step 0: Verify all source files and output directory exist**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
ls marketing/index.html \
   packages/web/app/globals.css \
   packages/web/lib/design-tokens.ts \
   packages/web/app/layout.tsx \
   packages/web/app/page.tsx \
   "packages/web/app/competitions/[id]/page.tsx" \
   packages/web/app/leaderboard/page.tsx \
   packages/web/app/analytics/page.tsx \
   "packages/web/app/tournaments/[id]/page.tsx" \
   packages/web/app/competitions/new/page.tsx && \
test -d ".superpowers/brainstorm/98181-1773254965/" || \
  (echo "ERROR: brainstorm output dir missing — start the visual companion server first" && exit 1)
```

Expected: all 10 files listed with no "No such file" errors, and no ERROR line. If any source files are missing, check glob patterns and locate the actual path before proceeding. If the brainstorm dir is missing, run the visual companion server per the brainstorming session setup.

- [ ] **Step 1: Dispatch the orchestrator Explore agent**

Use the Agent tool with `subagent_type: Explore` and this exact prompt:

```
You are the Senior UX Orchestrator for the Arena4Ai design audit team.

Your job is to read the marketing landing page and all web app key files,
then produce structured domain briefs for 3 specialist agents.

Project root: /Users/kstefano/Personal Projects/agentarena

READ THESE FILES IN ORDER:

1. marketing/index.html — source of truth for TRON design language
2. packages/web/app/globals.css — current web app global styles
3. packages/web/lib/design-tokens.ts — color/typography tokens
4. packages/web/app/layout.tsx — root layout, font loading
5. packages/web/app/page.tsx — gallery page
6. packages/web/app/competitions/[id]/page.tsx — arena page (largest, most complex)
7. packages/web/app/leaderboard/page.tsx — leaderboard
8. packages/web/app/analytics/page.tsx — analytics
9. packages/web/app/tournaments/[id]/page.tsx — tournament detail
10. packages/web/app/competitions/new/page.tsx — new competition form

After reading all files, produce a structured output with THREE DOMAIN BRIEFS.

Each brief must include:
- Specific patterns you observed in marketing/index.html
- Specific patterns you observed in the web app for this domain
- A list of suspected gaps (not yet verified — that's the specialist's job)
- Which exact files the specialist should focus on
- Severity guidance: what makes something Critical vs Major vs Minor

Severity definitions:
- Critical: visible on every page, breaks brand coherence immediately
- Major: visible on primary user flows, noticeably inconsistent
- Minor: edge cases, secondary pages, or subtle polish gaps

---

DOMAIN BRIEF 1: Background Systems
Focus: grid (size/opacity/position/fixed-vs-scroll), scanlines overlay,
corner bracket HUD elements, ambient/radial glow effects, body background.

DOMAIN BRIEF 2: Typography & Badges
Focus: Orbitron font application (where used vs missing), monospace vs
sans-serif mixing, state badge styling, stamp element pattern,
letter-spacing and text-transform consistency, design-tokens vs actual usage.

DOMAIN BRIEF 3: Pages & Components
Focus: navigation bar pattern and consistency, card/panel border and glow
styles, button styles across pages, spacing and layout rhythm,
section divider styles.

Format your output as:

=== DOMAIN BRIEF 1: BACKGROUND SYSTEMS ===
Marketing patterns observed: ...
Web app patterns observed: ...
Suspected gaps: ...
Files to focus on: ...
Severity guidance: ...

=== DOMAIN BRIEF 2: TYPOGRAPHY & BADGES ===
[same structure]

=== DOMAIN BRIEF 3: PAGES & COMPONENTS ===
[same structure]

IMPORTANT BEFORE WRITING BRIEFS:
- If any file is unreadable, write: "FILE READ ERROR: [filename] — [reason]" and STOP.
  Do not proceed to domain briefs with incomplete data.
- If all files read successfully, write:
  "FILE READ COMPLETE: [list all 10 filenames on one line]"
  Then proceed to domain briefs.

Each brief must list at least 3 suspected gaps. If a domain has fewer, write
"No additional gaps detected beyond the confirmed gaps listed."

Be precise and factual. Reference actual CSS values, class names, and line
numbers where possible. Do not speculate — only report what you observed.
```

- [ ] **Step 2: Capture and validate orchestrator output**

Verify the orchestrator produced all three briefs. Confirm this checklist before proceeding to Chunk 2:

```
=== ORCHESTRATOR BRIEFS — TASK 2 INPUT ===
✓ BRIEF 1 (Background Systems) — [N] suspected gaps listed
✓ BRIEF 2 (Typography & Badges) — [N] suspected gaps listed
✓ BRIEF 3 (Pages & Components) — [N] suspected gaps listed
```

If any brief is missing or has 0 suspected gaps and no "no gaps detected" statement, re-dispatch the orchestrator before continuing.

You will paste each `=== DOMAIN BRIEF N: ... ===` block verbatim into the matching specialist agent prompt in Chunk 2, Step 3. Do not paraphrase — paste the full brief text.

---

## Chunk 2: Phase 2 — Parallel Specialist Agents

### Task 2: Dispatch 3 Specialist Agents in Parallel

Use `superpowers:dispatching-parallel-agents` to launch all 3 simultaneously.
Each agent uses `subagent_type: Explore`. All agents are **read-only** — no file writes.

**Agent 1 prompt** (replace `[INSERT DOMAIN BRIEF 1 HERE]` with the verbatim `=== DOMAIN BRIEF 1: BACKGROUND SYSTEMS ===` block from Step 2):

```
You are Agent 1 — Background Systems UX Specialist for the Arena4Ai audit.

Project root: /Users/kstefano/Personal Projects/agentarena

YOUR DOMAIN BRIEF FROM THE SENIOR ORCHESTRATOR:
[INSERT DOMAIN BRIEF 1 HERE]

YOUR TASK:
Audit the web app background systems against the marketing landing page.
Produce a structured findings report.

READ THESE FILES:
- marketing/index.html (lines covering .grid-bg, .scanlines, .corner, .hero-glow-center)
- packages/web/app/globals.css (full file)
- packages/web/app/layout.tsx (full file)

For each finding, report:
- Finding ID: BG-001, BG-002, etc.
- Title: short descriptive name
- Severity: Critical / Major / Minor (use definitions from brief)
- Marketing reference: what the marketing page does (quote CSS values)
- Web app current state: what the web app currently does (quote CSS values)
- Gap description: concrete difference
- File(s): exact file path(s)
- Line numbers: approximate lines affected
- Suggested fix: specific CSS change needed (quote the exact property/value)

SEVERITY DEFINITIONS:
- Critical: visible on every page, breaks brand coherence immediately
- Major: visible on primary user flows, noticeably inconsistent
- Minor: edge cases, secondary pages, or subtle polish gaps

FORMAT each finding as:

--- BG-001 ---
Title: [title]
Severity: [level]
Marketing: [exact CSS / code reference]
Web app: [exact CSS / code reference]
Gap: [description]
Files: [path(s)]
Lines: [approx]
Fix: [specific change]

Be exhaustive. Check every background-related CSS property.
Do not speculate — only report what the files contain.
```

**Agent 2 prompt** (replace `[INSERT DOMAIN BRIEF 2 HERE]` with the verbatim `=== DOMAIN BRIEF 2: TYPOGRAPHY & BADGES ===` block from Step 2):

```
You are Agent 2 — Typography & Badges UX Specialist for the Arena4Ai audit.

Project root: /Users/kstefano/Personal Projects/agentarena

YOUR DOMAIN BRIEF FROM THE SENIOR ORCHESTRATOR:
[INSERT DOMAIN BRIEF 2 HERE]

YOUR TASK:
Audit the web app typography and badge patterns against the marketing landing page.
Produce a structured findings report.

READ THESE FILES:
- marketing/index.html (full CSS section — focus on font-family, letter-spacing,
  text-transform, .stamp, .logo, .wordmark, .tagline, .nav-cta, badge-like elements)
- packages/web/lib/design-tokens.ts (full file)
- packages/web/app/globals.css (full file)
- packages/web/app/layout.tsx (full file)
- packages/web/app/page.tsx (focus on badge/label/state elements)
- packages/web/app/leaderboard/page.tsx (focus on text styling)
- packages/web/app/competitions/new/page.tsx (focus on form labels, buttons)
- packages/web/app/tournaments/new/page.tsx (focus on form labels, buttons)

For each finding, report:
- Finding ID: TY-001, TY-002, etc.
- Title: short descriptive name
- Severity: Critical / Major / Minor
- Marketing reference: what the marketing page does (quote CSS values)
- Web app current state: what the web app currently does (quote CSS values)
- Gap description: concrete difference
- File(s): exact file path(s)
- Line numbers: approximate lines affected
- Suggested fix: specific CSS/code change needed

SEVERITY DEFINITIONS:
- Critical: visible on every page, breaks brand coherence immediately
- Major: visible on primary user flows, noticeably inconsistent
- Minor: edge cases, secondary pages, or subtle polish gaps

FORMAT each finding as:

--- TY-001 ---
Title: [title]
Severity: [level]
Marketing: [exact CSS / code reference]
Web app: [exact CSS / code reference]
Gap: [description]
Files: [path(s)]
Lines: [approx]
Fix: [specific change]

Be exhaustive. Check every font, badge, label, and text-decoration property.
Do not speculate — only report what the files contain.
```

**Agent 3 prompt** (replace `[INSERT DOMAIN BRIEF 3 HERE]` with the verbatim `=== DOMAIN BRIEF 3: PAGES & COMPONENTS ===` block from Step 2):

```
You are Agent 3 — Pages & Components UX Specialist for the Arena4Ai audit.

Project root: /Users/kstefano/Personal Projects/agentarena

YOUR DOMAIN BRIEF FROM THE SENIOR ORCHESTRATOR:
[INSERT DOMAIN BRIEF 3 HERE]

YOUR TASK:
Audit the web app pages and components against the marketing landing page's
design language. Produce a structured findings report.

READ THESE FILES:
- marketing/index.html (focus on .top-bar, .nav-cta, section dividers,
  card-like elements, button styles, section padding, .hero structure)
- packages/web/app/page.tsx (gallery — nav, cards, buttons, filters)
- packages/web/app/competitions/[id]/page.tsx (arena — the most important page)
- packages/web/app/leaderboard/page.tsx
- packages/web/app/analytics/page.tsx
- packages/web/app/tournaments/[id]/page.tsx
- packages/web/app/competitions/new/page.tsx

For each finding, report:
- Finding ID: CP-001, CP-002, etc.
- Title: short descriptive name
- Severity: Critical / Major / Minor
- Marketing reference: what the marketing page does (describe the pattern)
- Web app current state: what the web app currently does
- Gap description: concrete difference
- File(s): exact file path(s)
- Line numbers: approximate lines affected
- Suggested fix: specific change needed

SEVERITY DEFINITIONS:
- Critical: visible on every page, breaks brand coherence immediately
- Major: visible on primary user flows, noticeably inconsistent
- Minor: edge cases, secondary pages, or subtle polish gaps

FORMAT each finding as:

--- CP-001 ---
Title: [title]
Severity: [level]
Marketing: [pattern/code reference]
Web app: [current state]
Gap: [description]
Files: [path(s)]
Lines: [approx]
Fix: [specific change]

Focus especially on:
1. Is there a consistent top navigation bar? How does it compare to marketing's .top-bar?
2. Do cards/panels have consistent border glow patterns?
3. Are buttons styled consistently (border, color, letter-spacing) like marketing's .nav-cta?
4. Are section dividers / horizontal rules consistent?
5. Does page spacing/padding rhythm feel consistent with marketing's cinematic layout?

Be exhaustive. Do not speculate — only report what the files contain.
```

- [ ] **Step 3: Dispatch all 3 agents simultaneously**

In a **single message**, make three Agent tool calls (one per specialist). All three must be in the same response — do not send them in separate turns. Set `subagent_type: Explore` for all three. Do not wait for one to finish before starting the next.

Example structure (pseudo-code for clarity):
```
Message contains:
  Agent tool call 1 → Agent 1 prompt (Background Systems)
  Agent tool call 2 → Agent 2 prompt (Typography & Badges)
  Agent tool call 3 → Agent 3 prompt (Pages & Components)
```

All three domain brief placeholders must be filled with verbatim text from Step 2 before dispatching.

- [ ] **Step 4: Collect and label all 3 specialist reports**

Wait for all 3 agents to complete. Label each report clearly in your session context:

```
=== SPECIALIST REPORT 1 — BACKGROUND SYSTEMS ===
[paste full Agent 1 output verbatim — all BG-### findings]
=== END REPORT 1 ===

=== SPECIALIST REPORT 2 — TYPOGRAPHY & BADGES ===
[paste full Agent 2 output verbatim — all TY-### findings]
=== END REPORT 2 ===

=== SPECIALIST REPORT 3 — PAGES & COMPONENTS ===
[paste full Agent 3 output verbatim — all CP-### findings]
=== END REPORT 3 ===
```

Do not paraphrase or edit the reports. Paste them verbatim into the synthesis prompt in Step 5.

---

## Chunk 3: Phase 3 — Synthesis & Report Generation

### Task 3: Dispatch Synthesis Orchestrator

- [ ] **Step 5: Dispatch the synthesis orchestrator**

Use Agent tool with `subagent_type: general-purpose` and this exact prompt (embed all 3 specialist reports where indicated):

```
You are the Senior UX Orchestrator performing final synthesis for the Arena4Ai design audit.

Project root: /Users/kstefano/Personal Projects/agentarena
Spec: docs/superpowers/specs/2026-03-11-ux-audit-agent-team-design.md

You have received reports from 3 specialist agents. Your job is to:
1. Deduplicate overlapping findings. A finding is a duplicate if it targets the
   same CSS property in the same file(s) — even if the wording differs. Keep the
   more detailed version; discard the less detailed one and note the merge.
2. Assign final severity ratings (Critical / Major / Minor)
3. Write docs/ux-audit.md (the committed markdown report)
4. Write a visual HTML file to: /Users/kstefano/Personal Projects/agentarena/.superpowers/brainstorm/98181-1773254965/ux-audit-report.html

---
SPECIALIST REPORT 1 — BACKGROUND SYSTEMS:
[INSERT AGENT 1 FULL OUTPUT HERE]

---
SPECIALIST REPORT 2 — TYPOGRAPHY & BADGES:
[INSERT AGENT 2 FULL OUTPUT HERE]

---
SPECIALIST REPORT 3 — PAGES & COMPONENTS:
[INSERT AGENT 3 FULL OUTPUT HERE]

---

SEVERITY DEFINITIONS (final):
- Critical: visible on every page, breaks brand coherence immediately
- Major: visible on primary user flows, noticeably inconsistent
- Minor: edge cases, secondary pages, or subtle polish gaps

---

TASK A: Write docs/ux-audit.md

Use the Write tool to create this file at:
/Users/kstefano/Personal Projects/agentarena/docs/ux-audit.md

Structure:
# Arena4Ai UX Audit

**Date:** 2026-03-11
**Audited by:** 4-agent UX review team (Senior Orchestrator + 3 specialists)
**Scope:** Web app (packages/web) vs. Marketing landing page (marketing/index.html)

## Executive Summary
[3-5 bullet points covering the biggest findings]

## Findings Summary

| ID | Severity | Domain | Title | File(s) | Suggested Fix |
|----|----------|--------|-------|---------|---------------|
[one row per finding, sorted: Critical first, then Major, then Minor]

## Domain 1: Background Systems
[All BG-### findings. For each finding use this format:

### BG-001: [Title]
**Severity:** Critical / Major / Minor
**Marketing:** [exact CSS value or pattern]
**Web app:** [exact CSS value or current state]
**Gap:** [description]
**Files:** [path(s) and approximate lines]
**Fix:** [specific CSS property and value to change]
]

## Domain 2: Typography & Badges
[All TY-### findings — same format as above]

## Domain 3: Pages & Components
[All CP-### findings — same format as above]

## Implementation Priority

### Immediate (Critical)
[Critical findings listed with suggested fix]

### High Priority (Major)
[Major findings listed with suggested fix]

### Polish (Minor)
[Minor findings listed with suggested fix]

---
TASK B: Write the visual HTML report

Use the Write tool to create this file at:
/Users/kstefano/Personal Projects/agentarena/.superpowers/brainstorm/98181-1773254965/ux-audit-report.html

The HTML file must be a FULL HTML DOCUMENT (starts with <!DOCTYPE html>).
Style it in the Arena4Ai TRON aesthetic (background #000408, cyan #00f0ff, orange #ff6600, grid background).

Structure:
- Fixed header: "ARENA4AI — UX AUDIT REPORT 2026-03-11"
- Summary bar: total findings count, broken down by severity (Critical / Major / Minor)
- Three domain sections, each with a colored domain header
- Each finding rendered as a card with:
  - Severity badge (red=Critical, yellow=Major, blue=Minor)
  - Finding ID + title
  - Two-column row: "Marketing" (left, cyan border) vs "Web App" (right, orange border)
  - Gap description
  - Suggested fix (highlighted)
- Sticky table of contents linking to each domain section

Make it visually impressive — this is the review document the human will use to approve implementation.

After writing both files, confirm:
1. docs/ux-audit.md written ✓
2. ux-audit-report.html written ✓
3. Total finding count: [N] (Critical: N, Major: N, Minor: N)
```

- [ ] **Step 6: Verify both deliverables exist and no source files were modified**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
ls -la "docs/ux-audit.md" \
       ".superpowers/brainstorm/98181-1773254965/ux-audit-report.html"
```

Expected: both files present, non-zero size.

```bash
# Verify no web app or marketing source files were touched
git status --porcelain | grep -E "packages/web|marketing/"
```

Expected: empty output (no lines). If any source files show as modified, investigate before committing.

- [ ] **Step 7: Commit the markdown report**

```bash
cd "/Users/kstefano/Personal Projects/agentarena"
git add docs/ux-audit.md
git commit -m "docs: add UX audit report — web app vs marketing design gaps

4-agent team (Senior Orchestrator + Background Systems + Typography +
Pages & Components specialists). Report-first — no code changes yet.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: Tell the user how to access both deliverables**

Inform the user:
- Markdown report: `docs/ux-audit.md` (committed to git)
- Visual report: check if the visual companion server is running:
  ```bash
  curl -s http://localhost:53996 > /dev/null && echo "Server running" || echo "Server not running — restart with: bash /Users/kstefano/.claude/plugins/cache/superpowers-marketplace/superpowers/5.0.1/skills/brainstorming/scripts/start-server.sh --project-dir '/Users/kstefano/Personal Projects/agentarena'"
  ```
  Then open **http://localhost:53996** — `ux-audit-report.html` will be served as the newest file.
- Ask: "Review the findings and let me know which ones to implement. We can tackle Critical issues first in a separate session using the frontend-design skill."

---

## Success Criteria

- [ ] `docs/ux-audit.md` exists and is committed to git
- [ ] `ux-audit-report.html` is live in the browser companion at http://localhost:53996
- [ ] All findings have: ID, severity, marketing reference, web app current state, gap description, file(s), suggested fix
- [ ] No duplicate findings across domains
- [ ] Zero code changes made to `packages/web/` or `marketing/` during this phase
- [ ] Finding count reported to user (split by severity)
