export interface ModelPreset {
  id: string;
  label: string;
  default?: boolean;
}

export interface ProviderConfig {
  id: string;
  label: string;
  /** CLI flag this provider uses to pin a model, e.g. `--model` or `-m`. */
  modelFlag: string;
  /** Binary name looked up on PATH when this provider runs. */
  bin: string;
  /** Shown to the user when `bin` is missing from PATH. */
  installHint: string;
  presets: ModelPreset[];
  allowCustom: boolean;
}

export interface ModelsResponse {
  providers: ProviderConfig[];
}

/**
 * Known model ids per provider.
 *
 * These are read by the agent seeder, the /models endpoint and the Armory UI,
 * so a stale id here reaches a self-hoster as a runtime failure on their very
 * first competition. When a provider CLI ships new models, update this table —
 * it is the single source of truth, and `briefs`/seeds derive from it.
 *
 * Verified against: claude-api skill (Anthropic ids), codex-cli 0.144.1,
 * gemini-cli 0.38.2.
 */
const MODEL_REGISTRY: ProviderConfig[] = [
  {
    id: 'claude',
    label: 'Claude',
    modelFlag: '--model',
    bin: 'claude',
    installHint: 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in',
    allowCustom: true,
    presets: [
      { id: 'claude-opus-5', label: 'Opus 5', default: true },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    modelFlag: '-m',
    bin: 'codex',
    installHint: 'npm i -g @openai/codex, then run `codex login`',
    allowCustom: true,
    presets: [
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', default: true },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    modelFlag: '--model',
    bin: 'gemini',
    installHint: 'npm i -g @google/gemini-cli, then run `gemini` once to sign in',
    allowCustom: true,
    presets: [
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash', default: true },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    ],
  },
];

/**
 * Model the judge / synthesis / presentation stages are pinned to.
 *
 * Scores are only comparable across time if the judge is fixed, so this is
 * deliberately explicit rather than "whatever the CLI defaults to today".
 * Override with ARENA_JUDGE_MODEL when re-judging an old competition with the
 * model it was originally scored on.
 */
export const DEFAULT_JUDGE_MODEL = 'claude-opus-5';

/**
 * Model used by the second (adversarial) judge.
 *
 * A different model from DEFAULT_JUDGE_MODEL on purpose — running the same
 * model against itself with only a different prompt produces a much weaker
 * adversarial signal than the flag implies.
 */
export const DEFAULT_ADVERSARIAL_JUDGE_MODEL = 'claude-sonnet-5';

export function getModelRegistry(): ModelsResponse {
  return { providers: MODEL_REGISTRY };
}

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  return MODEL_REGISTRY.find(p => p.id === provider);
}

export function getDefaultModel(provider: string): string | undefined {
  return getProviderConfig(provider)?.presets.find(m => m.default)?.id;
}

/**
 * Like getDefaultModel, but throws for an unknown provider instead of returning
 * undefined — used where a missing id would silently seed a broken agent.
 */
export function requireDefaultModel(provider: string): string {
  const id = getDefaultModel(provider);
  if (!id) throw new Error(`No default model registered for provider "${provider}"`);
  return id;
}

/**
 * Model the non-scoring helper stages are pinned to: synthesis, presentations,
 * commentary, the Forge and brief generation.
 *
 * Deliberately its own constant rather than a reuse of either neighbour:
 *   - DEFAULT_JUDGE_MODEL exists so *scores* stay comparable across time, and
 *     must not drift because someone retuned the Forge;
 *   - a provider's preset `default` is what a *competitor* agent runs, and is
 *     expected to follow whatever the CLI ships as its everyday model.
 *
 * Unpinned, these stages inherit whatever the `claude` CLI defaults to that
 * week, so re-running the same competition can produce different artifacts for
 * no recorded reason. Override with ARENA_STAGE_MODEL.
 */
export const DEFAULT_STAGE_MODEL = 'claude-opus-5';

/** Resolve the model a helper (non-judging) stage should be pinned to. */
export function resolveStageModel(): string {
  return process.env['ARENA_STAGE_MODEL'] || DEFAULT_STAGE_MODEL;
}

/**
 * Resolve the model a judge run should be pinned to.
 *
 * `provider` defaults to 'claude' so existing callers are unchanged. For any
 * other provider the pin comes from that provider's own registry default —
 * pinning a codex judge to `claude-opus-5` would simply be rejected by the CLI.
 *
 * The env overrides still win, and are deliberately provider-agnostic: they
 * exist to reproduce one specific historical score, at which point the operator
 * knows exactly which model they mean.
 */
export function resolveJudgeModel(judgeId: string, provider: string = 'claude'): string {
  const adversarial = judgeId.includes('adversarial');
  const override = adversarial
    ? process.env['ARENA_ADVERSARIAL_JUDGE_MODEL']
    : process.env['ARENA_JUDGE_MODEL'];
  if (override) return override;

  if (provider === 'claude') {
    return adversarial ? DEFAULT_ADVERSARIAL_JUDGE_MODEL : DEFAULT_JUDGE_MODEL;
  }
  return requireDefaultModel(provider);
}
