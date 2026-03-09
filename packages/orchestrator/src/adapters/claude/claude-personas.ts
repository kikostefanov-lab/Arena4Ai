import { CompetitionFormat } from '@arena/shared';

export interface Persona {
  /** Short identifier used in logs and UI. */
  id: string;
  /** Display name shown in results. */
  name: string;
  /** System prompt injected before the competition brief. */
  systemPrompt: string;
}

/**
 * Built-in persona templates.
 *
 * Each persona shapes how the Claude Code agent approaches a competition —
 * think of them as pre-game mindsets.
 */
export const PERSONAS: Record<string, Persona> = {
  pragmatist: {
    id: 'pragmatist',
    name: 'The Pragmatist',
    systemPrompt:
      'You are a no-nonsense engineer who values working solutions over perfect ones. ' +
      'Ship something correct and clean as fast as possible. Avoid over-engineering.',
  },

  architect: {
    id: 'architect',
    name: 'The Architect',
    systemPrompt:
      'You are a senior software architect who prioritises long-term maintainability, ' +
      'clear abstractions, and thorough documentation. Trade some speed for design quality.',
  },

  researcher: {
    id: 'researcher',
    name: 'The Researcher',
    systemPrompt:
      'You are an analytical thinker who explores the problem space thoroughly before ' +
      'committing to a solution. Produce well-reasoned artefacts backed by evidence.',
  },

  speedrunner: {
    id: 'speedrunner',
    name: 'The Speedrunner',
    systemPrompt:
      'You are optimised for raw velocity. Produce the minimum viable correct solution ' +
      'as quickly as possible. Every second counts.',
  },

  adversarial: {
    id: 'adversarial',
    name: 'The Adversary',
    systemPrompt:
      'You are playing the red team. Your goal is to identify weaknesses, attack vectors, ' +
      'or flaws in the system under test. Think like an attacker.',
  },

  defender: {
    id: 'defender',
    name: 'The Defender',
    systemPrompt:
      'You are playing the blue team. Your goal is to harden systems, add resilience, ' +
      'and close vulnerabilities identified by the red team.',
  },
};

/**
 * Default persona to use for each CompetitionFormat when no explicit
 * persona is supplied.
 */
export const FORMAT_DEFAULT_PERSONA: Record<CompetitionFormat, string> = {
  [CompetitionFormat.SPRINT]: 'speedrunner',
  [CompetitionFormat.HACKATHON]: 'pragmatist',
  [CompetitionFormat.RELAY_RACE]: 'architect',
  [CompetitionFormat.RED_VS_BLUE]: 'adversarial',
};

/**
 * Resolve a persona by ID, falling back to the format default, then
 * finally to `pragmatist`.
 *
 * @throws Error if the resolved persona ID does not exist in PERSONAS.
 */
export function resolvePersona(
  personaId: string | undefined,
  format: CompetitionFormat,
): Persona {
  const id = personaId ?? FORMAT_DEFAULT_PERSONA[format] ?? 'pragmatist';
  const persona = PERSONAS[id];
  if (!persona) {
    throw new Error(
      `Unknown persona "${id}". Available: ${Object.keys(PERSONAS).join(', ')}`,
    );
  }
  return persona;
}
