# Brief structure (as of 2026-11-18)

A brief is the problem every team in a match receives. It is defined by `briefSchema` in
`packages/shared/src/schemas/brief.schema.ts` (type: `Brief` in
`packages/shared/src/types/competition.ts`) and arrives from one of three places:

- a YAML file in `briefs/` (seeded into the `briefs` table on startup, `source: 'yaml'`)
- the AI brief generator (`source: 'generated'`)
- the New Battle form / a saved competition (`source: 'competition'`)

## Fields

| Field | Type | Required | What it does |
|---|---|---|---|
| `id` | string | yes | Stable identifier, e.g. `concurrent-crawler-001`. |
| `title` | string | yes | Shown in the UI and sent to agents as `[BRIEF: <title>]`. |
| `problem` | string (multi-line) | yes | The task itself. Free text, often a numbered list of requirements. |
| `constraints` | string[] | yes (may be empty) | Hard rules ("asyncio + aiohttp only"). Sent as a bullet list. |
| `deliverables` | string[] (≥1) | yes | Files the judge expects, e.g. `crawler.py`, `README.md`. The parser warns if one has no recognised extension. |
| `rubric.criteria[]` | list (≥1) | yes | How the judge scores. Each criterion: `id`, `description`, `weight` (0–1), `maxScore` (usually 10). Weights must sum to 1. |
| `format` | `SPRINT` \| `HACKATHON` \| `RELAY_RACE` \| `RED_VS_BLUE` | yes | Today it only picks persona prompt variants (`resolvePersona(…, brief.format)`). It does not change how a match runs. |
| `timeLimitMs` | number | yes | Wall-clock deadline. Parser enforces **10 s to 1 hour**. Existing briefs use 2–60 min. |
| `deliverableType` | `code` \| `document` \| `analysis` \| `presentation` \| `plan` \| `mixed` | no (default `code`) | Adds a one-line `[DELIVERABLE FORMAT]` instruction to the prompt, and drives Forge domain fallback. |
| `expectedOutput` | string | no | Expected stdout. Only used by the fallback automated scorer, which runs the deliverable and compares lines. |
| `tags` | string[] | no | Library filtering and display. |
| `domainHint` | one of 7 domains | no | Forge domain override (software, research, creative, security, business, ideation, strategy). |

## Example (`briefs/concurrent-crawler.yml`, abridged)

```yaml
id: concurrent-crawler-001
title: Concurrent Web Crawler
format: HACKATHON
tags: ["Systems", "Networking"]

problem: |
  Build a concurrent web crawler in Python that:
  1. Accepts a seed URL and max depth as command-line arguments
  2. Uses asyncio + aiohttp for concurrent fetching
  ...

constraints:
  - Use asyncio + aiohttp only (no Scrapy, Playwright, etc.)
  - Respect robots.txt — skip disallowed paths

deliverables:
  - crawler.py
  - README.md

timeLimitMs: 2700000  # 45 minutes

rubric:
  criteria:
    - id: correctness
      description: Crawler fetches pages, deduplicates, and outputs valid JSON sitemap
      maxScore: 10
      weight: 0.4
    - id: performance
      description: Concurrent design — processes 20+ URLs in under 30 seconds
      maxScore: 10
      weight: 0.3
    # error-handling 0.2, code-quality 0.1
```

## What an agent actually receives

`BaseAdapter.injectBrief()` (`packages/orchestrator/src/adapters/base-adapter.ts`) turns the
brief plus the team's persona into one prompt, in this order:

```
[PERSONA]              the team's persona system prompt
[COMPETITION RULES]    autonomous, no human, no questions, only goal is files in cwd
[BRIEF: <title>]
<problem>
Constraints:           - one bullet per constraint
[DELIVERABLE FORMAT]   one line chosen by deliverableType
[DELIVERABLES]         "a judge will collect files from cwd … no files = score 0"
                       - one bullet per deliverable
[SCORING RUBRIC]       - <id> (weight NN%): <description>
[TIME LIMIT]           N minutes — work fast
```

Nothing in the prompt mentions sub-agents, teams or delegation. Agents get no budget,
spawn cap or orchestration guidance.

## How the rest of the pipeline reads it

| Stage | What it reads | Limits |
|---|---|---|
| Collection (`collectDeliverables`) | every text file in the workdir | 500 KB per file, 5 MB total |
| Presentations | title, problem, constraints, deliverables, rubric weights | 8K chars per file, 50K total |
| AI judge | title, problem, constraints, deliverables, full rubric | **12K chars per file, 80K total** |
| Synthesis | title, problem, constraints, full rubric | 8K per file, 50K total |
| Forge | title, problem, constraints, full rubric | 6K per file, 40K total |
| Quality check (`POST /generate-brief/quality`) | criterion length, constraints, problem length, weights, duplicates, deliverableType | heuristic, no LLM |

Context budgets live in `packages/orchestrator/src/utils/brief-context.ts`.

## What this means for bigger, squad-sized briefs

- **One hour is the ceiling.** The parser rejects any `timeLimitMs` above 3,600,000.
- **The judge sees about 80K characters per team.** A squad that writes 30 files of 5K each
  (150K) gets judged on roughly half of them, and the truncation is silent to the agents.
- **Deliverables are a flat list of filenames.** There is no way to express "a service with
  these modules" or "a 10-chapter report", and no notion of which parts could run in parallel.
- **`format` already has unused room.** `RELAY_RACE` and `RED_VS_BLUE` exist as names but
  change only the persona text, so a squad format would not be the first format without
  real behaviour behind it.
- **The rubric has no orchestration criterion.** A judge cannot reward or penalise how the
  work was split, because it never sees how it was split.
