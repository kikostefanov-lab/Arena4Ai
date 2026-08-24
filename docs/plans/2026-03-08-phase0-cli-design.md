> **Historical design document, March 2026.** Written while the project was still called *Agent Arena*. Model ids, APIs, file paths and the project name below are as of that date and are **not current**. Kept as a record of what was decided then, not as guidance. See `README.md` for how Arena4Ai works today.

# Phase 0 CLI Orchestrator — Design

**Date:** 2026-03-08
**Scope:** Full Phase 0 as described in `arena-forge-implementation-roadmap.md`
**Goal:** Working CLI that runs two Claude teams with different personas against a structured brief, logs events, judges results, and outputs a winner.

---

## Decisions Made

- **Monorepo**: Turborepo + npm workspaces from day one
- **Build order**: Foundation-first (shared types → state machine → adapters → judging → CLI)
- **Testing**: Vitest
- **Persistence**: Flat JSONL files in `./runs/<competitionId>/` — no database in Phase 0
- **Sandboxing**: Docker containers per team (Phase 0), Firecracker in Phase 1+

---

## Repository Structure

```
agent-arena/
├── turbo.json
├── package.json               # npm workspaces root
├── tsconfig.base.json         # strict TS, moduleResolution: bundler
├── docker-compose.yml         # PostgreSQL + NATS (Phase 1 prep, NATS used in Phase 0 optionally)
├── .env.example
└── packages/
    ├── shared/                # @arena/shared — no arena dependencies
    ├── orchestrator/          # @arena/orchestrator — depends on shared
    └── web/                   # @arena/web — stub only, Phase 1
```

**Turborepo pipeline:**
- `build` depends on `^build` (shared built before orchestrator)
- `test` and `typecheck` run in parallel across packages

**TypeScript:** strict mode, path alias `@arena/*` → each package's `src/`

---

## Package: `@arena/shared`

No dependencies on other arena packages. Built first.

### Types (`src/types/`)
- `event.ts` — `ArenaEvent<T>` generic, `EventType` enum
- `competition.ts` — `Competition`, `Brief`, `Team`, `Deliverable`
- `scoring.ts` — `Rubric`, `RubricCriterion`, `JudgeResult`, `ScoreCard`
- `adapter.ts` — `ModelAdapter` interface: `injectBrief`, `startExecution`, `emitEvent`, `collectDeliverables`, `shutdown`

### Schemas (`src/schemas/`) — Zod, runtime validation at system boundaries
- `brief.schema.ts` — validates YAML-parsed brief before competition starts
- `event.schema.ts` — validates events before writing to event log
- `scoring.schema.ts` — validates judge scores before aggregation

### Constants (`src/constants/`)
- `states.ts` — `CompetitionState` enum + valid transitions map
- `event-types.ts` — `EventType` enum
- `formats.ts` — `CompetitionFormat` enum (SPRINT, HACKATHON, etc.)

Pure types, schemas, constants only — no side effects.

---

## Package: `@arena/orchestrator`

### Build Order

1. **Engine** (`src/engine/`)
   - `state-machine.ts` — pure `transition(state, event)` function, no side effects
   - `clock-manager.ts` — configurable time limit, `EventEmitter`, fires `TIME_WARNING` at 80%, `TIME_UP` at limit
   - `competition-runner.ts` — orchestrates full lifecycle

2. **Brief** (`src/brief/`)
   - `parser.ts` — reads YAML, validates against `brief.schema.ts`, returns typed `Brief`
   - `templates/` — `architecture-decision.yml`, `code-challenge.yml`, `analysis.yml`
   - `presets.ts` — SPRINT (15 min), HACKATHON (2 hr)

3. **Adapters** (`src/adapters/`)
   - `base-adapter.ts` — abstract class implementing `ModelAdapter`
   - `claude/claude-adapter.ts` — spawns `claude` CLI via `child_process`, streams stdout
   - `claude/claude-normalizer.ts` — maps Claude JSON output → `ArenaEvent`
   - `claude/claude-personas.ts` — system prompt templates (Architect, Pragmatist, etc.)

4. **Sandbox** (`src/sandbox/`)
   - `docker-runtime.ts` — creates isolated container per team, mounts brief
   - `sandbox-manager.ts` — create, monitor, collect deliverables, cleanup

5. **Judging** (`src/judging/`)
   - `rubric-scorer.ts` — weighted numeric scoring against rubric criteria
   - `ai-judge.ts` — spawns separate Claude instance as cross-judge, parses score JSON
   - `score-aggregator.ts` — averages scores, outlier detection, final `ScoreCard`
   - `results-reporter.ts` — terminal output: scores per criterion, ranking, commentary

6. **CLI** (`src/cli.ts`)
   - Commands: `run`, `replay`, `list`
   - `run` flags: `--brief`, `--preset`, `--team-a`, `--team-b`

---

## Data Flow

```
npx tsx src/cli.ts run --brief ./briefs/arch.yml --preset sprint --team-a claude:architect --team-b claude:pragmatist

1. CLI parses args
   └─> parser.ts loads + validates YAML → typed Brief

2. competition-runner initializes
   ├─> state-machine: DRAFT → CONFIGURED
   ├─> clock-manager starts
   └─> two Claude adapters created with persona prompts

3. CONFIGURED → LAUNCHING
   └─> sandbox-manager creates two Docker containers
       each gets isolated filesystem + brief injected as system prompt

4. LAUNCHING → RUNNING
   ├─> both adapters startExecution() in parallel
   ├─> each streams stdout → claude-normalizer → ArenaEvent
   └─> events written to ./runs/<competitionId>/events.jsonl

5. clock-manager fires TIME_UP
   └─> RUNNING → TIME_UP → COLLECTING
       └─> sandbox-manager.collectDeliverables() extracts files

6. COLLECTING → JUDGING
   ├─> rubric-scorer runs automated checks
   ├─> ai-judge scores Team A (cross-judged by separate Claude instance)
   ├─> ai-judge scores Team B (cross-judged by separate Claude instance)
   └─> score-aggregator produces final ScoreCards

7. JUDGING → SCORED → COMPLETE
   └─> results-reporter prints ranked results to terminal
```

---

## Persistence (Phase 0)

Flat files only — no database.

```
./runs/
└── <competitionId>/
    ├── events.jsonl       # Newline-delimited ArenaEvent JSON
    ├── brief.json         # Parsed brief snapshot
    ├── team-a/            # Collected deliverables
    ├── team-b/            # Collected deliverables
    └── results.json       # Final ScoreCards + ranking
```

---

## State Machine

```
DRAFT → CONFIGURED → LAUNCHING → RUNNING → TIME_UP → COLLECTING → JUDGING → SCORED → COMPLETE
```

Transitions are validated — invalid transitions throw. State machine is a pure function with no side effects, fully unit-testable.

---

## Competition Formats (Phase 0)

| Format | Time Limit |
|--------|------------|
| SPRINT | 15 minutes |
| HACKATHON | 2 hours |
