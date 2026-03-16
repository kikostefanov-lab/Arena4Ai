# Sprint 7D: Multi-Provider Model Selection

**Date:** 2026-03-16
**Status:** Design approved, pending implementation plan
**Goal:** Make `modelVariant` functional end-to-end — the model variant selected in the Armory or CLI flows through the competition runner to the adapter, which passes it as a CLI flag to the AI agent process.

## Problem

The `modelVariant` field exists on the `agents` DB table and is editable in the Agent Builder UI, but it is never passed to adapters. All three adapters (Claude, Codex, Gemini) spawn their CLI processes with hardcoded flags and let the CLI pick its default model. Users cannot control which model runs in a competition.

Additionally, the Agent Builder has a hardcoded dropdown with a stale list of 5 models. When providers release new models, the dropdown must be manually updated in frontend code.

## Design

### 1. Model Registry

**New file:** `packages/orchestrator/src/adapters/model-registry.ts`

Central source of truth for known models per provider. Serves both the API and can be imported by adapters.

```ts
export interface ModelPreset {
  id: string;           // CLI model ID, e.g. 'claude-sonnet-4-6'
  label: string;        // Display name, e.g. 'Sonnet 4.6'
  default?: boolean;    // One per provider — pre-selected in UI
}

export interface ProviderConfig {
  id: string;           // 'claude' | 'codex' | 'gemini'
  label: string;        // 'Claude' | 'Codex' | 'Gemini'
  modelFlag: string;    // CLI flag: '--model' | '-m'
  presets: ModelPreset[];
  allowCustom: boolean; // true — enables freeform input
}
```

**Preset data:**

| Provider | Presets | Default |
|---|---|---|
| **Claude** | `claude-sonnet-4-6` (Sonnet 4.6), `claude-opus-4-6` (Opus 4.6), `claude-haiku-4-5-20251001` (Haiku 4.5) | `claude-sonnet-4-6` |
| **Codex** | `o3` (O3), `o4-mini` (O4 Mini), `codex-mini` (Codex Mini) | `o4-mini` |
| **Gemini** | `gemini-2.5-pro` (Gemini 2.5 Pro), `gemini-2.5-flash` (Gemini 2.5 Flash), `gemini-2.0-flash` (Gemini 2.0 Flash) | `gemini-2.5-flash` |

All providers have `allowCustom: true`. Users can type any model ID string in the UI — not limited to presets. Presets exist for discoverability; freeform exists for day-one support of new models without code changes.

**Adding a new model:** Add one `ModelPreset` entry to the provider's `presets` array. No other changes needed.

**Using an unlisted model:** Type the model ID in the freeform field. It will be stored in `modelVariant` and passed to the CLI as-is.

**New API endpoint:** `GET /models`

Returns the full registry as JSON:
```json
{
  "providers": [
    {
      "id": "claude",
      "label": "Claude",
      "modelFlag": "--model",
      "presets": [
        { "id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "default": true },
        { "id": "claude-opus-4-6", "label": "Opus 4.6" },
        { "id": "claude-haiku-4-5-20251001", "label": "Haiku 4.5" }
      ],
      "allowCustom": true
    },
    ...
  ]
}
```

Web UI fetches this once on mount to populate the model combobox.

---

### 2. Adapter Model Pass-through

Each adapter's constructor options gains an optional `modelVariant?: string` field. If set, the adapter appends the provider's model flag to its CLI args. If not set, the CLI picks its default model (backward compatible).

**ClaudeAdapter** — append `--model <variant>`:
```ts
const claudeArgs = [
  '--print', '-',
  '--output-format', 'stream-json',
  '--verbose',
  '--dangerously-skip-permissions',
];
if (this.modelVariant) {
  claudeArgs.push('--model', this.modelVariant);
}
```

**CodexAdapter** — append `-m <variant>`:
```ts
// Current: codex exec --skip-git-repo-check -s workspace-write "<prompt>"
// With variant: codex exec --skip-git-repo-check -s workspace-write -m o3 "<prompt>"
if (this.modelVariant) {
  // Insert -m <variant> before the prompt argument
}
```

**GeminiAdapter** — append `--model <variant>`:
```ts
// Current: gemini -p "<prompt>" --yolo
// With variant: gemini -p "<prompt>" --yolo --model gemini-2.5-pro
if (this.modelVariant) {
  // Append --model <variant>
}
```

**Team type update** (`packages/shared/src/types/competition.ts`):

Add `modelVariant?: string` to the `Team` interface:

```ts
export interface Team {
  id: string;
  model: string;
  persona: string;
  agentId?: string;
  modelVariant?: string;  // NEW — optional, flows from CLI/UI to adapter
}
```

Existing competitions in the DB have `teams` as JSONB without `modelVariant`. When loaded, `team.modelVariant` will be `undefined`, meaning adapters use CLI defaults. Full backward compatibility.

**Each adapter's options interface** gains `modelVariant?: string`:
- `ClaudeAdapterOptions` — add `modelVariant?: string`
- `CodexAdapterOptions` — add `modelVariant?: string`
- `GeminiAdapterOptions` — add `modelVariant?: string`

Each adapter stores it as a private field, accessed in `startExecution()`.

**Competition runner wiring** (`competition-runner.ts`):

Model variant resolution priority:
1. If `team.modelVariant` is explicitly set (from CLI `--model-a` or future UI override), use that
2. Else if `team.agentId` exists and resolves to an agent in DB, use `agent.modelVariant`
3. Else `undefined` — CLI picks its default model

```ts
const modelVariant = team.modelVariant ?? resolvedAgent?.modelVariant;

const adapter = new ClaudeAdapter(teamId, {
  workdir,
  competitionId,
  claudeBin: opts.claudeBin,
  sandbox: opts.skipSandbox ? undefined : sandbox,
  modelVariant,  // NEW
});
```

**TournamentRunner** (`tournament-runner.ts`):

TournamentRunner creates CompetitionRunner instances for each match. It passes the `teams` array through, which already carries `modelVariant` on each team object. No changes needed to TournamentRunner itself — the variant flows through the existing team data.

For the CLI `--models` flag, the tournament command maps model variants positionally onto teams before passing them to TournamentRunner:

```ts
// In CLI tournament handler:
const modelList = opts.models?.split(',') ?? [];
const teams = teamStrings.map((t, i) => ({
  ...parseTeamString(t),
  modelVariant: modelList[i] || undefined,
}));
```

**No changes to BaseAdapter interface.** `modelVariant` is per-adapter constructor options, not a base contract. Each adapter handles its own CLI flag format.

---

### 3. Armory UI Changes

**Modified file:** `packages/web/components/AgentBuilder.tsx`

**Model variant combobox** (replaces hardcoded dropdown):
- Fetches presets from `GET /api/models` on mount
- Shows preset models as dropdown options for the selected provider
- Default model pre-selected when switching providers
- Freeform text input: user can type any model ID not in the presets
- Custom entries show a subtle "(custom)" indicator
- Validation: non-empty string required

**Modified file:** `packages/web/app/agent-armory/page.tsx`

**Agent Roster cards** — add model variant as secondary label beneath provider:
```
┌──────────────────────────────┐
│ 🟠 architect                 │
│ Claude · claude-opus-4-6     │
│ W: 5  L: 2  Avg: 0.82       │
└──────────────────────────────┘
```

**Modified file:** `packages/web/app/competitions/new/page.tsx`

**New Battle team selection** (Step 3) — after an agent is selected, show the model variant below the agent name so the user knows which model will run. No flow changes — just additional info display.

**New web proxy route:** `packages/web/app/api/models/route.ts` — proxies `GET /models` from orchestrator.

---

### 4. CLI Model Flags

**Modified file:** `packages/orchestrator/src/cli.ts`

**`run` command** — add optional `--model-a` through `--model-d` flags:

```bash
# Existing (unchanged — uses CLI default model):
npx tsx cli.ts run briefs/fizzbuzz.yml \
  --team-a claude:architect --team-b codex:speedrunner

# New — specify model variant per team:
npx tsx cli.ts run briefs/fizzbuzz.yml \
  --team-a claude:architect --model-a claude-opus-4-6 \
  --team-b codex:speedrunner --model-b o3
```

- `--model-a` through `--model-d` match `--team-a` through `--team-d`
- Optional — omitting means CLI default (backward compatible)
- Value stored as `modelVariant` on the team object, flows through competition runner → adapter

**`tournament run` command** — add optional `--models` comma-separated list:

```bash
npx tsx cli.ts tournament run briefs/fizzbuzz.yml \
  --teams claude:architect,codex:speedrunner \
  --models claude-opus-4-6,o3
```

- Positionally matches `--teams` order
- Omitting `--models` entirely = all teams use CLI defaults
- Positionally matched: `--models a,b,c` maps to `--teams` in order
- If `--models` has fewer entries than `--teams`, remaining teams use CLI defaults
- If `--models` has more entries than `--teams`, extras are silently ignored

---

## File Inventory

### New Files

| File | Purpose |
|---|---|
| `packages/orchestrator/src/adapters/model-registry.ts` | Model presets per provider, `ProviderConfig` types |
| `packages/web/app/api/models/route.ts` | Web proxy for `GET /models` |

### Modified Files

| File | Change |
|---|---|
| `packages/shared/src/types/competition.ts` | Add `modelVariant?: string` to `Team` interface |
| `packages/orchestrator/src/adapters/claude/claude-adapter.ts` | Add `modelVariant` to options, append `--model` flag in `startExecution()` |
| `packages/orchestrator/src/adapters/codex/codex-adapter.ts` | Add `modelVariant` to options, insert `-m` flag before prompt arg |
| `packages/orchestrator/src/adapters/gemini/gemini-adapter.ts` | Add `modelVariant` to options, append `--model` flag |
| `packages/orchestrator/src/engine/competition-runner.ts` | Resolve `modelVariant` (team → agent → undefined), pass to adapter |
| `packages/orchestrator/src/server/app.ts` | Mount `GET /models` route |
| `packages/orchestrator/src/cli.ts` | Add `--model-a`..`--model-d` and `--models` flags |
| `packages/web/components/AgentBuilder.tsx` | Combobox (presets + freeform) replacing hardcoded dropdown |
| `packages/web/app/agent-armory/page.tsx` | Show model variant on Agent Roster cards |
| `packages/web/app/competitions/new/page.tsx` | Show model variant after agent selection in Step 3 |

### Unchanged

- DB schema (`modelVariant` column already exists on `agents` table)
- BaseAdapter interface
- Event processing, normalizers, judging, forge, synthesis
- Persona system, brief pipeline
- Battle visualization, Remotion reels

---

## Success Criteria

1. An agent created with `modelVariant: 'claude-opus-4-6'` runs with `claude --model claude-opus-4-6` in competitions
2. Codex agents can be configured with `-m o3` or `-m o4-mini`
3. Gemini agents can be configured with `--model gemini-2.5-pro` (once Gemini CLI Node issue is resolved)
4. The AgentBuilder UI shows preset models and allows typing custom model IDs
5. Agent Roster cards display the model variant
6. `--model-a claude-opus-4-6` CLI flag works for the `run` command
7. Omitting model variant = CLI default (full backward compatibility)
8. All 255+ tests pass
