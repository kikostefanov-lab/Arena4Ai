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

export function getDefaultModel(provider: string): string | undefined {
  const config = MODEL_REGISTRY.find(p => p.id === provider);
  return config?.presets.find(m => m.default)?.id;
}
