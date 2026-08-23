# Security Policy

## Read this before you run Arena4Ai

Arena4Ai is not a normal web application. Understanding what it actually does is the
security policy — everything below follows from it.

**Arena4Ai spawns AI agent CLIs on your machine and then handles what they produce.**
It shells out to the `claude`, `codex` and `gemini` binaries you already have installed,
using *your* existing CLI auth, and it launches them with their permission prompts
switched off on purpose:

| CLI | Flags Arena4Ai passes |
|---|---|
| `claude` | `--print - --output-format stream-json --verbose --dangerously-skip-permissions` |
| `codex` | `codex exec --skip-git-repo-check -s workspace-write` |
| `gemini` | `-p <prompt> --yolo` |

An agent racing a brief therefore writes and runs code with no human in the loop. That is
the point of the tool, and it is the reason the rest of this document exists.

Everything in this file was checked against the code on this branch rather than against a
design doc. File references are given so you can check it yourself.

## The Docker sandbox

Each team's agent CLI can be run inside a container built from `Dockerfile.agent`
(`packages/orchestrator/src/sandbox/sandbox-manager.ts`), with only that team's working
directory bind-mounted at `/workspace`, capped at 2 GB RAM and 1 CPU.

**Defaults, as implemented:**

- **Anything launched over HTTP (which means anything launched from the web UI) is
  sandboxed** unless the *operator* opts out with `ARENA_SKIP_SANDBOX=true` in the server's
  environment. `skipSandbox` is deliberately **not** readable from a request body, and
  neither are the binary paths `CLAUDE_BIN` / `CODEX_BIN` / `GEMINI_BIN`. Both are resolved
  from the process environment only — see the comment block at the top of
  `packages/orchestrator/src/server/run-options.ts`. A caller who could set either would be
  asking your server to execute a binary of their choosing as you.
- **CLI runs** (`cli.ts run`, `cli.ts tournament run`) are also sandboxed by default;
  `--skip-sandbox` opts out. Most examples in the README pass `--skip-sandbox`, which is why
  they work without the image built.
- You must build the image yourself — nothing builds it for you:
  `docker build -f Dockerfile.agent -t arena-agent:latest .`
- `serve` accepts a `--skip-sandbox` flag that is **not wired up and is silently ignored**.
  Use the `ARENA_SKIP_SANDBOX=true` environment variable.

## What the sandbox is NOT

**The sandbox is filesystem isolation and a resource cap. It is not a security boundary
against a hostile deliverable.** Two properties of how the container is launched make that
true, and you should assume both:

1. **`--network host`.** The container shares the host's network namespace. There is no
   network isolation and no egress filtering. Code running inside it can reach every service
   listening on your loopback interface — your orchestrator on `:3000`, your PostgreSQL on
   `:5432`, anything else you have running locally — exactly as if it were running on the
   host.
2. **Your whole environment is forwarded.** Every variable in the orchestrator's environment
   is passed into the container with `-e` (`utils/claude-env.ts` copies `process.env` and
   removes only `CLAUDECODE`). That includes `DATABASE_URL`, `ARENA_API_KEY` and any cloud
   or provider credentials that happen to be exported in the shell you started the server
   from.

So: a container escape is not required to do damage. Treat the sandbox as protection against
an agent wandering across your filesystem, and as protection against nothing else. Run
Arena4Ai on a machine, and from a shell, whose contents you would not mind an autonomous
agent seeing.

## Deliverables are executed on the host, not in the sandbox

To score a `correctness` criterion against a brief's `expectedOutput`, the fallback
automated scorer has to run the deliverable and diff its stdout. That happens in the
orchestrator process — **on the host, even when the sandbox is enabled for the agents**. The
sandbox covers the agents; it has never covered this.

For that reason host execution is **off by default** and must be opted into explicitly:

```bash
ARENA_ALLOW_HOST_CODE_EXECUTION=true
```

resolved from the process environment only, never from a request body. With it unset, the
affected criterion is reported as skipped and excluded from the weighted score rather than
scored zero. See `packages/orchestrator/src/judging/rubric-scorer.ts`. Only turn it on if you
are prepared to execute code written by a model you did not supervise, as your own user.

## Do not expose the orchestrator port to the internet

The orchestrator (default `:3000`) is designed for `localhost`. Bind it there, and keep it
behind your own network boundary. If it must be reachable by anything other than your own
machine:

- Set `ARENA_API_KEY`. Mutating **competition** routes then require
  `Authorization: Bearer <key>`. Set the same value in the web package's environment — the
  Next.js proxy routes attach the header server-side, so the browser never sees it.
- **Know the gap:** `requireApiKey` is currently applied only to the `/competitions` routes.
  `POST /tournaments` (which launches competitions), `POST|PUT|DELETE /briefs`,
  `POST /generate-brief`, `POST /generate-persona`, and the `/agents`, `/agent-profiles` and
  `/personas` write routes are **not** gated by it, whatever `ARENA_API_KEY` is set to. Some
  of those spawn `claude` on your machine using your CLI auth. `ARENA_API_KEY` narrows the
  exposure; it does not close it. Do not rely on it as your only boundary.
- Read routes and the WebSocket event stream are open by design.

Rate limits exist — 10/min on the whole `/competitions` router, 20/min each on
`/generate-brief` and `/generate-persona` — but they are abuse dampers, not authentication.
Note that the 5/min forge/synthesis limiters are registered *after* the competitions router
in `server/app.ts`, so on the current code they do not appear to take effect; do not count on
them.

There is no user system, no multi-tenancy and no authorization model. One shared secret is
the entire access-control story. That is a deliberate fit for a single-operator, self-hosted
tool — not an oversight to work around.

## Supported versions

Arena4Ai is self-hosted and released from `main`. Only the latest commit on `main` is
supported. There are no backported security fixes for older checkouts — pull and re-run.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's private vulnerability reporting: the repository's
**Security** tab → **Report a vulnerability**. That opens a draft advisory visible only to
you and the maintainer. If that is unavailable to you, contact the maintainer privately
through their GitHub profile rather than filing publicly.

Please include:

- what an attacker can do, and what they need in order to do it (network position, an
  existing account, a brief they control, a deliverable they control, …);
- the exact commit you are on;
- your OS, Node version, and whether you ran sandboxed or with `ARENA_SKIP_SANDBOX=true`;
- reproduction steps, ideally including the brief and the resulting event log.

**What to expect:** an acknowledgement within about a week, and an assessment of whether the
behaviour is a bug or a documented consequence of the design. This is a hobby-scale,
single-maintainer project — there is no paid on-call rotation and no bounty programme.

### What is in scope

- Anything an HTTP request can cause that the operator did not ask for: choosing the binary
  that gets spawned, turning off the sandbox, escaping the team-id validation into a path or
  a shell (`isSafeTeamId`, `run-options.ts`), reading or writing outside a team's workdir.
- Auth bypass on the routes that *are* gated by `ARENA_API_KEY`.
- Leaking secrets into deliverables, event logs, the database, or the UI.
- Injection into the judge/synthesis/forge prompt chain that changes what the orchestrator
  *executes*, as opposed to what it *scores*.

### What is not in scope

These are documented design consequences, listed above. Reporting them is not a
vulnerability report — though a concrete, better design for any of them is very welcome as
an issue:

- Agents running with permission prompts disabled.
- `--network host` giving container code access to loopback services.
- The operator's environment being forwarded into the container.
- Deliverable execution on the host when `ARENA_ALLOW_HOST_CODE_EXECUTION=true`.
- A model producing a deliverable that is malicious, or a brief that talks the judge into a
  higher score. Prompt-injecting the scoring is a *quality* problem; file it as a normal
  issue.
- Anything that requires the operator to have already exposed the port to a hostile network
  contrary to this document.
