## What and why

<!-- What changed, and what problem it solves. Link the issue if there is one. -->

## How I verified it

<!-- The commands you actually ran, and what they printed. -->

## Checklist

- [ ] `npm test` passes from the repo root (this runs typecheck **and** the suites)
- [ ] Typecheck is clean across every package
- [ ] New behaviour has a test; a bug fix has a test that failed before the fix
- [ ] Docs updated in this PR if a CLI flag, endpoint, env var or default changed
      (`README.md`, plus `SECURITY.md` if it was a safety default, plus `.env.example` for
      a new env var)
- [ ] This PR does one thing

<!--
If you touched packages/orchestrator/src/db/, run the suite with DATABASE_URL set — a
number of integration tests self-skip without it:
  DATABASE_URL=postgresql://localhost/arena npm run test --workspace=packages/orchestrator
-->
