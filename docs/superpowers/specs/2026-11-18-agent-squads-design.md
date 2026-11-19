# Agent squads — design

Date: 2026-11-18 · Status: draft v2 for owner approval (revised after builder check and two
adversarial critics: Claude Fable and Codex gpt-6.2-astra)

## Intent

Arena4Ai should take on **bigger briefs**: work one agent cannot finish alone in the time
limit, where a team's lead agent splits the job across a squad of sub-agents. Spectators
should **see the squad live in the 3D arena**. Each sub-agent appears as its own robot next
to its lead, works, and leaves when it is done. The picture must stay clean, readable and
honest with three teams on the floor.

The first event this is for: a three-way match (Claude vs Codex vs Gemini) on
*The First Paying Customer* brief (the owner's brief file, kept outside the repo).
That brief splits naturally into three research tracks, then a decision, then a demo build
and a go-to-market plan that can run in parallel.

## What exists today (verified 2026-11-18)

| | How it spawns | What the stream tells us | Today in Arena |
|---|---|---|---|
| Claude 2.1.325 | `Agent` tool (init list says `Task`). Spawns unasked. | Everything. `system/task_started` with `task_type: "local_agent"` (`task_id`, `tool_use_id`, `description`, `subagent_type`, `is_backgrounded`, `spawn_depth`); sub-agent lines tagged `parent_tool_use_id` + `agent_id`; `task_progress`; `task_updated` (status) then `task_notification` (summary, usage). **`task_started` is also emitted for long shell commands (`task_type: "local_bash"`).** | Seen in 5 past matches. Stored as raw REASONING payloads (`78c7452f-…` holds 4 `task_started` and 4 `task_notification`). File writes are credited to the lead. |
| Codex 0.169 | `spawn_agent` / `wait` / `close_agent` (`multi_agent` V1). **Its system prompt says: "Do not spawn sub-agents unless the user … explicitly ask for sub-agents, delegation, or parallel agent work."** | Only with `--json`: `collab_tool_call` items. Under V2 (`multi_agent_v2`) no spawn items appear at all. Children's own work is not in the parent stream, and a child's completion is only reported when the lead calls `wait` or `close_agent`. | Plain-text adapter; bare `collab: SpawnAgent` lines with no ids. |
| Gemini 0.68 | `invoke_agent {agent_name, prompt}`, built-in `generalist`. Spawns unasked, in parallel. | `tool_use` / `tool_result` with `tool_name: "invoke_agent"`. Children's own tool calls are not in the stream; results can arrive batched. | Already `-o stream-json` with `GEMINI_CLI_TRUST_WORKSPACE`. `invoke_agent` is an ordinary tool call. |

Research transcripts: `/private/tmp/claude-501/subagent-research/{claude,codex,codex2,gemini}/`
(temporary; the builder copies trimmed versions into test fixtures first).

## Goals

1. Every sub-agent is recorded as its own identity in the event log, with a lifecycle that
   always closes (spawned → completed / failed / killed / unknown), and, where the CLI reports
   it, its own tool calls and file writes.
2. The live 3D arena draws a robot per active sub-agent in its team's band, with spawn, work
   and finish animations, for 2–4 teams.
3. Every team's header shows squad status and which named deliverables exist.
4. Briefs can be big enough to need a squad.
5. A three-way match on *The First Paying Customer* runs end to end, looks good, and survives
   a viewer reconnecting.

## Non-goals

- No "solo" mode. Squads are always on (owner).
- No scoring of orchestration (no rubric criterion, efficiency score or squad leaderboard).
- No recap-reel or sizzle changes. `drawFrame()` must keep working and stay pure.
- No reading Codex's private session files (`~/.codex/sessions/…`).
- No Claude agent-teams (`TeamCreate` is unavailable in `--print`).
- No cumulative token budget per team. Usage is not reported comparably across the three CLIs;
  the concurrency cap and the wall-clock cutoff bound cost instead.

## Anti-goals

- A cluttered arena or unreadable labels.
- A picture that lies: a team looking quieter because its CLI reports less, a robot still
  "working" after its match ended, or a file credited to someone who did not write it.
- Breaking replays, or the isometric and log views.
- Runaway cost.

## Approaches considered

- **A. All three providers in one project (chosen by the owner).** The first event is a
  three-way match; shipping Claude alone would make Codex and Gemini look solo on stage.
- **B. Claude first, then the others.** Lower risk per change, nothing to show for the event
  until stage two.
- **C. Infer squads from the current text streams.** Dropped: no ids for Codex, no lifecycle
  for Gemini.

Build order inside A: shared contract and world model, then Claude (richest data), then
Codex, then Gemini, then arena and HUD, then the rehearsal.

## Design

### 1. Event contract (`@arena/shared`)

- `ArenaEvent.metadata.agentId?: string` on every event produced by a sub-agent. Absent means
  the lead.
- `SUB_AGENT_SPAWN` payload: `{ agentId, parentAgentId?, label, description, kind?, model?, background?, depth }`.
  `label` ≤ 18 chars, derived from the description.
- New `SUB_AGENT_DONE` payload:
  `{ agentId, status: 'completed' | 'failed' | 'killed' | 'unknown', reason?, summary?, model?, usage? }`.
  At most one per `agentId`; later terminal records for the same id are merged into the
  first (for example, Claude's `task_updated` then `task_notification`).
- `ProviderFileCapability` gains:
  - `subagentAttribution: boolean`: sub-agents' own files and tools reach us (claude true, codex and gemini false);
  - `subagentLifecycle: 'live' | 'collected'`: done is reported when it happens, or only when the lead collects it (claude live; codex and gemini collected).
- `FileOpSource` gains `'watch'` (section 2a).
- `FrameEvent` gains `agentId?`, `squad?: boolean` and the kinds `spawn` and `agentDone`.
- DB `events.type` is free text, so no migration.

### 2. Normalizers

**Claude**
- `system/task_started` → `SUB_AGENT_SPAWN` **only when `task_type === "local_agent"`**.
  Other task types (`local_bash`) are ignored, and done records for unknown ids are ignored.
- `task_updated` with a terminal `patch.status`, or `task_notification` → `SUB_AGENT_DONE`
  (merged by id).
- Lines with `parent_tool_use_id`: normalize as today and add `metadata.agentId`
  (`tool_use_id → task_id` from `task_started`, falling back to the line's `agent_id`).
  `model` is taken from the first sub-agent `assistant` line.
- Keep reading only the last content block. Do not pass `--forward-subagent-text`.
- Several `init` and `result` lines per process are expected (background sub-agents start a
  second turn). The adapter already waits for process exit.
- **Read-time upgrade for stored matches:** `event-model.ts` derives `spawn` and `agentDone`
  frame events from stored raw `task_started` / `task_notification` payloads (REASONING
  events with `raw.type === "system"`). Old replays therefore show squad lifecycle, with no
  per-agent file attribution. This is the only change to old replays, and it is what they
  really did.

**Codex** (new JSON normalizer, `codex exec --json`, JSONL on stdout)
- Pin multi-agent V1: pass `--disable multi_agent_v2` explicitly, because V2 hides spawn items.
- Act on `item.completed` only:
  - `agent_message` → REASONING;
  - `command_execution` → TOOL_CALL;
  - `file_change` → one FILE_CREATE / FILE_MODIFY per entry in `changes` (path made relative, `opSource: 'marker'`);
  - `web_search` → TOOL_CALL;
  - `reasoning` / `error` (unobserved so far) → REASONING / ERROR;
  - unknown types are ignored.
- `collab_tool_call`:
  - `spawn_agent` completed → `SUB_AGENT_SPAWN` per new receiver id;
  - `spawn_agent` failed (cap reached) → no spawn, a REASONING note;
  - `wait` / `close_agent` completed → `SUB_AGENT_DONE` per terminal `agents_states` entry.
- A `wait` naming no known child → an honesty note "Codex reported a squad it did not
  identify". The team is never drawn as solo on a hidden squad.
- stderr is kept for crash messages only. The operator's MCP noise must not become ERROR events.
- The old text normalizer is removed once the JSON one passes. Stored events are unaffected.

**Gemini**
- `tool_use` with `invoke_agent` → `SUB_AGENT_SPAWN` (`agentId = tool_id`, `kind = agent_name`).
- Its `tool_result` → `SUB_AGENT_DONE` (`success` → completed, else failed).

### 2a. Closing every lifecycle (`BaseAdapter`)

`BaseAdapter` keeps the set of open sub-agents from the events it emits. When the process
exits, or `shutdown()` runs, it emits one persisted `SUB_AGENT_DONE` for each open member:
- `killed` with `reason: "deadline"` when the arena shut the agent down;
- `unknown` with `reason: "lead exited without reporting"` otherwise.

This closes members on early exits, crashes and deadlines alike, and it lives in the event log,
so live, replay and seek agree. The world does **not** infer kills from competition state.

### 2b. Workdir watcher (all providers)

Codex and Gemini children's files never reach the stream (`codex2/r5`: 3 children spawned,
no `file_change` items, files on disk; `gemini/run3.jsonl`: no write calls). Without a watcher,
their cities would fill in only after collection.

- `BaseAdapter` watches its workdir while the agent runs (recursive `fs.watch` where supported,
  else a 2 s poll). It reuses the collector's and `event-model.ts`'s exclusions
  (`isVendoredPath`, `node_modules`, `.git`, dot-dirs) and the size limits.
- **The stream always wins.** A watch observation is held for 5 s. It is dropped if the stream
  reports that path in that window, and emitted with `opSource: 'watch'` otherwise. Stream
  events are never dropped.
- A watch event has no `agentId` and is never assumed to be the lead's: it gets `squad: true`
  while any sub-agent is open, and is lead-or-unknown otherwise. It is drawn as unassigned
  (block rises with a pulse at the block, no spark from any robot).
- Watch events **never increment edit depth**: a filesystem notification is not an edit. A
  block that exists only through watch events renders with the existing `inferred` depth
  treatment.
- The watcher stops at the start of `shutdown()`, before collection.

### 3. Limits, fairness, isolation

- **Concurrency cap of 6 sub-agents per team, depth 1**, constants with env overrides
  (`ARENA_SQUAD_MAX_CONCURRENT`, `ARENA_SQUAD_MAX_DEPTH`):
  - Claude: `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=6` (verified), `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`.
  - Codex: `-c agents.max_concurrent_threads_per_session=6` (verified, soft cap). No verified depth key.
  - Gemini: no mechanism. We observe only (documented asymmetry).
- **Web access for Codex:** `-c sandbox_workspace_write.network_access=true` and
  `-c web_search=live` (both verified), so research briefs are fair.
- **Wall-clock cutoff:** pause freezes the arena clock but agents keep running
  (`competition-runner.ts:183`). Each adapter gets an unpausable hard stop at
  `timeLimitMs × 1.5` of real time.
- **Isolation (owner decision):** competitors get only their CLI's built-in tools and built-in
  sub-agent types. No user MCP servers, plugins, hooks or custom agents; today the research runs
  loaded 212 tools including the operator's personal MCP servers, a `codex:codex-rescue`
  agent, and operator hooks that told children to run a `bootstrap` skill.
  - Claude: `--strict-mcp-config` with no config, user settings, plugins and hooks off, auth intact.
  - Codex: no MCP servers, no user instructions.
  - Gemini: no extensions or MCP servers.
  - Each flag is verified on the installed CLI.
- **Sub-agent models (owner decision):** the CLI picks. `model` is recorded on spawn/done when
  the stream reveals it, and shown in the squad chip tooltip and Log view. CLAUDE.md documents
  that the leaderboard credits the lead's model ("a team led by X").

### 4. Prompt (`BaseAdapter.injectBrief`)

Codex only delegates when explicitly asked, so `[SQUAD]` is an instruction, not a permission:

```
[SQUAD]
You are the lead of a squad. Delegate independent parts of this brief to sub-agents running
in parallel (up to 6 at a time), and integrate their results yourself.
1. First, write a skeleton of every named deliverable, so something exists if time runs out.
2. Give each sub-agent one clear task, the file it must write, and a time box well inside
   the time limit. Sub-agents work in this same directory.
3. Finish integrating and writing final deliverables before 80% of the time limit.
Only files in this directory are judged.
```

The builder tunes the wording, but it must keep the explicit "delegate" instruction, the
skeleton-first rule and the time box.

### 5. Bigger briefs and the judge

- Time limit ceiling raised from 1 hour to **3 hours** (`parser.ts` and the UI). This is the
  owner's stated purpose. The first event stays at 45 minutes.
- **Collection** reserves its 5 MB for the brief's named deliverables first, then walks the rest,
  and records what was excluded.
- **Judge context:** named deliverables first, then the rest; 24K per file, 240K total; always
  an explicit omission line. Presenter at 12K / 120K. Synthesis and Forge unchanged.
- **Judge and presenter timeouts** scale with input: 120 s plus 1 s per 2K characters, capped at
  600 s. Today a fixed 120 s timeout (`ai-judge.ts:388`, `presentation-generator.ts:98`) would
  drop a squad's team to the heuristic scorer on stage.
- **One judge retry** before falling back to the heuristic scorer. The heuristic gives full
  marks for 500 characters (`rubric-scorer.ts:272`); fixing that formula is a separate follow-up.

### 6. World model (`packages/shared/src/arena/world.ts`)

- `TeamState.squad: Map<agentId, SquadMember>` with
  `{ id, label, kind?, model?, spawnedAt, endedAt?, status, files, tools, lastActiveAt, slot }`.
- **All squad timestamps use the event's own `ev.t`**, never `world.t`. `seek()` sets
  `world.t` to the destination before applying history (`renderer.ts:254`). Animation age is
  derived from the playhead minus `ev.t`.
- `world.recent` entries gain `agentId?` and the structure key, so the scene can react per
  robot and aim at the right block (today it guesses the brightest block, `scene.ts:446`).
- Slots 0–5 assigned on spawn (lowest free). More than 6 open are counted, not drawn.
- Slot cells are reserved in `bandCells` so blocks never stand where squad robots stand.
- Honesty notes, by capability:
  - Codex / Gemini attribution: "Doesn't report which sub-agent wrote each file. Squad files appear as they land, unassigned."
  - Codex / Gemini lifecycle: "Finish times are when the lead collected the result, not when the sub-agent finished."

### 7. 3D arena (`packages/video/src/arena3d/scene.ts`)

- **Squad robot:** a **low-detail** variant of the team's robot at about 55% scale, same colour,
  smaller aura, excluded from the reflection pass, with a floating label. The shipped robots
  are 50–53 primitives each; 3 teams × 7 full clones would be about 1,000 primitives and 2.8M
  triangles. The builder may author the low-detail variant in
  `tools/blender/build_gladiators.py` or decimate at load.
- **Slots:** six reserved positions in a shallow arc in front of the lead.
- **Spawn:** beam from the lead, scale-up with particles, jumbotron `CLAUDE DEPLOYS SQUAD · 3 ACTIVE`.
- **Working:** with attribution, a robot reacts to its own events (tool → power, file → strike
  with a spark to that block, error → hit). Without attribution, it plays a working loop.
- **Done:** salute, fade, particles back to the lead. Failed / killed / unknown: hit pose, red fade.
- **Effects are coalesced per actor per frame** instead of the current all-or-nothing cut-off
  above 10 fresh events (`scene.ts:240`).
- **Overflow:** `+N` badge above the lead.
- **Phases:** squad cleared at freeze. The lead's end sequence is unchanged.
- **Budget:** a 3-team, 6-member scene measured at ≥ 50 fps on the dev machine before sign-off.

### 8. Isometric and log views

- Isometric: a small marker per open member next to the team figure, plus counts.
- Log: sub-agent lines indented under `↳ <label>` in team colour; spawn and done rows; model shown.

### 9. HUD (`ArenaViewerV2.tsx`)

- `LaneHeader` for every team (2–4) in one row.
- Each header gets:
  - a squad chip: `◆ 3 active · 7 spawned · 1 failed`;
  - a **deliverables strip**: each named deliverable lights when a file event for it lands (stream or watch), e.g. `decision.md ✓ demo.html ·`.
- **Momentum counts file events only** (stream and watch), not all telemetry. Today a Claude
  child emits about six events per file write and a Gemini child none, so counting everything
  would hand Claude the bar. It is an N-way share bar; two teams look as today.
- Mobile keeps falling back to Log.

### 10. Live stream reliability (`server/websocket.ts`)

A missed spawn or done would leave a ghost robot for that viewer. Today the socket reads
history and then subscribes (`websocket.ts:114` vs `:173`); this is a known issue in CLAUDE.md.
Fix it here: subscribe and buffer first, read history, then merge by `seq` with dedup.
Test a reconnect while a child finishes.

### 11. Docs

Update CLAUDE.md:
- event normalizers: squad events, Codex JSON, the read-time upgrade;
- the live battle visualization;
- isolation;
- the time and judge limits;
- what the leaderboard means;
- Known Issues: #1 resolved for Codex, the WebSocket gap resolved; new entries for Gemini having no cap, Codex/Gemini attribution and lifecycle timing, and the heuristic scorer formula.

## Testing

- **Normalizers:** fixtures from the research transcripts:
  - Claude: parallel, background, the `local_bash` task, and the concurrency refusal;
  - Codex: V1 spawn, wait, `close_agent`, failed spawn, `file_change` with several files;
  - Gemini: parallel `invoke_agent`.
- **Lifecycle closure:** exit with open members → `unknown`; shutdown → `killed`; no duplicate DONE.
- **Watcher:** temp-dir tests for the hold window, stream-wins, vendored paths, no depth increment.
- **World:** spawn/done ordering, seek backward and forward (timestamps from `ev.t`), slot reuse,
  overflow, read-time upgrade of `78c7452f-…`, legacy streams unchanged otherwise.
- **Brief context and collection:** named deliverables first; the omission line is present.
- **WebSocket:** reconnect during a child completion loses nothing.
- **3D:** replay `78c7452f-…` (real Claude squad lifecycle) and a seeded synthetic three-team
  match (`scripts/seed-squad-demo.ts`, built by running fixtures through the real normalizers)
  in the browser preview. Screenshots at 2 and 3 teams, plus the fps measurement.
- **Isolation smoke test:** per provider, assert from the startup output that no user MCP tool
  or plugin agent is offered. For Codex, whose startup line lists no tools, assert that no MCP
  server starts on stderr.
- **Rehearsal (gate before the event):** one cheap real run per provider through the real
  server and WebSocket viewer. Each must spawn at least two children that complete, and one
  viewer reconnects mid-run. Live and replay must agree on child identities, terminal outcomes
  and unassigned files. This costs real API money; the owner approves it.
- **Acceptance:** the three-way 45-minute run on *The First Paying Customer*; the owner approves it.

## Decided by the owner

- Squads always on; no solo mode.
- All three providers in one project (approach A).
- Visible squad robots in the 3D arena, clean and readable; purpose is bigger briefs.
- Competitors isolated from the operator's personal CLI setup.
- Sub-agents use whatever model their CLI picks; the models used are recorded and shown.

## Builder's calls (marked so the owner can check them)

- Cap of 6 concurrent, depth 1; Gemini uncapped.
- Codex gets network access and live web search, pinned to multi-agent V1.
- An explicit "delegate" `[SQUAD]` instruction with skeleton-first and time boxes.
- Wall-clock hard stop at 1.5× the time limit.
- 3-hour ceiling; judge 24K/240K with scaled timeouts and one retry; presenter 12K/120K.
- Workdir watcher where the stream always wins and watch events never add edit depth.
- Momentum from file events only; a deliverables strip per team.
- Read-time squad lifecycle for stored matches.
- Low-detail squad robots, fixed reserved slots, ≥ 50 fps budget.
- Fix the WebSocket history/subscribe gap in this project.

## Critic review (2026-11-18)

Two adversarial critics reviewed v1: Claude Fable and Codex gpt-6.2-astra. Each claim below
was checked against the code or transcripts before being adopted.

| Finding | From | Verdict |
|---|---|---|
| Codex won't spawn unless explicitly asked; V2 hides spawns | both | **Adopted**: explicit `[SQUAD]` instruction, V1 pinned, honesty note for unidentified squads (verified in rollout text) |
| Claude `task_started` also fires for shell tasks | both | **Adopted**: `local_agent` only (verified: 2 of 12 stored are `local_bash`) |
| Members never close; TIME_UP isn't an event | both | **Adopted**: adapter emits DONE for open members on exit/shutdown (verified: no state events in the DB) |
| Watcher dedup inverted; watch events would fake edit depth | both | **Adopted**: stream always wins, hold window, no depth from watch |
| Momentum rewards logging volume | both | **Adopted**: file events only, plus a deliverables strip |
| Seek stamps events with the seek target | Astra | **Adopted**: `ev.t` everywhere (verified `renderer.ts:254`) |
| Scene guesses the target block; drops batches >10 | Astra | **Adopted**: actor and block on `recent`, per-actor coalescing |
| WebSocket reconnect loses events | Astra | **Adopted**: fix in scope (already a known issue) |
| Pause leaves agents running | Astra | **Adopted**: hard stop at 1.5×. Cumulative usage limit **rejected** (no comparable usage data) |
| Collection fills 5 MB before named files | Astra | **Adopted** |
| Full-detail clones threaten frame rate | Astra | **Adopted**: low-detail variant, measured budget |
| Judge timeout fixed at 120 s | Fable | **Adopted**: scaled timeout (verified `ai-judge.ts:388`) |
| Heuristic fallback gives full marks for 500 chars | Astra | **Partly**: one judge retry here; formula fix is a separate follow-up (verified `rubric-scorer.ts:272`) |
| Smoke test too weak | Astra | **Adopted**: real rehearsal gate, Codex MCP check via stderr |
| Deadline could leave no named deliverables | Fable | **Adopted**: skeleton-first and time boxes in the prompt |
| Lifecycle timing not comparable (Codex/Gemini report late) | Fable | **Adopted as an honesty note**; an extra "awaiting report" robot state **rejected** as clutter |
| Squad slots collide with first blocks | Fable | **Adopted**: reserved slot cells |
| Stored matches do have lifecycle data | Fable | **Adopted**: read-time upgrade (verified; corrects v1 and the builder check) |
| Drop the 3-hour ceiling and bigger judge budget | Fable | **Rejected**: bigger briefs are the owner's stated purpose. The timeout fix makes the budget safe |
| Judge shares the Claude login with the competitor (quota risk) | Fable | **Noted as a risk** for the rehearsal to surface |

## Open item for the owner (not blocking the build)

*The First Paying Customer* has two deliverables capped at 8,000 characters each, so every
squad member would spark the same two towers. Adding per-candidate research files
(`research/cleaning.md`, `research/barcode.md`, `research/kegs.md`) and a `pilot.md` would give
each robot its own tower. The brief is the owner's; the builder does not change it.
