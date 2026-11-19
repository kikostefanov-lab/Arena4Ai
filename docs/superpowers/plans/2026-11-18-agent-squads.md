# Agent Squads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sub-agent a Claude, Codex or Gemini competitor spawns is recorded as its own identity, its lifecycle always closes, and it appears live as its own robot in the 3D arena, with briefs big enough to need a squad.

**Architecture:** Each provider's normalizer emits `SUB_AGENT_SPAWN` / `SUB_AGENT_DONE` events and tags sub-agent lines with `metadata.agentId`. `BaseAdapter` closes open lifecycles and adds a workdir watcher for files the stream never reports. The shared world model folds those events into a per-team squad (keyed on each event's own time). The isometric renderer, the 3D scene, the HUD and the log view all draw from that one model.

**Tech Stack:** TypeScript, Node child processes, vitest 1.6, three.js (`packages/video/src/arena3d/scene.ts`), Next.js 14 (`packages/web`), PostgreSQL via Drizzle.

**Spec:** `docs/superpowers/specs/2026-11-18-agent-squads-design.md` (v2). Executors read both. The spec's "Critic review" table explains why each rule exists.

## Global Constraints

- Branch: `feat/agent-squads`. One commit per task. Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Never commit raw research transcripts.** They live in `.squad-research/` (git-excluded) and contain the operator's tool list, MCP server names, home paths and account details. Committed fixtures are trimmed, and contain none of: `/Users/`, `kikostefanov`, `@gmail`, `mcp__`, `netsuite`, `home-assistant`, `home_assistant`, `gmail`. A test enforces this (Task 2).
- Squad limits: **6 concurrent, depth 1**, read from `ARENA_SQUAD_MAX_CONCURRENT` and `ARENA_SQUAD_MAX_DEPTH`.
- Helper stages (judge, presentations, synthesis, forge, commentary, brief generation) are untouched. They keep `helperClaudeArgs()` / `helperEnv()`. Never pass `--dangerously-skip-permissions` to a helper.
- Never hardcode a Codex or Gemini model id.
- All squad timestamps come from the event's own time (`FrameEvent.t`), never `world.t`.
- `Arena3D.drawFrame(world, spec)` stays a pure function of its arguments: no `Math.random()`, no accumulation, no easing state.
- After editing `packages/video/src/arena3d/scene.ts`, run `npm run build --workspace=packages/video` (the web app imports `dist/`).
- Do not edit `packages/orchestrator/src/judging/rubric-scorer.ts`. A parallel session (`fix-the-heuristic-fallba`) owns it.
- Test commands:
  - `npm run test --workspace=packages/orchestrator`
  - `npm test --workspace=packages/shared`
  - `npm run typecheck --workspace=packages/orchestrator`
  - `npx tsc --noEmit -p packages/web/tsconfig.json`

## Review Focus

1. A lead that exits (crash or normal) while children are still open: every open member must end `unknown`, and no robot may stay on stage. Tested in Task 3.
2. Seeking backward and forward through a squad: the result must be identical to straight playback (same members, statuses, slots and ages). Tested in Task 9.
3. A viewer reconnecting while a child completes: no lost and no duplicated `SUB_AGENT_DONE`. Tested in Task 13.
4. Named deliverables given as nested paths (`research/kegs.md`), or that the team never produced: the judge context and collection must still put existing named files first, and say what is missing or omitted. Tested in Task 8.
5. A stored match that has both raw Claude `task_started` lines and new `SUB_AGENT_SPAWN` events for the same id must count each member once, and more than 6 open members must reuse slots correctly. Tested in Task 9.

---

### Task 1: Shared squad contract

**Files:**
- Modify: `packages/shared/src/constants/event-types.ts` (add `SUB_AGENT_DONE` after `SUB_AGENT_SPAWN`)
- Modify: `packages/shared/src/types/event.ts:25` (`FileOpSource`), `:53` (`ProviderFileCapability`), `:86` (`PROVIDER_FILE_CAPABILITIES`)
- Modify: `packages/shared/src/arena/index.ts` (export new types)
- Test: `packages/shared/src/types/event.test.ts`

**Interfaces:**
- Produces, in `types/event.ts`:
  - `type SubAgentStatus = 'completed' | 'failed' | 'killed' | 'unknown'`
  - `interface SubAgentSpawnPayload { agentId: string; parentAgentId?: string; label: string; description: string; kind?: string; model?: string; background?: boolean; depth: number }`
  - `interface SubAgentDonePayload { agentId: string; status: SubAgentStatus; reason?: string; summary?: string; model?: string; usage?: { tokens?: number; toolUses?: number; durationMs?: number } }`
  - `FileOpSource` gains `'watch'`
  - `ProviderFileCapability` gains `subagentAttribution: boolean` and `subagentLifecycle: 'live' | 'collected'`
  - Values: claude `{subagentAttribution: true, subagentLifecycle: 'live'}`; codex and gemini `{false, 'collected'}`
  - `UNKNOWN_PROVIDER_CAPABILITY` (event-model.ts) gets `false` and `'collected'`
  - Metadata keys (documented in a comment beside `ArenaEvent`): `metadata.agentId?: string` (event produced by that sub-agent) and `metadata.squad?: true` (file written while a squad was open, member unknown)

- [ ] **Step 1: Write failing tests** in `event.test.ts`:
  - `it('has a SUB_AGENT_DONE event type')`: `expect(EventType.SUB_AGENT_DONE).toBe('SUB_AGENT_DONE')`
  - `it('declares squad capabilities per provider')`: claude `.subagentAttribution === true` and `.subagentLifecycle === 'live'`; codex and gemini `false` / `'collected'`
  - `it('accepts SUB_AGENT_DONE in the event schema')`: `arenaEventSchema.safeParse({...validEvent, type: 'SUB_AGENT_DONE'}).success === true`
- [ ] **Step 2: Run** `npm test --workspace=packages/shared -- event.test`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and values above.
- [ ] **Step 4: Run** `npm test --workspace=packages/shared` and `npm run typecheck --workspace=packages/orchestrator`. Expected: PASS. Fix any exhaustive `Record<'claude'|'codex'|'gemini', ProviderFileCapability>` literals the compiler flags.
- [ ] **Step 5: Commit** `feat(shared): sub-agent event contract and squad capabilities`

### Task 2: Scrubbed squad fixtures

**Files:**
- Create: `packages/orchestrator/src/adapters/__fixtures__/squads/` with:
  - `claude-parallel.jsonl`: from `.squad-research/claude/t2.jsonl`; two parallel `local_agent` tasks with `task_started`, tagged sub-agent lines, `task_updated` then `task_notification`
  - `claude-background-bash.jsonl`: from `t3.jsonl`; includes the `local_bash` task and a second `init`/`result`
  - `claude-concurrency-refused.jsonl`: from `t6.jsonl`
  - `codex-v1-spawn-wait.jsonl`: from `.squad-research/codex/t2.jsonl`
  - `codex-cap-close.jsonl`: from `codex2/r5/e.jsonl`; failed spawn, `close_agent`, successful spawns
  - `codex-work.jsonl`: from `codex2/r4/d.jsonl`; `file_change` with multiple changes, `command_execution` (success and failed), `agent_message`
  - `codex-web-search.jsonl`: from `codex2/r3/c.jsonl`
  - `gemini-invoke-agent.jsonl`: from `.squad-research/gemini/run3.jsonl`
- Create: `packages/orchestrator/src/adapters/__fixtures__/squads/README.md` (one paragraph: source CLI versions, the date, "trimmed and scrubbed; do not add raw transcripts")
- Create: `packages/orchestrator/src/adapters/__fixtures__/load.ts`, exporting `loadFixture(name: string): string[]` (non-empty lines)
- Test: `packages/orchestrator/src/adapters/__tests__/fixtures-scrubbed.test.ts`

**Interfaces:**
- Produces: `loadFixture(name)`, used by Tasks 4–6 and 14. Shared-package tests (Task 9) build events inline instead.

- [ ] **Step 1: Write the test** `it('contains no operator-identifying content')`. It reads every file in `__fixtures__/squads/` and asserts that none matches `/\/Users\/|kikostefanov|@gmail|mcp__|netsuite|home[-_]assistant|gmail/i`. Add `it('keeps each fixture under 60 lines')`.
- [ ] **Step 2: Run** `npm run test --workspace=packages/orchestrator -- fixtures-scrubbed`. Expected: FAIL (no files yet).
- [ ] **Step 3: Build the fixtures.**
  - Keep only lines relevant to squads and file and command events.
  - In `init` lines, replace the `tools` / `mcp_servers` / `agents` / `slash_commands` / `plugins` arrays with short built-in-only lists.
  - Replace absolute paths with `/tmp/arena-team-a-x/…` (the shape `toRelativePath` strips).
  - Drop `hook_*` lines and `rate_limit_event` noise.
  - Keep ids, field names and ordering exactly as captured.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `test: scrubbed sub-agent fixtures from claude, codex and gemini`

### Task 3: BaseAdapter squad bookkeeping, limits and the [SQUAD] prompt

**Files:**
- Create: `packages/orchestrator/src/adapters/squad-limits.ts`
- Modify: `packages/orchestrator/src/adapters/base-adapter.ts` (`emitArenaEvent` :333, `settleExit` :302, `shutdown` :239, `injectBrief` :179-214)
- Modify: `packages/orchestrator/src/adapters/normalizer-utils.ts` (add `squadLabel`)
- Test: `packages/orchestrator/src/adapters/__tests__/base-adapter-squad.test.ts` (reuse the `TestAdapter` pattern from `base-adapter.test.ts:11`)

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `squadLimits(env = process.env): { maxConcurrent: number; maxDepth: number }` (defaults 6 and 1; non-positive or NaN falls back to the default)
  - `squadLabel(text: string): string` (≤ 18 chars; first words; trailing `…` when cut; empty input gives `'sub-agent'`)
  - `protected closeOpenSubAgents(status: 'killed' | 'unknown', reason: string): void`
  - `get openSubAgentCount(): number`
  - `emitArenaEvent` drops a second `SUB_AGENT_DONE` for an already-closed `agentId` and a duplicate `SUB_AGENT_SPAWN`
  - `shutdown()` calls `closeOpenSubAgents('killed', 'deadline')` after the process is gone
  - `settleExit()` calls `closeOpenSubAgents('unknown', 'lead exited without reporting')` when not `stopping`
  - The prompt gains a `[SQUAD]` block right after `[COMPETITION RULES]`, using the spec §4 text with `6` replaced by `squadLimits().maxConcurrent`

- [ ] **Step 1: Write failing tests:**
  - `closes open members as unknown when the lead exits on its own`: emit SPAWN a, SPAWN b, DONE a, then `settleExit(0, …)` → exactly one extra DONE `{agentId:'b', status:'unknown', reason:'lead exited without reporting'}`
  - `closes open members as killed on shutdown`: status `killed`, reason `deadline`
  - `never emits two DONE events for one agent`: a DONE after a closure is dropped
  - `ignores duplicate spawns`
  - `squadLimits reads env and falls back`: `{ARENA_SQUAD_MAX_CONCURRENT:'3'}` → 3; `'0'` → 6; `'x'` → 6
  - `squadLabel shortens long descriptions`: `'Write pricing-tiers.md and security-architecture.md'` → length ≤ 18, ends with `…`
  - `injects a [SQUAD] block that tells the lead to delegate`: the prompt contains `[SQUAD]`, `Delegate`, `skeleton` and `up to 6 at a time`, and `[SQUAD]` comes after `[COMPETITION RULES]`
- [ ] **Step 2: Run** `npm run test --workspace=packages/orchestrator -- base-adapter-squad`. Expected: FAIL.
- [ ] **Step 3: Implement.** Track open and closed ids in two `Set<string>`s inside `emitArenaEvent`. Build closure events with `makeEvent(EventType.SUB_AGENT_DONE, payload, ctx)`.
- [ ] **Step 4: Run** the orchestrator tests. Expected: PASS, including the existing `base-adapter.test.ts` and `adapter-shutdown.test.ts`.
- [ ] **Step 5: Commit** `feat(adapters): close every sub-agent lifecycle; squad limits and [SQUAD] prompt`

### Task 3b: Workdir watcher

**Files:**
- Create: `packages/orchestrator/src/adapters/workdir-watcher.ts`
- Modify: `packages/orchestrator/src/adapters/base-adapter.ts` (`emitArenaEvent`, `shutdown`, and a new `protected startWorkdirWatch()`)
- Modify: `claude-adapter.ts`, `codex-adapter.ts`, `gemini-adapter.ts`: call `this.startWorkdirWatch()` right after spawning
- Test: `packages/orchestrator/src/adapters/__tests__/workdir-watcher.test.ts`

**Interfaces:**
- Consumes: `isVendoredPath` from `@arena/shared`, `makeFileEvent`, and the collector's size limit (`MAX_FILE_BYTES`, exported from `base-adapter.ts`).
- Produces:
  - `class WorkdirWatcher`
    - `constructor(opts: { root: string; holdMs?: number /* 5000 */; pollMs?: number /* 1000 */; now?: () => number; onFile: (f: { path: string; op: 'create' | 'modify' }) => void })`
    - `start(): void` (an interval running `scanOnce()` + `flushDue()`)
    - `stop(): void`
    - `noteStreamPath(relPath: string): void`
    - `scanOnce(): void`: a stat walk comparing `mtimeMs` + `size`, skipping `isVendoredPath`, `.git`, dot-dirs and files over the size limit; queues observations
    - `flushDue(): void`: emits observations older than `holdMs` unless the stream reported that path at or after the observation time, or within `holdMs` before it
  - The first sighting of a path (by either source) is `create`; later ones are `modify`.
  - `BaseAdapter`:
    - calls `noteStreamPath` for every stream file event with a path;
    - turns `onFile` into `makeFileEvent({op, opSource: 'watch', path, text: path}, ctx)`, with `metadata.squad = true` when `openSubAgentCount > 0`;
    - stops the watcher first thing in `shutdown()`.
  - Polling only (no `fs.watch`), for determinism. This is a builder's call within the spec's latitude.

- [ ] **Step 1: Write failing tests** (temp dir; injected `now`; call `scanOnce` / `flushDue` directly):
  - `emits a create after the hold window`: write `a.md`, scan at t=0, flush at t=4999 → nothing; flush at t=5000 → `{path:'a.md', op:'create'}`
  - `the stream wins inside the window`: observe at t=0, `noteStreamPath('a.md')` at t=3000, flush at t=6000 → nothing
  - `the stream wins when it reported just before`: `noteStreamPath('a.md')` at t=0, write and observe at t=2000, flush at t=8000 → nothing
  - `reports a later change as modify`
  - `skips node_modules, .git and oversized files`
  - BaseAdapter: `marks watch files as squad while a sub-agent is open`: SPAWN a, then a watch file → event `opSource 'watch'`, `metadata.squad === true`; after DONE a → no `squad`
  - BaseAdapter: `shutdown stops the watcher before collection` (spy on `stop`)
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the orchestrator tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapters): workdir watcher so squad files the stream never reports still appear`

### Task 4: Claude squad normalizer and caps

**Files:**
- Modify: `packages/orchestrator/src/adapters/claude/claude-normalizer.ts`
- Modify: `packages/orchestrator/src/adapters/claude/claude-adapter.ts:58-146`
- Test: `packages/orchestrator/src/adapters/claude/claude-normalizer.test.ts` (extend), `packages/orchestrator/src/adapters/__tests__/adapter-spawn.test.ts` (extend)

**Interfaces:**
- Consumes: `loadFixture`, `squadLabel`, `squadLimits`, Task 1 payloads.
- Produces:
  - `class ClaudeNormalizer { constructor(ctx: NormalizeContext); addLine(line: string): ArenaEvent[] }`
  - The existing `normalizeLine(line, ctx): ArenaEvent` stays exported, unchanged, for stateless callers
  - `ClaudeAdapter` uses `ClaudeNormalizer` and emits every returned event
  - The adapter env adds `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=<maxConcurrent>` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=<maxDepth>` to `claudeEnv()` on both the host and sandbox paths

Rules (spec §2, Claude):
- `system/task_started` with `task_type === 'local_agent'` → `SUB_AGENT_SPAWN` `{agentId: task_id, label: squadLabel(description), description, kind: subagent_type, background: is_backgrounded, depth: spawn_depth ?? 1}`. Remember `tool_use_id → task_id`.
- Any other `task_type` is ignored (returns the usual REASONING raw event). DONE for an unknown id is ignored.
- `task_updated` with `patch.status` in `completed | failed | killed` → `SUB_AGENT_DONE`. A later `task_notification` for the same id is merged into it: when the DONE was already emitted, emit nothing more; when the notification comes first, emit DONE from it with `summary` and `usage {tokens: usage.total_tokens, toolUses: usage.tool_uses, durationMs: usage.duration_ms}`. Status map: `completed→completed`, `failed|error→failed`, `killed|stopped→killed`.
- A line with non-null `parent_tool_use_id`: normalize exactly as `normalizeLine` does, then set `metadata.agentId` to the mapped task id, falling back to the line's `agent_id`. The first sub-agent `assistant` line's `message.model` is kept and attached as `model` on that member's DONE.

- [ ] **Step 1: Write failing tests** (feed fixture lines through `addLine`, flatten the results):
  - `claude-parallel` → exactly 2 `SUB_AGENT_SPAWN` and 2 `SUB_AGENT_DONE` (status `completed`), with distinct agentIds; every FILE_CREATE from a sub-agent carries the matching `metadata.agentId`; the lead's events carry none
  - `claude-background-bash` → the `local_bash` task produces no SPAWN and no DONE; two `result` lines do not throw
  - `claude-concurrency-refused` → 1 SPAWN; the refused call stays a TOOL_CALL
  - adapter-spawn: the Claude spawn env contains `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: '6'` and `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '1'`
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `ClaudeNormalizer` and wire it into the adapter (stdout handler at :140-150).
- [ ] **Step 4: Run** the orchestrator tests and typecheck. Expected: PASS. Existing `normalizeLine` tests stay green.
- [ ] **Step 5: Commit** `feat(claude): squad events from task_started/task_updated and tagged sub-agent lines`

### Task 5: Codex JSON normalizer and squad flags

**Files:**
- Create: `packages/orchestrator/src/adapters/codex/codex-json-normalizer.ts`
- Modify: `packages/orchestrator/src/adapters/codex/codex-adapter.ts:53-110`
- Delete: `packages/orchestrator/src/adapters/codex/codex-normalizer.ts`, `codex/__tests__/codex-normalizer.test.ts`, `codex/__tests__/codex-apply-patch.test.ts`
- Modify: `packages/orchestrator/src/adapters/__tests__/file-event-parity.test.ts` (Codex cases now go through the JSON normalizer, using `codex-work.jsonl`)
- Test: `packages/orchestrator/src/adapters/codex/__tests__/codex-json-normalizer.test.ts`

**Interfaces:**
- Consumes: `loadFixture`, `squadLabel`, `squadLimits`, `makeFileEvent`, `toRelativePath`.
- Produces:
  - `class CodexJsonNormalizer { constructor(ctx: NormalizeContext); addLine(line: string): ArenaEvent[] }`
  - `codexArgs(prompt: string, modelVariant?: string, env = process.env): string[]`, exported from `codex-adapter.ts`, returning in order:
    1. `exec`, `--json`, `--skip-git-repo-check`, `-s`, `workspace-write`
    2. `-c`, `features.multi_agent_v2=false`
    3. `-c`, `sandbox_workspace_write.network_access=true`
    4. `-c`, `web_search=live`
    5. `-c`, `agents.max_concurrent_threads_per_session=<maxConcurrent>`
    6. `[-m, variant]`
    7. the prompt
  - (Task 7 appends the isolation args before `-m`.)

Rules (spec §2, Codex): act on `item.completed` only. Item mapping:
- `agent_message` → REASONING `{text}`
- `command_execution` → TOOL_CALL `{tool: 'exec', input: {command}, exitCode, status}`
- `file_change` → one `makeFileEvent({op: kind === 'add' ? 'create' : 'modify', opSource: 'marker', path: toRelativePath(path), text: …})` per `changes[]` entry
- `web_search` → TOOL_CALL `{tool: 'web_search', input: {query}}`
- `reasoning` → REASONING
- `error` → ERROR
- unknown types and `thread.*` / `turn.*` → `[]`

`collab_tool_call`:
- `spawn_agent` + `status: 'completed'` → SPAWN per receiver id not seen before (`label` from `prompt`, depth 1, `model` from the item's `model` field when present)
- `spawn_agent` + `failed` → REASONING `{text: 'Codex refused a sub-agent: concurrency cap reached'}`
- `wait` / `close_agent` → DONE per `agents_states` entry whose status is not in `pending_init | running | in_progress` (`completed→completed`, else `failed`), once per id
- A `wait` with an empty `receiver_thread_ids` and no known children → ERROR-free REASONING `{text: 'Codex reported a squad it did not identify', squadUnidentified: true}`

The adapter reads JSONL from **stdout** (stdio `['ignore','pipe','pipe']`). It keeps feeding stderr to `noteStderr` only, and stops emitting events from stderr.

- [ ] **Step 1: Write failing tests:**
  - `codex-work`: the multi-change `file_change` item yields one file event per change with relative paths and `opSource: 'marker'`; failed commands are TOOL_CALLs with `exitCode: 1`; `item.started` lines yield nothing
  - `codex-v1-spawn-wait` → 2 SPAWN, 2 DONE `completed`, matched ids
  - `codex-cap-close`: failed spawns yield no SPAWN; `close_agent` closes; total SPAWN === total DONE === 3
  - `codex-web-search` → a TOOL_CALL with `tool: 'web_search'`
  - `codexArgs('p')` deep-equals the exact list above, ending with `'p'`; with `ARENA_SQUAD_MAX_CONCURRENT='2'` the cap entry reads `=2`
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, delete the text normalizer and its tests, and update `file-event-parity.test.ts`.
- [ ] **Step 4: Run** the orchestrator tests and typecheck. Expected: PASS.
- [ ] **Step 5: Verify against the real CLI** (tiny and cheap). Run `codex exec` with `codexArgs` on a two-file prompt in a temp dir with the cheapest model from `codex debug models`, piping stdout through a throwaway script that feeds `CodexJsonNormalizer`. Expected: file events for both files; exit 0. If the CLI rejects `features.multi_agent_v2=false`, switch to `--disable multi_agent_v2` and update the test.
- [ ] **Step 6: Commit** `feat(codex): --json normalizer with squad events, web access and spawn cap`

### Task 6: Gemini squad events

**Files:**
- Modify: `packages/orchestrator/src/adapters/gemini/gemini-normalizer.ts` (`fromToolUse` :71, the `tool_result` case :114-117)
- Test: `packages/orchestrator/src/adapters/gemini/__tests__/gemini-normalizer.test.ts` (extend)

**Interfaces:**
- Produces:
  - `normalizeLine` stays stateless.
  - `tool_use` with `tool_name === 'invoke_agent'` → SPAWN `{agentId: tool_id, label: squadLabel(parameters.prompt), description: parameters.prompt, kind: parameters.agent_name, depth: 1}` instead of TOOL_CALL.
  - `tool_result` whose `tool_id` starts with `invoke_agent__` → DONE `{agentId: tool_id, status: status === 'success' ? 'completed' : 'failed'}`.
  - Other tools are unchanged.

- [ ] **Step 1: Write failing tests** with `gemini-invoke-agent.jsonl` → 2 SPAWN with `kind: 'generalist'` and 2 DONE `completed`; the `update_topic` tool stays a TOOL_CALL.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the orchestrator tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(gemini): invoke_agent becomes squad spawn/done`

### Task 7: Competitor isolation

**Files:**
- Create: `packages/orchestrator/src/adapters/isolation.ts`
- Modify: `claude-adapter.ts` (args), `codex-adapter.ts` (`codexArgs`), `gemini-adapter.ts:74` (args)
- Create: `packages/orchestrator/src/dev/isolation-smoke.ts` (manual script)
- Test: `packages/orchestrator/src/adapters/__tests__/isolation.test.ts`

**Interfaces:**
- Produces: `claudeIsolationArgs(): string[]`, `codexIsolationArgs(): string[]`, `geminiIsolationArgs(): string[]`, appended by each adapter before its model flag. Starting values, to be verified in Step 3:
  - Claude: `['--strict-mcp-config', '--setting-sources', 'project']`
  - Codex: `['-c', 'mcp_servers={}']`
  - Gemini: `['--extensions', 'none']`
- Goal (spec §3): the competitor sees only built-in tools and built-in sub-agent types, with no user MCP servers, plugins, hooks or custom agents, and its login still works. Helper stages are not touched.

- [ ] **Step 1: Write failing tests:**
  - Each adapter's spawned argv (via the `adapter-spawn.test.ts` `FakeChild` mock) contains its isolation args.
  - `helperClaudeArgs()` output is unchanged (a snapshot of its current value).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Verify the flags on the installed CLIs** with `npx tsx packages/orchestrator/src/dev/isolation-smoke.ts`. For each provider, the script runs a one-line prompt ("reply OK") in a temp dir with the adapter's real args and asserts:
  - Claude: the `init` line's `tools` has no entry starting `mcp__`, `agents` has only built-in types (`general-purpose`, `Explore`, `Plan`, `statusline-setup`, `claude-code-guide` or a subset), no `hook_started` lines appear, and a `result` line with `is_error: false` arrives.
  - Codex: stderr has no `rmcp` / MCP startup or auth lines, and `turn.completed` arrives.
  - Gemini: no extension or MCP load messages, and a `result` with `status: 'success'` arrives.
  
  If a flag is rejected or ineffective, find the working equivalent (`claude --help`, `codex --help`, `gemini --help`), update `isolation.ts` and the test, and record the final flags in a comment that cites the CLI version. Cost is three trivial calls.
- [ ] **Step 4: Run** the orchestrator tests and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adapters): isolate competitors from the operator's CLI setup`

### Task 8: Bigger briefs — collection, judge context, timeouts, retry, ceilings

**Files:**
- Modify: `packages/orchestrator/src/adapters/base-adapter.ts` (`walkDir` :77, `collectDeliverables` :219)
- Modify: `packages/orchestrator/src/utils/brief-context.ts` (`truncateFiles` :44, presets :14-39)
- Create: `packages/orchestrator/src/utils/stage-timeout.ts`
- Modify: `packages/orchestrator/src/judging/ai-judge.ts` (:186 message, :388 timeout)
- Modify: `packages/orchestrator/src/presentation/presentation-generator.ts` (`PresentationOptions` :8, :98)
- Modify: `packages/orchestrator/src/engine/competition-runner.ts` (:437 race, :451 collect, :482 presentations, :512-571 judge)
- Modify: `packages/orchestrator/src/brief/parser.ts:28-29`, `packages/web/app/competitions/new/page.tsx:1622`
- Tests: `utils/__tests__/brief-context.test.ts`, `utils/__tests__/stage-timeout.test.ts`, `adapters/__tests__/base-adapter.test.ts`, `brief/parser.test.ts`, `engine/competition-lifecycle.test.ts`

**Interfaces:**
- Produces:
  - `collectDeliverables(named: string[] = []): Promise<Deliverable>`. It reads named deliverables first (exact relative path, or basename match when the name has no `/`), then walks the rest, skipping `isVendoredPath()` paths, `.git` and dot-dirs. `Deliverable` gains `excluded?: Array<{ path: string; reason: 'size' | 'budget' | 'vendored' }>`.
  - `truncateFiles(files, perFile, totalBudget, priority: string[] = []): string`. Priority files come first, in the given order. The output always ends with `(${n} files, ${chars} chars omitted)` when anything was cut or skipped, and with `(missing named deliverables: a, b)` when a priority name has no file.
  - `JUDGE_CONTEXT` `fileTruncation: 24000, fileBudget: 240000`; `PRESENTER_CONTEXT` `12000 / 120000`.
  - `stageTimeoutMs(inputChars: number): number` = `Math.min(600_000, 120_000 + Math.ceil(inputChars / 2000) * 1000)`.
  - `PresentationOptions.timeoutMs?: number`.
  - The judge message at `ai-judge.ts:186` uses the actual timeout.
  - Runner:
    - passes `brief.deliverables` to `collectDeliverables`;
    - passes `timeoutMs: stageTimeoutMs(totalChars)` to `aiJudge` and presentations;
    - retries `aiJudge` once when `failure.kind` is `timeout | rate-limit | cli-error | bad-output`, before the per-team fallback;
    - races an unpausable wall-clock stop at `brief.timeLimitMs * 1.5` real time alongside `raceFinished`.
  - Parser ceiling `10_800_000` with message `timeLimitMs cannot exceed 3 hours`; web `max={180}`.

- [ ] **Step 1: Write failing tests:**
  - `truncateFiles puts priority files first`: priority `['decision.md','demo.html']`, given in reverse order among 5 files → output starts with `### decision.md` then `### demo.html`
  - `truncateFiles reports omissions and missing named files`: the budget is exceeded → output ends with the omitted-count line; priority `['pilot.md']` absent → contains `missing named deliverables: pilot.md`
  - `collectDeliverables reads nested named files before a large research dir`: a temp dir with `research/` holding 60 files of 100 KB each, plus `decision.md` and `research/kegs.md` named → both named files are present, and `excluded` lists budget exclusions
  - `collectDeliverables skips node_modules and .git`
  - `stageTimeoutMs`: `0 → 120000`, `240000 → 240000`, `5_000_000 → 600000`
  - parser: `10_800_000` passes, `10_800_001` throws `cannot exceed 3 hours`
  - lifecycle: a mocked `aiJudge` that fails once with `timeout` and then succeeds produces AI scores, not the fallback; one that fails with `auth` falls back without a retry
  - lifecycle: with the clock paused, the wall-clock stop still ends the run (use fake timers)
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the orchestrator tests, typecheck and web tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat: bigger briefs — named-first collection and judge context, scaled timeouts, judge retry, 3h ceiling`

### Task 9: World model squads (shared)

**Files:**
- Modify: `packages/shared/src/arena/event-model.ts` (`FrameEventKind` :57, `FrameEvent` :59, `toFrameEvent` :142-200, `resolveTelemetry` notes)
- Modify: `packages/shared/src/arena/world.ts` (`TeamState` :72, `World` :106, `createWorld` :143, `resetWorld` :226, `applyEvent` :320-419, `telemetryFromStats` :433)
- Modify: `packages/shared/src/arena/layout.ts` (`bandCells` :139, `RESERVED_BASE_CELLS` :45)
- Modify: `packages/shared/src/arena/index.ts`
- Test: `packages/shared/src/arena/arena.test.ts` (new `describe('squads')`)

**Interfaces:**
- Consumes: Task 1 payload types; `loadFixture` is not available in shared, so tests build events with the existing `ev()` helper.
- Produces:
  - `FrameEventKind` gains `'spawn' | 'agentDone'`.
  - `FrameEvent` gains `agentId?: string`, `squad?: boolean`, `label?: string`, `model?: string`, `agentStatus?: SubAgentStatus`.
  - `toFrameEvent` maps SUB_AGENT_SPAWN / SUB_AGENT_DONE, and copies `metadata.agentId` / `metadata.squad` onto every kind.
  - **Read-time upgrade** in `toFrameEvent`: a REASONING whose `payload.raw.type === 'system'` with `subtype === 'task_started'` and `task_type === 'local_agent'` becomes `spawn` (`agentId = task_id`, `label` ≤ 18 chars from `description`). `subtype === 'task_notification'` becomes `agentDone` (status from `status`). A raw line with `parent_tool_use_id` keeps kind `reasoning` but gets `agentId` from a map built in `toFrameEvents`.
  - `interface SquadMember { id: string; label: string; kind?: string; model?: string; spawnedAt: number; endedAt?: number; status: 'running' | SubAgentStatus; files: number; tools: number; lastActiveAt: number; slot: number | null }`
  - `TeamState.squad: Map<string, SquadMember>`; `TeamState.squadTotals: { spawned: number; failed: number; peak: number }`; `TeamState.delivered: Set<string>`.
  - `World.recent` entries become `{ t: number; teamId: string; kind: string; agentId?: string; key?: string; squad?: boolean }`, with `t = ev.t`.
  - `createWorld(teams, events, opts?: { deliverables?: string[] })`; `World.deliverables: string[]`.
  - `export const SQUAD_SLOTS = 6`; `squadSlotCells(band: Band): Cell[]` (6 cells in a shallow arc in front of the lead); `bandCells` excludes them, and `RESERVED_BASE_CELLS` rises to `2 + SQUAD_SLOTS`.
  - `momentumShares(world: World, windowMs = 10_000): Map<string, number>` counts only `kind === 'file'` entries in `(world.t - windowMs, world.t]`. Shares sum to 1, or are all 0.
  - Notes (only for a team that has had at least one spawn):
    - provider without `subagentAttribution`: `"<Provider> doesn't report which sub-agent wrote each file. Squad files appear as they land, unassigned."`
    - provider with `subagentLifecycle === 'collected'`: `"<Provider> finish times are when the lead collected the result, not when the sub-agent finished."`
    - after a `squadUnidentified` reasoning: `"Codex reported a squad it did not identify."`

Rules:
- `spawn` for a known id is ignored (dedups read-time upgrades against new events).
- The slot is the lowest free in 0..5, else `null` (counted, not drawn). A slot frees on `agentDone`.
- A file event with `agentId` increments `member.files` and sets `lastActiveAt = ev.t`. A tool event increments `tools`.
- A file event with `opSource === 'watch'`:
  - never increments `mods` or `edits`;
  - a structure created only by watch events has depth `'inferred'`.
- A file event whose path equals, or ends with `/` + , a deliverable name adds it to `team.delivered`.
- `resetWorld` clears squads, totals and delivered.

- [ ] **Step 1: Write failing tests** in `describe('squads')`:
  - `spawn and done build a member with event-time timestamps`: SPAWN at 1000 ms, DONE at 5000 ms, `createWorld` then `seek(9000)` → `spawnedAt === 1000`, `endedAt === 5000`, `status === 'completed'`
  - `seeking gives the same squad as playback` (Review Focus 2): apply 20 mixed events live up to 12 s, versus `seek(12000)` from scratch → `JSON.stringify` of each team's squad map entries is equal; then `seek(4000)` after `seek(12000)` matches straight playback to 4 s
  - `slots: seventh open member gets null, and a freed slot is reused` (Review Focus 5)
  - `a raw task_started and a SUB_AGENT_SPAWN for the same id count once` (Review Focus 5)
  - `read-time upgrade: a stored REASONING raw task_started(local_agent) becomes a spawn; local_bash does not`
  - `watch events never raise edit depth`: three watch events for one path → `mods === 0`, depth `inferred`
  - `momentumShares counts file events only`: 10 tool events for A and 1 file for B → A 0, B 1
  - `delivered tracks named deliverables, including nested names`: deliverables `['research/kegs.md','decision.md']`, file `research/kegs.md` → delivered has it; `notes/decision.md` does not count as `decision.md`
  - `layout keeps slot cells free`: no cell from `bandCells` coincides with `squadSlotCells`, for 2, 3 and 4 teams
  - `notes appear only after a spawn, per capability`
  - Existing legacy-stream and layout tests stay green. Update any capacity expectation that assumed `RESERVED_BASE_CELLS = 2`, and note it in the commit message.
- [ ] **Step 2: Run** `npm test --workspace=packages/shared`. Expected: FAIL.
- [ ] **Step 3: Implement** it. Build the `parent_tool_use_id → task_id` map in a single pass inside `toFrameEvents` before mapping.
- [ ] **Step 4: Run** the shared tests and both typechecks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(arena): squad world model, read-time upgrade, slots and file-only momentum`

### Task 10: Isometric markers and the log view

**Files:**
- Modify: `packages/shared/src/arena/renderer.ts` (`RendererOptions` :25, `drawScene` :472, `drawUnit` :646)
- Modify: `packages/web/lib/EventRow.tsx` (`classifyEvent` :48, `EventRow` :215)
- Modify: `packages/web/app/competitions/[id]/page.tsx` (`HIST_COLORS` :55, `LanePanel` :289, the REASONING trim at :2381); `packages/web/app/competitions/[id]/replay/page.tsx:44`; `packages/web/app/spectate/page.tsx:321`
- Test: `packages/shared/src/arena/arena.test.ts` (renderer), `packages/web/lib/__tests__/EventRow.test.ts` (create if absent, using the web package's existing test setup; if web has none, put the `classifyEvent` tests in a `.test.ts` the root turbo test picks up, or test `classifyEvent` through shared)

**Interfaces:**
- Consumes: Task 9 world fields.
- Produces:
  - `RendererOptions.deliverables?: string[]` (passed to `createWorld`).
  - The iso renderer draws one small marker per open member with a slot, beside the team figure, plus a `◆N` count. Purely from the world; no new state.
  - `classifyEvent` handles `SUB_AGENT_SPAWN` (icon `🛰`, label `SQUAD +`, text = label · model) and `SUB_AGENT_DONE` (`✓` completed, `✗` failed/killed/unknown, text = status · reason).
  - `EventRow` gains `agentLabel?: string` and renders `↳ <agentLabel>` in the team colour before the text when set.
  - `LanePanel` builds `agentId → label` from spawn events and passes it in.
  - SUB_AGENT_* events are never trimmed (alongside TOOL_CALL / FILE_CREATE / ERROR), and get `HIST_COLORS` entries.

- [ ] **Step 1: Write failing tests:**
  - The renderer with 2 open members `draw()`s without throwing on a recording `Ctx2D` stub, and records 2 marker calls (count calls through the stub).
  - `classifyEvent('SUB_AGENT_SPAWN', {...})` is non-null with label `SQUAD +`; `SUB_AGENT_DONE` with `failed` gives `✗`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the shared tests and web tsc. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): squad rows in the log and squad markers in the isometric view`

### Task 11: HUD for N teams

**Files:**
- Modify: `packages/web/components/ArenaViewerV2.tsx` (props :44, `LaneHeader` :74, `MomentumMeter` :108, renderer construction :384 and :525/:558, the sampling loop :655-679, the render tree :683-760)
- Modify: `packages/web/app/competitions/[id]/page.tsx` and the replay page, to pass `deliverableNames={competition.brief.deliverables}`

**Interfaces:**
- Consumes: `momentumShares`, `TeamState.squad`, `squadTotals`, `delivered`, `World.deliverables`.
- Produces:
  - `ArenaViewerV2Props.deliverableNames?: string[]`, passed into every `IsoArenaRenderer` construction as `deliverables`.
  - `LaneHeader` gains `squad: { active: number; spawned: number; failed: number; models: string[] }` and `delivered: Array<{ name: string; done: boolean }>`. It renders:
    - the chip `◆ {active} active · {spawned} spawned · {failed} failed`, with the failed part hidden at 0 and the whole chip hidden when spawned is 0, and a `title` tooltip listing `models`;
    - the strip of deliverable names with `✓` or `·`.
  - Headers render for every team (2–4) in a CSS grid with `repeat(N, 1fr)`. The phase chip sits above the row when N > 2; the two-team layout is unchanged.
  - `MomentumMeter` takes `shares: Array<{ id: string; label: string; color: string; share: number }>` and draws one segment per team. The 10 s label stays. It renders for N ≥ 2.
  - The sampling loop (every 15 frames) reads squad, delivered and `momentumShares(world)` into React state.

- [ ] **Step 1:** There is no component test harness in web. Add `packages/web/lib/squad-hud.ts` with pure `squadSummary(team: TeamState): {active, spawned, failed, models}` and `deliveredList(world: World, teamId: string)`. Write failing tests for them wherever Task 10 put the web tests: a team with members completed, running and failed → `{active: 1, spawned: 3, failed: 1}`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the component changes.
- [ ] **Step 4: Run** web tsc and the tests. Expected: PASS. Browser verification happens in Task 14.
- [ ] **Step 5: Commit** `feat(web): headers, squad chips, deliverable strips and momentum for every team`

### Task 12: 3D squad robots

**Files:**
- Modify: `packages/video/src/arena3d/scene.ts` (`load` :164, `layout` :212, `sync` :232-280, `drawFrame` :317, `react` :433, `onPhase` :464, `setJumbo` :797, Reflector :727)
- Optionally modify: `tools/blender/build_gladiators.py` (only if a low-detail variant is authored there rather than at load)

**Interfaces:**
- Consumes: `TeamState.squad`, `squadSlotCells`, `World.recent` (`agentId`, `key`), `SQUAD_SLOTS`.
- Produces (private to the scene):
  - `interface SquadBot { root: THREE.Object3D; j: Record<JointName, THREE.Object3D>; label: THREE.Sprite; labelText: string; cur: number[]; flash: PoseName | null; flashT: number }`.
  - `Fighter.squad: SquadBot[]`: a pool of `SQUAD_SLOTS` bots per team, created in `load()` from a low-detail clone at 0.55× the lead's scale. No runtime cloning.
  - `private placeSquad(world: World, now: number): void` is a pure function of `world` + `world.t`. It is called from both `sync` and `drawFrame`. For each member with a slot:
    - visible from `spawnedAt` until `endedAt + 900 ms`;
    - scale-in over 600 ms from `spawnedAt`, from the lead's position to the slot cell;
    - salute (completed) or hit pose (otherwise) over the fade;
    - age = `world.t - member.spawnedAt`.
  - `private reactActor(world, teamId, agentId | undefined, kind, key | undefined)` replaces `react`. Fresh `recent` entries are grouped by `(teamId, agentId)` and only the last of each group reacts, which removes the `fresh.length <= 10` cut-off at :241. A file spark aims at the structure `key`. With no `agentId`:
    - `squad: true` → a pulse at the block only;
    - otherwise → the lead.
  - Members of a provider without `subagentAttribution` play a looping working pose while open.
  - Jumbotron on a live spawn (sync only, never drawFrame): `` `${PROVIDER} DEPLOYS SQUAD · ${active} ACTIVE` ``.
  - Squad bots are hidden during the mirror render (`mirror.onBeforeRender` / `onAfterRender` toggle) and cleared at freeze.
  - Seam / momentum uses `momentumShares` for 2 teams.

- [ ] **Step 1: Build** `npm run build --workspace=packages/video`. Expected: the current code builds; this is the baseline.
- [ ] **Step 2: Implement** the pool, `placeSquad`, `reactActor`, the jumbo and mirror exclusion. For low detail, decimate the cloned geometry at load (`three/examples/jsm/modifiers/SimplifyModifier.js`, to about 25% of vertices) unless that looks broken, in which case drop the non-essential meshes from the clone (disc, small trims) and note the choice in a comment.
- [ ] **Step 3: Build** again. Expected: PASS, with no type errors. Run `npm test --workspace=packages/shared` to make sure the world contract is unchanged.
- [ ] **Step 4: Commit** `feat(arena3d): squad robots with spawn, work and finish choreography`. Visual verification happens in Task 14.

### Task 13: WebSocket subscribe-before-history

**Files:**
- Modify: `packages/orchestrator/src/server/websocket.ts:88-180`
- Test: `packages/orchestrator/src/server/__tests__/websocket.test.ts` (create; use `ws` against an in-process server built the way `competitions.test.ts` builds the app, with a fake repo and a `runnerRegistry` entry backed by an `EventEmitter`)

**Interfaces:**
- Produces, as a handler sequence:
  1. Handshake.
  2. If a runner is registered: subscribe and buffer live events.
  3. `repo.getEvents(id, lastSeq)` → send with `_seq`.
  4. Flush the buffer, skipping any `eventId` already sent.
  5. Switch to direct sending.
  6. Only then check `repo.getResult` → COMPLETE + close.
  
  `_seq` stays contiguous from `lastSeq + 1`. History rows use `eventId: row.id`, which is the ArenaEvent `eventId` (`repository.ts:55`).

- [ ] **Step 1: Write failing tests:**
  - `does not lose an event emitted while history is being read`: the fake `getEvents` awaits a promise; while it is pending the runner emits SUB_AGENT_DONE `x` → the client receives `x` exactly once.
  - `does not duplicate an event that is both persisted and buffered`: the same `eventId` in history and buffer → received once.
  - `_seq is contiguous`.
- [ ] **Step 2: Run** them. Expected: FAIL (the first one).
- [ ] **Step 3: Implement** it.
- [ ] **Step 4: Run** the orchestrator tests. Expected: PASS.
- [ ] **Step 5: Commit** `fix(server): subscribe before reading history so reconnects lose nothing`

### Task 14: Demo seed, browser verification and docs

**Files:**
- Create: `packages/orchestrator/src/dev/seed-squad-demo.ts`
- Modify: `CLAUDE.md` (Event normalizers, Live battle visualization, Agent processes, Judging pipeline limits, Known Issues), `CHANGELOG.md`

**Interfaces:**
- Consumes: `loadFixture`, `ClaudeNormalizer`, `CodexJsonNormalizer`, gemini `normalizeLine`, the repository (`DATABASE_URL` required).
- Produces: `npx tsx packages/orchestrator/src/dev/seed-squad-demo.ts`, which creates a COMPLETE three-team competition and prints its id.
  - Teams: `claude:architect`, `codex:standard`, `gemini:speedrunner`.
  - Brief: *The First Paying Customer*, loaded from a path given by `--brief`, defaulting to `briefs/fizzbuzz-cli.yml` when absent.
  - Events: fixture lines run through the real normalizers, re-timed across 180 s, plus synthetic `opSource: 'watch'` `squad: true` file events for Codex and Gemini children.

- [ ] **Step 1: Write and run** the seed script. Expected: it prints a competition id, and `psql -d arena -Atc "select count(*) from events where competition_id='<id>' and type like 'SUB_AGENT%'"` is > 0.
- [ ] **Step 2: Verify in the browser.** Start the stack:
  - API: `DATABASE_URL=postgresql://localhost/arena ARENA_SKIP_SANDBOX=true npx tsx packages/orchestrator/src/cli.ts serve --port 3000`
  - web: `cd packages/web && npm run dev`, via `.claude/launch.json` and the preview tools
  
  Then open `/competitions/<id>/replay` and `/competitions/78c7452f-bab5-47cf-915e-188249503c80/replay`. Check:
  - 3D: squad robots appear, aim sparks at their own blocks (Claude), unassigned pulses (Codex/Gemini), salute and fade, with no robot left after the end.
  - Three headers with squad chips and deliverable strips.
  - Isometric markers.
  - Log rows with `↳ label`.
  - No console errors.
  - Frame rate: `javascript_tool` samples `requestAnimationFrame` deltas for 5 s at peak squad. Expected: median ≤ 20 ms (≥ 50 fps).
  
  Take screenshots at 2 teams (the stored match) and 3 teams (the seed).
- [ ] **Step 3: Update docs.** CLAUDE.md:
  - Codex now runs `--json` with network access, live search, multi-agent V1 pinned and a spawn cap.
  - The squad event contract and `metadata.agentId`.
  - The lifecycle closure rule.
  - The watcher (`opSource: 'watch'`).
  - Isolation flags.
  - Limits: 3 h ceiling, judge 24K/240K, scaled timeouts and one retry.
  - The leaderboard credits the lead's model.
  - Known Issues:
    - #1 is resolved for Codex.
    - The WebSocket gap is resolved; remove it from Next session.
    - New: Gemini has no spawn cap.
    - New: Codex and Gemini attribution and lifecycle timing.
    - New: the heuristic scorer formula, owned by the other session.
  
  CHANGELOG gets an entry under a new heading.
- [ ] **Step 4: Run** the full suite: orchestrator tests, shared tests, orchestrator typecheck, web tsc, video build. Expected: all PASS.
- [ ] **Step 5: Commit** `docs: agent squads — CLAUDE.md, changelog, demo seed`

### Task 15: Rehearsal gate (controller-run; owner approval required)

Not an implementer task. The controller asks the owner before spending money.

- [ ] **Step 1: Ask the owner** to approve three cheap real runs, one per provider (`--time-limit 300000`). Each uses a small two-part brief whose prompt makes two parallel sub-agents natural (for example `briefs/roman-numerals.yml` plus an extra deliverable), launched through the web server so the WebSocket path is exercised.
- [ ] **Step 2: For each run, check:**
  - at least two SUB_AGENT_SPAWN events with matching DONE events;
  - unassigned watch files appear live for Codex and Gemini;
  - after a forced browser reload mid-run, the live view and the replay agree on member ids, statuses and files;
  - no robot is left at the end.
- [ ] **Step 3:** Record the outcomes in the PR description. Then offer the owner the 45-minute three-way acceptance run on *The First Paying Customer*.
