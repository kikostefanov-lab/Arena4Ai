# Sprint 7D: Multi-Provider Model Selection — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `modelVariant` functional end-to-end — from Armory/CLI through competition runner to adapter CLI args, with a model registry serving presets + freeform custom model support.

**Architecture:** A model registry (`model-registry.ts`) defines known models per provider and is served via `GET /models`. Each adapter's options gains `modelVariant?: string`; if set, the provider's CLI model flag is appended. The competition runner resolves `modelVariant` from team → agent DB → undefined (fallback). AgentBuilder UI switches to a combobox (presets + freeform). CLI gains `--model-a`..`--model-d` flags.

**Tech Stack:** TypeScript, Express, Next.js 15 App Router, Commander.js, Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-multi-provider-model-selection-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `packages/orchestrator/src/adapters/model-registry.ts` | Model presets per provider, types, `getModelRegistry()` export |
| `packages/web/app/api/models/route.ts` | Next.js proxy for `GET /models` |

### Modified Files

| File | Change |
|---|---|
| `packages/shared/src/types/competition.ts` | Add `modelVariant?: string` to `Team` |
| `packages/orchestrator/src/adapters/claude/claude-adapter.ts` | Add `modelVariant` to options, append `--model` flag |
| `packages/orchestrator/src/adapters/codex/codex-adapter.ts` | Add `modelVariant` to options, insert `-m` flag |
| `packages/orchestrator/src/adapters/gemini/gemini-adapter.ts` | Add `modelVariant` to options, append `--model` flag |
| `packages/orchestrator/src/engine/competition-runner.ts` | Resolve `modelVariant`, pass to adapter constructors |
| `packages/orchestrator/src/server/app.ts` | Mount `GET /models` route |
| `packages/orchestrator/src/cli.ts` | Add `--model-a`..`--model-d` and `--models` flags |
| `packages/web/components/AgentBuilder.tsx` | Combobox replacing hardcoded MODEL_VARIANTS dropdown |
| `packages/web/app/agent-armory/page.tsx` | Show model variant on Agent Roster cards (in AgentCard) |
| `packages/web/app/competitions/new/page.tsx` | Show model variant after agent selection in Step 3 |

---

## Chunk 1: Model Registry + Team Type + Adapter Changes

### Task 1: Add `modelVariant` to Team type

**Files:**
- Modify: `packages/shared/src/types/competition.ts:4-9`

- [ ] **Step 1: Add modelVariant to Team interface**

In `packages/shared/src/types/competition.ts`, add `modelVariant?: string` after `agentId`:

```ts
export interface Team {
  id: string;
  model: string;
  persona: string;
  agentId?: string;
  modelVariant?: string;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck --workspace=packages/orchestrator`
Expected: Clean (new field is optional, no downstream breakage)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/competition.ts
git commit -m "feat(shared): add modelVariant to Team interface"
```

---

### Task 2: Create model registry

**Files:**
- Create: `packages/orchestrator/src/adapters/model-registry.ts`

- [ ] **Step 1: Create the model registry file**

```ts
// packages/orchestrator/src/adapters/model-registry.ts

export interface ModelPreset {
  id: string;
  label: string;
  default?: boolean;
}

export interface ProviderConfig {
  id: string;
  label: string;
  modelFlag: string;
  presets: ModelPreset[];
  allowCustom: boolean;
}

export interface ModelsResponse {
  providers: ProviderConfig[];
}

const MODEL_REGISTRY: ProviderConfig[] = [
  {
    id: 'claude',
    label: 'Claude',
    modelFlag: '--model',
    allowCustom: true,
    presets: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', default: true },
      { id: 'claude-opus-4-6', label: 'Opus 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    modelFlag: '-m',
    allowCustom: true,
    presets: [
      { id: 'o4-mini', label: 'O4 Mini', default: true },
      { id: 'o3', label: 'O3' },
      { id: 'codex-mini', label: 'Codex Mini' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    modelFlag: '--model',
    allowCustom: true,
    presets: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', default: true },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    ],
  },
];

export function getModelRegistry(): ModelsResponse {
  return { providers: MODEL_REGISTRY };
}

/** Get the default model ID for a provider, or undefined if provider unknown */
export function getDefaultModel(provider: string): string | undefined {
  const config = MODEL_REGISTRY.find(p => p.id === provider);
  return config?.presets.find(m => m.default)?.id;
}
```

- [ ] **Step 2: Mount GET /models route in app.ts**

In `packages/orchestrator/src/server/app.ts`, add after the existing route mounts:

```ts
import { getModelRegistry } from '../adapters/model-registry.js';
```

And add the route:

```ts
app.get('/models', (_req, res) => res.json(getModelRegistry()));
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck --workspace=packages/orchestrator`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/adapters/model-registry.ts packages/orchestrator/src/server/app.ts
git commit -m "feat(api): add model registry with GET /models endpoint"
```

---

### Task 3: Add modelVariant to Claude adapter

**Files:**
- Modify: `packages/orchestrator/src/adapters/claude/claude-adapter.ts`

- [ ] **Step 1: Add modelVariant to ClaudeAdapterOptions**

In `packages/orchestrator/src/adapters/claude/claude-adapter.ts`, find the `ClaudeAdapterOptions` interface (lines 9-13) and add:

```ts
export interface ClaudeAdapterOptions {
  workdir: string;
  competitionId: string;
  claudeBin?: string;
  sandbox?: SandboxManager;
  modelVariant?: string;  // NEW — appended as --model <variant>
}
```

- [ ] **Step 2: Store modelVariant in constructor**

Add a private field and set it in the constructor:

```ts
private modelVariant?: string;

constructor(teamId: string, options: ClaudeAdapterOptions) {
  super(teamId, options.workdir, options.competitionId, options.sandbox);
  this.claudeBin = options.claudeBin ?? 'claude';
  this.modelVariant = options.modelVariant;
}
```

- [ ] **Step 3: Append --model flag in startExecution()**

In `startExecution()`, after the `claudeArgs` array is built (after line 58), add:

```ts
if (this.modelVariant) {
  claudeArgs.push('--model', this.modelVariant);
}
```

This goes BEFORE the spawn call (line 60).

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/adapters/claude/claude-adapter.ts
git commit -m "feat(claude): pass modelVariant as --model flag to Claude CLI"
```

---

### Task 4: Add modelVariant to Codex adapter

**Files:**
- Modify: `packages/orchestrator/src/adapters/codex/codex-adapter.ts`

- [ ] **Step 1: Add modelVariant to CodexAdapterOptions**

```ts
export interface CodexAdapterOptions {
  workdir: string;
  competitionId: string;
  codexBin?: string;
  sandbox?: SandboxManager;
  modelVariant?: string;  // NEW — inserted as -m <variant>
}
```

- [ ] **Step 2: Store modelVariant in constructor**

```ts
private modelVariant?: string;

constructor(teamId: string, options: CodexAdapterOptions) {
  super(teamId, options.workdir, options.competitionId, options.sandbox);
  this.codexBin = options.codexBin ?? 'codex';
  this.modelVariant = options.modelVariant;
}
```

- [ ] **Step 3: Insert -m flag in startExecution()**

For the **sandbox path** (around line 67), the args array is `['exec', '--skip-git-repo-check', '-s', 'workspace-write', this.promptText]`. Insert `-m <variant>` before the prompt:

```ts
const codexArgs = ['exec', '--skip-git-repo-check', '-s', 'workspace-write'];
if (this.modelVariant) {
  codexArgs.push('-m', this.modelVariant);
}
codexArgs.push(this.promptText);
```

For the **non-sandbox path** (around line 72), the command is a shell string. Modify to insert the model flag:

```ts
const modelFlag = this.modelVariant ? ` -m ${this.modelVariant}` : '';
const shellCmd = `"${this.codexBin}" exec --skip-git-repo-check -s workspace-write${modelFlag} "$(cat "${promptFile}")"`;
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/adapters/codex/codex-adapter.ts
git commit -m "feat(codex): pass modelVariant as -m flag to Codex CLI"
```

---

### Task 5: Add modelVariant to Gemini adapter

**Files:**
- Modify: `packages/orchestrator/src/adapters/gemini/gemini-adapter.ts`

- [ ] **Step 1: Add modelVariant to GeminiAdapterOptions**

```ts
export interface GeminiAdapterOptions {
  workdir: string;
  competitionId: string;
  geminiBin?: string;
  sandbox?: SandboxManager;
  modelVariant?: string;  // NEW — appended as --model <variant>
}
```

- [ ] **Step 2: Store modelVariant in constructor**

```ts
private modelVariant?: string;

constructor(teamId: string, options: GeminiAdapterOptions) {
  super(teamId, options.workdir, options.competitionId, options.sandbox);
  this.geminiBin = options.geminiBin ?? 'gemini';
  this.modelVariant = options.modelVariant;
}
```

- [ ] **Step 3: Append --model flag in startExecution()**

For the **sandbox path** (around line 69), append to the args array:

```ts
const geminiArgs = ['-p', this.promptText, '--yolo'];
if (this.modelVariant) {
  geminiArgs.push('--model', this.modelVariant);
}
```

For the **non-sandbox path** (around line 72), modify the shell command:

```ts
const modelFlag = this.modelVariant ? ` --model ${this.modelVariant}` : '';
const shellCmd = `"${this.geminiBin}" -p "$(cat "${promptFile}")" --yolo${modelFlag}`;
```

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/adapters/gemini/gemini-adapter.ts
git commit -m "feat(gemini): pass modelVariant as --model flag to Gemini CLI"
```

---

### Task 6: Wire modelVariant through competition runner

**Files:**
- Modify: `packages/orchestrator/src/engine/competition-runner.ts:195-251`

- [ ] **Step 1: Resolve modelVariant during agent resolution**

In `competition-runner.ts`, in the agent resolution block (lines 198-223), capture the resolved agent so we can read its `modelVariant`. After the persona resolution block (around line 223), add:

```ts
// Resolve model variant: explicit team setting > DB agent > undefined (CLI default)
const modelVariant = team.modelVariant ?? resolvedAgent?.modelVariant;
```

To make `resolvedAgent` available, ensure the DB lookup paths store the agent. In the `team.agentId` path (lines 203-207), save the agent:

```ts
let resolvedAgent: { modelVariant?: string } | null = null;

if (team.agentId && this.agentRepo) {
  const agent = await this.agentRepo.get(team.agentId);
  resolvedAgent = agent;
  systemPrompt = agent?.persona?.systemPrompt
    ?? resolvePersona(personaId ?? team.persona, brief.format).systemPrompt;
} else if (this.agentRepo) {
  // ... existing legacy path
  if (dbAgent?.persona) {
    resolvedAgent = dbAgent;
    // ...
  }
}
```

- [ ] **Step 2: Pass modelVariant to each adapter constructor**

In the adapter instantiation switch (lines 225-251), add `modelVariant` to each adapter's options:

```ts
case 'codex':
  adapter = new CodexAdapter(team.id, {
    workdir,
    competitionId: this.competition.id,
    codexBin: this.options.codexBin,
    sandbox: sandboxManager,
    modelVariant,  // NEW
  });
  break;
case 'gemini':
  adapter = new GeminiAdapter(team.id, {
    workdir,
    competitionId: this.competition.id,
    geminiBin: this.options.geminiBin,
    sandbox: sandboxManager,
    modelVariant,  // NEW
  });
  break;
case 'claude':
default:
  adapter = new ClaudeAdapter(team.id, {
    workdir,
    competitionId: this.competition.id,
    claudeBin: this.options.claudeBin,
    sandbox: sandboxManager,
    modelVariant,  // NEW
  });
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/engine/competition-runner.ts
git commit -m "feat(runner): resolve modelVariant from team/agent and pass to adapters"
```

---

## Chunk 2: CLI Flags

### Task 7: Add model flags to CLI run command

**Files:**
- Modify: `packages/orchestrator/src/cli.ts`

- [ ] **Step 1: Add --model-a through --model-d options and wire onto teams**

In `packages/orchestrator/src/cli.ts`, find the `run` command options (around line 23-31). After `--adversarial-judge`, add:

```ts
.option('--model-a <model>', 'Model variant for team A (e.g. claude-opus-4-6)')
.option('--model-b <model>', 'Model variant for team B')
.option('--model-c <model>', 'Model variant for team C')
.option('--model-d <model>', 'Model variant for team D')
```

- [ ] **Step 2: Update makeTeam and team construction to include modelVariant**

Find the `makeTeam` function (around line 57). Add a `modelVariant` parameter:

```ts
const makeTeam = (id: string, modelSpec: string, modelVariant?: string): Team => {
  const [model, persona = 'pragmatist'] = modelSpec.split(':');
  return { id, model, persona, ...(modelVariant ? { modelVariant } : {}) };
};
```

Update the team construction (around line 63) to pass model variants:

```ts
const modelVariants = [opts.modelA, opts.modelB, opts.modelC, opts.modelD];
const teams: Team[] = opts.teams
  ? opts.teams.split(',').map((t: string, i: number) =>
      makeTeam(teamIds[i] ?? `team-${i}`, t.trim(), modelVariants[i]))
  : [
      makeTeam('team-a', opts.teamA, opts.modelA),
      makeTeam('team-b', opts.teamB, opts.modelB),
    ];
```

- [ ] **Step 3: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/orchestrator/src/cli.ts
git commit -m "feat(cli): add --model-a/b/c/d flags for model variant selection"
```

---

### Task 8: Add --models flag to tournament CLI + wire through TournamentRunner

**Files:**
- Modify: `packages/orchestrator/src/cli.ts`
- Modify: `packages/orchestrator/src/engine/tournament-runner.ts`

TournamentRunner takes `teams: string[]` and internally constructs Team objects in `runMatch()` (line 141-142). To support model variants, we pass a `modelVariants` map alongside the teams and use it in `runMatch()`.

- [ ] **Step 1: Add --models option to tournament run command**

In `cli.ts`, find the tournament command options (around line 376). After `--time-limit`, add:

```ts
.option('--models <models>', 'Comma-separated model variants matching --teams order')
```

Add `models?: string` to the action opts type.

- [ ] **Step 2: Build modelVariants map and pass to TournamentRunner**

In the tournament action handler (around line 390), after `const teams = ...`, build a map:

```ts
const modelList = opts.models?.split(',').map((m: string) => m.trim()) ?? [];
const modelVariantMap: Record<string, string> = {};
teams.forEach((t: string, i: number) => {
  if (modelList[i]) modelVariantMap[t] = modelList[i];
});
```

Pass it to TournamentRunner constructor:

```ts
const runner = new TournamentRunner(brief, teams, {
  skipSandbox: opts.skipSandbox ?? false,
  commentary: opts.commentary ?? false,
  logDir: opts.logDir,
  printResults: false,
  modelVariants: modelVariantMap,  // NEW
});
```

- [ ] **Step 3: Update TournamentRunner to accept and forward modelVariants**

In `packages/orchestrator/src/engine/tournament-runner.ts`, find the constructor options type and add:

```ts
modelVariants?: Record<string, string>;  // team-string → model variant
```

Store it as a field. Then in `runMatch()` (around line 134-142), pass the variants to the Team objects:

```ts
async function runMatch(
  brief: Brief,
  teamA: string,
  teamB: string,
  options: RunOptions,
  emitter: EventEmitter,
  modelVariants?: Record<string, string>,  // NEW parameter
) {
  const teamAEntry = {
    id: 'team-a',
    model: teamA,
    persona: teamA.split(':')[1] ?? 'default',
    ...(modelVariants?.[teamA] ? { modelVariant: modelVariants[teamA] } : {}),
  };
  const teamBEntry = {
    id: 'team-b',
    model: teamB,
    persona: teamB.split(':')[1] ?? 'default',
    ...(modelVariants?.[teamB] ? { modelVariant: modelVariants[teamB] } : {}),
  };
  // ... rest unchanged
}
```

Update the call site where `runMatch` is invoked to pass `this.modelVariants`.

- [ ] **Step 4: Run tests**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/cli.ts packages/orchestrator/src/engine/tournament-runner.ts
git commit -m "feat(cli): add --models flag for tournament model variant selection"
```

---

## Chunk 3: Web UI Changes

### Task 9: Create web proxy for GET /models

**Files:**
- Create: `packages/web/app/api/models/route.ts`

- [ ] **Step 1: Create the proxy route**

```ts
// packages/web/app/api/models/route.ts

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export async function GET() {
  const res = await fetch(`${API}/models`);
  const data = await res.json();
  return Response.json(data);
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/api/models/route.ts
git commit -m "feat(web): add GET /api/models proxy route"
```

---

### Task 10: Update AgentBuilder with combobox (presets + freeform)

**Files:**
- Modify: `packages/web/components/AgentBuilder.tsx`

- [ ] **Step 1: Replace hardcoded MODEL_VARIANTS with dynamic fetch**

Remove the `MODEL_VARIANTS` constant (lines 17-21). Add state and a fetch effect:

```ts
interface ModelPreset {
  id: string;
  label: string;
  default?: boolean;
}
interface ProviderConfig {
  id: string;
  label: string;
  presets: ModelPreset[];
  allowCustom: boolean;
}

const [providerConfigs, setProviderConfigs] = useState<ProviderConfig[]>([]);
const [customModel, setCustomModel] = useState(false);

useEffect(() => {
  fetch('/api/models')
    .then(r => r.json())
    .then((data: { providers: ProviderConfig[] }) => setProviderConfigs(data.providers))
    .catch(() => {/* fallback: empty presets, freeform only */});
}, []);
```

- [ ] **Step 2: Replace the model variant dropdown with a combobox**

Find the current model variant `<select>` (around line 223-226). Replace with:

```tsx
{/* Model variant — combobox (presets + freeform) */}
{(() => {
  const config = providerConfigs.find(p => p.id === provider);
  const presets = config?.presets ?? [];
  const isCustom = customModel || !presets.some(p => p.id === modelVariant);
  return (
    <div>
      <label style={FORM_LABEL_STYLE}>MODEL VARIANT</label>
      {!isCustom ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            className="arena-form"
            value={modelVariant}
            onChange={e => {
              if (e.target.value === '__custom__') {
                setCustomModel(true);
                setModelVariant('');
              } else {
                setModelVariant(e.target.value);
              }
            }}
            style={{ flex: 1 }}
          >
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.label} ({p.id})</option>
            ))}
            {config?.allowCustom && (
              <option value="__custom__">Custom model...</option>
            )}
          </select>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="arena-form"
            type="text"
            value={modelVariant}
            onChange={e => setModelVariant(e.target.value)}
            placeholder="e.g. claude-opus-4-6"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="arena-btn"
            onClick={() => {
              setCustomModel(false);
              const def = presets.find(p => p.default)?.id ?? presets[0]?.id ?? '';
              setModelVariant(def);
            }}
          >
            Presets
          </button>
        </div>
      )}
      {isCustom && modelVariant && (
        <span style={{ fontSize: '0.65rem', color: '#7cc6db', marginTop: 4, display: 'block' }}>
          (custom model)
        </span>
      )}
    </div>
  );
})()}
```

- [ ] **Step 3: Auto-select default model when provider changes**

In the provider selection handler (where `setProvider(p)` is called), also set the default model:

```ts
const handleProviderChange = (p: Provider) => {
  setProvider(p);
  setCustomModel(false);
  const config = providerConfigs.find(c => c.id === p);
  const defaultModel = config?.presets.find(m => m.default)?.id ?? config?.presets[0]?.id ?? '';
  setModelVariant(defaultModel);
};
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean (or only pre-existing errors)

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/AgentBuilder.tsx
git commit -m "feat(armory): replace hardcoded model dropdown with combobox — presets + freeform"
```

---

### Task 11: Show model variant on Agent Roster cards

**Files:**
- Modify: `packages/web/app/agent-armory/page.tsx` (or `packages/web/components/AgentCard.tsx` if it exists)

- [ ] **Step 1: Find the AgentCard component**

Read the AgentCard component. Find where the provider badge is rendered. After the provider label, add the model variant:

```tsx
{/* Provider + model variant */}
<span style={{ fontSize: '0.6rem', color: '#7cc6db' }}>
  {agent.provider}{agent.modelVariant ? ` · ${agent.modelVariant}` : ''}
</span>
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/AgentCard.tsx packages/web/app/agent-armory/page.tsx
git commit -m "feat(armory): show model variant on Agent Roster cards"
```

---

### Task 12: Show model variant in New Battle team selection

**Files:**
- Modify: `packages/web/app/competitions/new/page.tsx`

- [ ] **Step 1: Find agent selection display in Step 3**

After an agent is selected (around the `selectAgent` handler, lines 795-804), find where the selected agent's name is displayed. Add the model variant below it:

```tsx
{selectedAgent && (
  <span style={{ fontSize: '0.6rem', color: '#4a8fa8', display: 'block', marginTop: 2 }}>
    {selectedAgent.modelVariant || 'default model'}
  </span>
)}
```

The exact location depends on how the selected agent is shown in the team card. Look for where `agent.name` or the persona name is rendered in the team selection area.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/competitions/new/page.tsx
git commit -m "feat(web): show model variant in New Battle team selection"
```

---

### Task 13: Final integration check

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck — orchestrator**

Run: `npm run typecheck --workspace=packages/orchestrator`
Expected: Clean (or pre-existing errors only)

- [ ] **Step 2: Full typecheck — web**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: Clean (or pre-existing errors only)

- [ ] **Step 3: Full test suite**

Run: `npm run test --workspace=packages/orchestrator`
Expected: All 255 tests pass

- [ ] **Step 4: Manual verification**

Start the dev stack and verify:
1. `GET http://localhost:3000/models` returns the registry JSON with 3 providers
2. Agent Builder shows presets dropdown with "Custom model..." option
3. Switching provider auto-selects the default model
4. Typing a custom model ID works and shows "(custom model)" label
5. Agent Roster cards show model variant next to provider
6. CLI: `--model-a claude-opus-4-6` is accepted without error

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: Sprint 7D complete — multi-provider model selection"
```
