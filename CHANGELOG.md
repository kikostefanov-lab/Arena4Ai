# Changelog

Newest first. Each entry says what changed, why, how it was verified, and what was left open.

## 2026-11-18 — honest fallback scores (branch `fix/honest-fallback-scorer`)

**What was wrong**
- When the AI judge failed, `rubric-scorer.ts` scored most criteria as
  `min(maxScore, totalChars / 500 * maxScore)`: 500 characters of anything earned full marks,
  even with every named deliverable missing. A judge outage could rank scratch notes first.
- The UI showed that number exactly like an AI-judged score.

**What changed**
- The fallback now scores completeness only. Each `brief.deliverables` entry that names a file
  earns full credit when that file was handed in with substance, 0.2 when it is a placeholder
  (under 40 non-whitespace characters), and nothing when it is missing. Extra files earn
  nothing, and length beyond the placeholder check counts for nothing. When the brief names no
  file, it only checks that something substantive was handed in.
- Quality is never assessed, so heuristic scores are capped at 50% (`HEURISTIC_CEILING` in
  `@arena/shared`). Execution-based `correctness` (with `expectedOutput`) is unchanged.
- Fallback results carry `heuristic: true`. The match page shows a HEURISTIC tag and a banner
  explaining the score, spectate shows the tag, and gallery cards mark it `73%*`.
  `isHeuristicScore()` also recognises older results by their `automated` judge id.

**Verified**: orchestrator (589) and shared (87) tests, all three typechecks, and the three UI
views on a temporary heuristic-scored copy of a local match (since deleted).

**Left open**: the cap means a team scored by the fallback cannot beat an AI-judged team on a
good day. That is deliberate (an unjudged score should not outrank a judged one); Re-judge is
the remedy. A deliverable entry that starts with a dotted word (`Node.js CLI`) is read as a
file name.

## 2026-11-14 — live model catalog and honest agent failures (branch `feat/live-model-catalog`)

The first real end-to-end run after #17 found that stale model ids broke Codex and Gemini, and
that a broken agent was recorded as a fair 0% loss.

**What was wrong**
- Existing databases kept the seeded ids `codex-standard`, `gemini-2-flash` and
  `claude-sonnet-4-6`: seeding only inserts missing rows. The registry's replacements
  (`gpt-5.3-codex`, `gemini-3-*`) were not offered by the installed CLIs either, and the Gemini
  adapter fell back to `gemini-3-flash` when no model was set.
- An agent CLI that exited with an error left no trace. The Codex normalizer dropped the error
  line, and the non-zero exit only rejected a promise nobody read. The judge then scored the
  empty workdir as 0%, and agent stats counted the loss.
- gemini-cli 0.68 refuses to run headless in an untrusted folder (exit 55), so every Gemini
  competitor failed immediately.

**What changed**
- `adapters/model-catalog.ts` reads each CLI's model list (`codex debug models`,
  `gemini --list-models`, Claude aliases), cached, with a static fallback. `GET /models`, the
  Armory picker and the New Battle cards use it.
- `cli-default` (no model flag) is the default for every provider and for seeded agents. Stale
  system agents are repaired on startup (server and CLI `run`).
- A pre-launch check refuses a team whose model its CLI does not list, naming the alternatives.
- Adapters record a non-zero exit as `failure`, with the CLI's own message as an `ERROR` event
  (`stage: 'agent'`). A crashed team with no files is not judged: it gets `agentFailure` on its
  scorecard and shows as "did not compete" / DNC. Stats and quality signals skip that match. If
  every agent crashed, the competition is `FAILED`.
- Gemini competitors run with `GEMINI_CLI_TRUST_WORKSPACE=true`.
- The FAILED banner shows the stored reason. The model proxy caches for 60 s instead of an hour.

**Verification**
- Typecheck passes (orchestrator, web). Tests: 582 orchestrator (16 skipped), 84 shared.
- Real runs on codex-cli 0.164, gemini-cli 0.68, Claude Code 2.1.325. Codex on `cli-default`
  scored 87.7%. A Claude team on a made-up id was reported as "did not compete", with Claude's own
  message. A user agent on `codex-standard` was refused before launch. Gemini launched from the
  web UI after the trust fix. The deadline left no agent processes in any run.

**Left open**
- Gemini's API returned 503 "high demand" for the whole Gemini run. The CLI retries until the
  deadline, so that team is judged on an empty workdir rather than marked as failed.
- User agents still on retired ids (5 here) are refused at launch, not repaired.
- Codex and Gemini judges now run on the CLI default unless `ARENA_JUDGE_MODEL` is set.

## 2026-11-14 — harness hardening (#17, `bd8d527`)

Ten security and correctness findings from a code review, each re-checked against current code
first; all ten were still true. Built as six independent tracks and one integration pass.

**What changed**
- **Helper stages run tool-less.** Judge, presentations, synthesis, forge, commentary, brief
  intake, brief generation and persona generation build their CLI args and environment through
  `utils/claude-helper.ts`: no tools, no MCP, an allowlisted environment. Codex and Gemini judges
  use `helperEnv(provider)`. Persona generation is now pinned to the stage model.
- **Network and auth.** `serve` binds to `127.0.0.1` by default. With `ARENA_API_KEY` set, every
  route needs it except `/health`. The WebSocket stream needs the key or a 60-second ticket
  bound to one competition. The API refuses browser origins that are not loopback or in
  `ARENA_ALLOWED_ORIGINS`, and the web proxy refuses cross-site writes.
- **Sandbox.** A sandboxed Claude now receives its brief. Missing Docker, daemon or image fails
  cleanly and the run ends `FAILED`.
- **Lifecycle.** Adapters are shut down at the deadline before files are collected.
  Cancellation is terminal. Agents are spawned in their own process group, the group is killed
  when the agent's CLI exits, and the CLI stops all agents on SIGINT/SIGTERM.
- **Judging.** A failed re-judge no longer overwrites results. Judge output missing a criterion
  is a failure, not a zero. A tie has no `winnerId`; only first-place teams count as tied.
- **Stats and data.** Leaderboard reads `finalScore` (averages were always zero). Forge runs
  stay in stats. Deleting a re-judged competition works. Brief prefill keeps `expectedOutput`.

**Verification**
- Typecheck and build pass. Tests: 545 orchestrator (16 skipped) and 84 shared, with no database.
- Against a running stack with a key set: loopback bind; 401 on reads without the key; 403 for a
  foreign origin on HTTP and WebSocket; 403 for a cross-site write through the web proxy; stream
  open with a ticket and refused without one or with another competition's.
- Two real helper calls with the hardened flags: sign-in worked, and an instruction to run a
  shell command produced no file.

**Not verified**
- Docker sandbox (no Docker where this was built; tested with stubbed processes).
- A live competition end to end, including the deadline shutdown against real agent CLIs.
- A helper call from a plain terminal (the check ran inside a Claude Code session).
- Windows.
- The last commit on the PR (process-group sweep, leaderboard ties) was merged on local test
  results, before CI ran on it.

**Gotchas**
- Two "POST returns 201" tests (`tournaments.test.ts`, `security.test.ts`) each failed once in
  roughly fifteen full runs through turbo and passed on every rerun. Cause not found.
- Behaviour changes: reads need the key when one is set; the server is local-only by default.

## 2026-11-14 — v2.0.0: the 3D arena (#15, `0a165cc`)

**What changed**
- **3D view.** The competition page has `3D` (desktop default), `Iso` and `Log`. The 3D scene is
  a second picture of the same world model as the isometric arena: one block per file, height is
  the edit count, dashed edges for inferred depth, hollow for providers that cannot report edits.
- **Robots.** `tools/blender/build_gladiators.py` generates the Claude, Codex and Gemini models
  procedurally and exports `packages/web/public/models/gladiators.glb`.
- **Sizzle reel.** Its two arena scenes (`RobotReveal`, `ArenaDistrict`) draw with the same
  `Arena3D` class through `drawFrame()`, a pure function of `(world, frame)`. The scene lives in
  `packages/video/src/arena3d/scene.ts`; the web app imports the compiled output.
- Reel encoding moved to the `veryslow` preset and CRF 34: landscape is 9.2 MB (5.3 MB for the
  previous 2D reel, 18.1 MB at the old settings).

**Verification**
- Typecheck, tests (454 at the time) and build passed.
- Browser: finished two-team matches in the 3D view (render, replay, camera cuts).
- Reel: stills of every 3D shot in landscape, two each in portrait and square.

**Not verified**
- A live running match in 3D, three or more teams, the WebGL fallback path.
- Reel playback at speed (quality was compared on still crops).

**Gotchas**
- Review found two real bugs after the first browser check, both fixed before merge: blocks did
  not animate in 3D during live play (the easing lived in the isometric draw path), and the
  canvas was not resized after switching views. The first check only looked at a finished match.
- After editing `packages/video/src/arena3d/scene.ts`, rebuild `@arena/video`; the web app
  consumes its `dist/`. A stale Next dev server needs a restart after files move packages.
- Package versions still read `0.1.0`; the `v2.0.0` tag is the version of record.
