# Contributing to Arena4Ai

Thanks for wanting to work on this. Arena4Ai is a self-hosted tool: you clone it, you run it
with the agent CLIs you already have, and nothing phones home. Contributing works the same
way — everything below runs on your machine.

Every step here is derived from the repo as it stands. If a command in this file does not
work, that is a bug in this file; please open an issue.

---

## Before you start

Read [`SECURITY.md`](SECURITY.md) first, even if you are not doing security work. Arena4Ai
spawns AI agent CLIs with their permission prompts disabled and handles what they produce.
Knowing where the isolation boundary actually is will change how you set up your dev
environment.

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same terms the project ships under.

---

## Requirements

| Requirement | Notes |
|---|---|
| **Node.js ≥ 22** | Enforced by `engines` in the root `package.json`; `.nvmrc` pins `22`. |
| **npm ≥ 10.9** | This is an npm **workspaces** monorepo — use npm, not pnpm or yarn. |
| **PostgreSQL** | A local install is fine. Docker is *not* required for the database. |
| **The `claude` CLI** | **Required even if you never race Claude.** The judge, presenter, synthesizer, Forge, commentary and brief generator all shell out to `claude`. |
| **At least one competitor CLI** | `claude`, `codex` and/or `gemini`, on `PATH` and already signed in. |
| **Docker** | Only for the agent sandbox. Optional for CLI work; effectively required to launch anything from the web UI. |

There is **no API key to configure** for the agent pipeline. Arena4Ai never reads
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or any other provider key, and it uses no provider
SDK. Every model call — competitors, judge, presenter, synthesizer, Forge, commentary, brief
generator — is a subprocess spawn of a locally installed CLI, using whatever auth *that CLI*
already has. So the setup step is not "put a key in `.env`", it is:

```bash
npm i -g @anthropic-ai/claude-code && claude     # run once, sign in
npm i -g @openai/codex            && codex login
npm i -g @google/gemini-cli       && gemini      # run once, sign in
```

---

## Setting up

```bash
# 1. Database
createdb arena

# 2. Environment
cp .env.example packages/web/.env.local
#    packages/web/.env.local needs at least:
#      NEXT_PUBLIC_WS_URL=ws://localhost:3000
#      ORCHESTRATOR_URL=http://localhost:3000

# 3. Install. This also BUILDS @arena/shared and @arena/video via their `prepare`
#    scripts — the other packages import from their compiled output, so a fresh
#    clone is usable straight after install.
npm install

# 4. Only needed if you installed with --ignore-scripts (which skips `prepare`)
npm run build

# 5. Migrations
DATABASE_URL=postgresql://localhost/arena \
  npm run db:migrate --workspace=packages/orchestrator
```

### Optional: build the sandbox image

Needed to launch competitions from the web UI, and to work on anything sandbox-related.
Nothing builds it for you:

```bash
docker build -f Dockerfile.agent -t arena-agent:latest .
```

The image installs the three agent CLIs but carries no credentials of its own — auth is
whatever gets forwarded through the environment. See `SECURITY.md` for what that implies.

---

## Running it

Two processes, two terminals:

```bash
# Terminal 1 — orchestrator API + WebSocket (port 3000)
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts serve --port 3000

# Terminal 2 — web UI (port 3001)
npm run dev --workspace=packages/web
```

Open <http://localhost:3001>. The header health dot goes green when the UI can reach the
orchestrator.

### A quick end-to-end run without Docker

```bash
DATABASE_URL=postgresql://localhost/arena \
  npx tsx packages/orchestrator/src/cli.ts run briefs/fizzbuzz-cli.yml \
  --team-a claude:architect \
  --team-b gemini:speedrunner \
  --skip-sandbox \
  --time-limit 120000 \
  --log-dir /tmp/arena-logs
```

`DATABASE_URL` is what makes the run appear in the dashboard; without it you still get JSONL
event logs in `--log-dir`. `--skip-sandbox` runs the agents directly on your machine — fine
for local iteration on a machine you own, and the reason this command works without the
Docker image.

---

## Tests

From the repo root:

```bash
npm test          # turbo run typecheck test — typechecks every package, then runs the suites
```

`npm test` runs **typecheck and tests together**, so a green `npm test` covers both. Per
package, when you want a tighter loop:

```bash
npm run test      --workspace=packages/orchestrator   # vitest
npm run typecheck --workspace=packages/orchestrator
npx tsc --noEmit -p packages/web/tsconfig.json
npx tsc --noEmit -p packages/video/tsconfig.json
```

A number of DB integration tests **self-skip when `DATABASE_URL` is unset**. Set it and they
run — please do that before submitting anything that touches `src/db/`:

```bash
DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator
```

---

## What a good PR looks like

The bar is deliberately short and non-negotiable:

1. **`npm test` passes from the repo root.** All suites green.
2. **Typecheck is clean.** Every package. (`npm test` covers this; if you ran only the
   package-level `vitest`, run the typechecks too.)
3. **New behaviour comes with a test.** Bug fixes come with a test that fails before the fix.
4. **The PR does one thing**, and its description says what and why — what changed, why it
   changed, and how you verified it.
5. **Docs move with the code.** If you changed a CLI flag, an endpoint, an env var or a
   default, update `README.md` (and `SECURITY.md` if the default was a safety default) in the
   same PR. A stale README is a bug.

Things that will get a PR sent back:

- Failing or skipped-to-make-green tests.
- `any` sprinkled to silence the typechecker.
- Making a request body able to influence what binary gets spawned, or whether the sandbox
  runs. Both are resolved from the process environment only, on purpose — see
  `packages/orchestrator/src/server/run-options.ts` before touching that area.
- Unrelated reformatting mixed into a functional change.

---

## Conventions worth knowing

`CLAUDE.md` in the repo root is the working architecture map — read it before a substantial
change. The rules that most often catch people out:

- **Colours and formatting live in `packages/web/lib/`.** Use `design-tokens.ts`
  (model colours, state styles, `hexToRgb`) and `format.ts` (`formatDuration`,
  `resolveTeamLabel`, …). Do not hardcode a colour or re-implement a formatter.
- **Model ids live in one place.** `packages/orchestrator/src/adapters/model-registry.ts` is
  the single source of truth. Never hardcode a model id elsewhere.
- **Parsing LLM output** goes through `packages/orchestrator/src/utils/extract-json.ts`.
  Never use a greedy `/\{[\s\S]*\}/` regex — it breaks the moment a response contains
  markdown with a `}` in it.
- **Prompt context for LLM stages** goes through
  `packages/orchestrator/src/utils/brief-context.ts` and its presets, rather than being
  hand-assembled per call site.
- **New env vars** must be documented in `.env.example` in the same PR, with a comment saying
  what happens when they are unset.

---

## Reporting things

- **Bugs** — use the bug report template. It asks which agent CLIs you have installed and at
  what versions, because that is the single most common cause of a report that cannot be
  reproduced.
- **Security vulnerabilities** — do **not** open a public issue. Follow
  [`SECURITY.md`](SECURITY.md).
- **Ideas and questions** — a normal issue is fine. For anything large, open the issue before
  writing the code, so we can agree on the shape first.
