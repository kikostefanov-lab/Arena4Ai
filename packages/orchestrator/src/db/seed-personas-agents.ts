import { CLI_DEFAULT_MODEL } from '@arena/shared';
import { getProviderCatalog, judgeModel, type ProviderCatalog } from '../adapters/model-catalog.js';
import type { CreatePersonaInput } from './persona-repository.js';
import type { CreateAgentInput } from './agent-repository.js';
import type { PersonaRepository } from './persona-repository.js';
import type { AgentRepository } from './agent-repository.js';

const SYSTEM_PERSONAS: CreatePersonaInput[] = [
  { id: 'persona-architect',       name: 'architect',       avatar: '🏗️', tags: ['thorough','design'],      description: 'Systems-first thinker focused on long-term quality',        systemPrompt: 'You are The Architect: methodical, structured, focused on long-term quality and clean design patterns. You write complete, production-ready solutions.', createdBy: 'system' },
  { id: 'persona-speedrunner',     name: 'speedrunner',     avatar: '⚡',  tags: ['fast','minimal'],          description: 'Ruthlessly efficient minimal-solution shipper',                 systemPrompt: 'You are The Speedrunner: ruthlessly efficient, shipping the minimal working solution first. You optimize for time-to-completion above all.', createdBy: 'system' },
  { id: 'persona-pragmatist',      name: 'pragmatist',      avatar: '🔧', tags: ['practical','balanced'],    description: 'Balances speed and quality with proven patterns',               systemPrompt: 'You are The Pragmatist: balancing speed and quality, choosing proven patterns, avoiding over-engineering. You deliver working solutions fast.', createdBy: 'system' },
  { id: 'persona-researcher',      name: 'researcher',      avatar: '🔬', tags: ['thorough','analysis'],     description: 'Deep analyst who explores before committing',                  systemPrompt: 'You are The Researcher: deep analysis, comprehensive documentation, exploring edge cases and trade-offs before committing to an approach.', createdBy: 'system' },
  { id: 'persona-adversarial',     name: 'adversarial',     avatar: '⚔️', tags: ['security','testing'],     description: 'Red-team attacker finding weaknesses and vulnerabilities',     systemPrompt: 'You are The Adversarial: focused on breaking assumptions, finding vulnerabilities, writing adversarial tests, and hardening implementations.', createdBy: 'system' },
  { id: 'persona-defender',        name: 'defender',        avatar: '🛡️', tags: ['security','quality'],     description: 'Blue-team hardener focused on robustness and security',         systemPrompt: 'You are The Defender: prioritizing robustness, error handling, security, and defensive programming patterns in every solution.', createdBy: 'system' },
  { id: 'persona-pioneer',         name: 'pioneer',         avatar: '🚀', tags: ['creative','innovative'],   description: 'Creative first-mover exploring unconventional approaches',      systemPrompt: 'You are The Pioneer: exploring unconventional approaches, experimenting with creative solutions, pushing boundaries while staying practical.', createdBy: 'system' },
  { id: 'persona-standard',        name: 'standard',        avatar: '💻', tags: ['coding'],                  description: 'General-purpose Codex coding agent',                           systemPrompt: 'You are a Codex coding agent. Write clean, efficient code to solve the given problem.', createdBy: 'system' },
  { id: 'persona-standard-gemini', name: 'standard-gemini', avatar: '✨', tags: ['versatile'],               description: 'General-purpose Gemini agent',                                 systemPrompt: 'You are a Gemini agent. Approach the problem creatively and deliver a comprehensive solution.', createdBy: 'system' },
];

// System agents run on each CLI's own default model (no model flag). Any
// literal id here goes stale: `codex-standard` and `gemini-2-flash` (never real
// ids) survived four months, and their registry-derived replacements were gone
// from the installed CLIs within weeks.
const CLAUDE_MODEL = CLI_DEFAULT_MODEL;
const CODEX_MODEL = CLI_DEFAULT_MODEL;
const GEMINI_MODEL = CLI_DEFAULT_MODEL;

const SYSTEM_AGENTS: CreateAgentInput[] = [
  { id: 'agent-claude-architect',   name: 'architect',   provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-architect', createdBy: 'system' },
  { id: 'agent-claude-speedrunner', name: 'speedrunner', provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-speedrunner', createdBy: 'system' },
  { id: 'agent-claude-pragmatist',  name: 'pragmatist',  provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-pragmatist', createdBy: 'system' },
  { id: 'agent-claude-researcher',  name: 'researcher',  provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-researcher', createdBy: 'system' },
  { id: 'agent-claude-adversarial', name: 'adversarial', provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-adversarial', createdBy: 'system' },
  { id: 'agent-claude-defender',    name: 'defender',    provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-defender', createdBy: 'system' },
  { id: 'agent-claude-pioneer',     name: 'pioneer',     provider: 'claude', modelVariant: CLAUDE_MODEL, personaId: 'persona-pioneer', createdBy: 'system' },
  { id: 'agent-codex-standard',     name: 'standard',    provider: 'codex',  modelVariant: CODEX_MODEL,  personaId: 'persona-standard', createdBy: 'system' },
  { id: 'agent-gemini-standard',    name: 'standard',    provider: 'gemini', modelVariant: GEMINI_MODEL, personaId: 'persona-standard-gemini', createdBy: 'system' },
];

/** Exported for tests: every seeded agent must carry a real, registry-known model id. */
export const SEEDED_AGENTS = SYSTEM_AGENTS;

export async function seedPersonasAgents(
  personaRepo: PersonaRepository,
  agentRepo: AgentRepository,
): Promise<void> {
  // Seed personas first (agents FK → personas)
  for (const p of SYSTEM_PERSONAS) {
    const existing = await personaRepo.get(p.id);
    if (!existing) {
      await personaRepo.create(p);
    }
  }

  // Seed agents
  for (const a of SYSTEM_AGENTS) {
    const existing = await agentRepo.get(a.id);
    if (!existing) {
      await agentRepo.create(a);
    }
  }
}

/**
 * Seeding only inserts missing rows, so an existing database keeps whatever
 * model ids it was seeded with — which is how retired ids kept reaching the
 * CLIs after the seed list itself was fixed. On startup, put every SYSTEM agent
 * whose model the installed CLI does not offer back on the CLI default.
 *
 * User-created agents are left alone (the person chose that model); the
 * pre-launch model check names them instead of letting them fail silently.
 */
export async function repairStaleSystemAgents(
  agentRepo: Pick<AgentRepository, 'list' | 'update'>,
  getCatalog: (provider: string) => Promise<ProviderCatalog> = (p) => getProviderCatalog(p),
): Promise<Array<{ id: string; from: string }>> {
  const { agents } = await agentRepo.list({});
  const repaired: Array<{ id: string; from: string }> = [];
  const catalogs = new Map<string, ProviderCatalog>();
  for (const agent of agents) {
    if (agent.createdBy !== 'system' || agent.modelVariant === CLI_DEFAULT_MODEL) continue;
    let catalog = catalogs.get(agent.provider);
    if (!catalog) {
      catalog = await getCatalog(agent.provider);
      catalogs.set(agent.provider, catalog);
    }
    // 'unverifiable' is not good enough for a system agent: it was seeded by us,
    // and only an id the CLI positively lists is worth keeping over the default.
    if (judgeModel(catalog, agent.modelVariant) === 'known') continue;
    await agentRepo.update(agent.id, { modelVariant: CLI_DEFAULT_MODEL });
    repaired.push({ id: agent.id, from: agent.modelVariant });
  }
  for (const r of repaired) {
    console.log(`[seed] ${r.id}: model "${r.from}" is not offered by the installed CLI — now uses the CLI default`);
  }
  return repaired;
}
