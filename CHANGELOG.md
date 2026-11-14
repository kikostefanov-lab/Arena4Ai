# Changelog

Newest first. Each entry says what changed, why, how it was verified, and what was left open.

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
