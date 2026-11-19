/**
 * Squad wording for the log view, kept in shared so it is tested here (the web
 * package has no test runner) and the log and the arena say the same thing.
 */

import type { TeamState, World } from './world.js';

export interface SquadEventLine {
  icon: string;
  label: string;
  text: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The log line for a SUB_AGENT_SPAWN / SUB_AGENT_DONE event; null for any other type or a bad payload. */
export function describeSquadEvent(type: string, payload: unknown): SquadEventLine | null {
  if (type !== 'SUB_AGENT_SPAWN' && type !== 'SUB_AGENT_DONE') return null;
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;

  if (type === 'SUB_AGENT_SPAWN') {
    const text = [str(p.label) || str(p.agentId) || 'sub-agent', str(p.model)].filter(Boolean).join(' · ');
    return { icon: '🛰', label: 'SQUAD +', text };
  }

  const status = str(p.status) || 'unknown';
  const text = [status, str(p.reason)].filter(Boolean).join(' · ');
  return { icon: status === 'completed' ? '✓' : '✗', label: 'SQUAD −', text };
}

/** A team's squad as the header chip shows it. `models` is the distinct models its members ran on. */
export function squadSummary(team: TeamState): { active: number; spawned: number; failed: number; models: string[] } {
  let active = 0;
  const models = new Set<string>();
  for (const m of team.squad.values()) {
    if (m.status === 'running') active++;
    if (m.model) models.add(m.model);
  }
  return { active, spawned: team.squadTotals.spawned, failed: team.squadTotals.failed, models: [...models] };
}

/** The brief's named deliverables, in brief order, each flagged when the team has written it. */
export function deliveredList(world: World, teamId: string): Array<{ name: string; done: boolean }> {
  const team = world.teams.get(teamId);
  if (!team) return [];
  return world.deliverables.map((name) => ({ name, done: team.delivered.has(name) }));
}
