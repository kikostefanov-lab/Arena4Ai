import type { TeamMomentum, AnimationCommand, FlashPose, ParticleType, BasePose, TerminalPose } from './types.js';

/** Energy deltas per event type */
const ENERGY_MAP: Record<string, number> = {
  FILE_CREATE: 0.15,
  FILE_MODIFY: 0.12,
  TOOL_CALL: 0.10,
  REASONING: 0.03,
  ERROR: -0.10,
};

const DEFAULT_ENERGY = 0.01;
const ENERGY_DECAY_PER_SEC = 0.008;  // slower decay so thinking phases don't drain energy

/** Every Nth reasoning event triggers a subtle visual pulse */
const REASONING_PULSE_INTERVAL = 6;
const INITIAL_ENERGY = 0.3;

/** Map event type to a flash pose (or undefined for no flash) */
function flashForType(type: string): FlashPose | undefined {
  switch (type) {
    case 'FILE_CREATE':
    case 'FILE_MODIFY':
      return 'strike';
    case 'TOOL_CALL':
      return 'power';
    case 'ERROR':
      return 'hit';
    default:
      return undefined;
  }
}

/** Map event type to a particle type (or undefined) */
function particleForType(type: string): ParticleType | undefined {
  switch (type) {
    case 'FILE_CREATE':
    case 'FILE_MODIFY':
      return 'strike_projectile';
    case 'TOOL_CALL':
      return 'power_burst';
    case 'ERROR':
      return 'hit_sparks';
    default:
      return undefined;
  }
}

function clampEnergy(e: number): number {
  return Math.max(0, Math.min(1, e));
}

function extractFilename(payload: Record<string, unknown> | undefined): string {
  if (!payload) return 'file';
  if (typeof payload.path === 'string') {
    const parts = payload.path.split('/');
    return parts[parts.length - 1] || 'file';
  }
  if (typeof payload.text === 'string') {
    // Try to find a filename-like token in the text
    const match = payload.text.match(/[\w-]+\.\w+/);
    if (match) return match[0];
  }
  return 'file';
}

function deriveLatestAction(type: string, payload: Record<string, unknown> | undefined): string {
  switch (type) {
    case 'FILE_CREATE':
    case 'FILE_MODIFY':
      return `Creating ${extractFilename(payload)}...`;
    case 'TOOL_CALL':
      return 'Running tools...';
    case 'REASONING': {
      const text = payload && typeof payload.text === 'string' ? payload.text : '';
      if (text.length > 40) return text.slice(0, 40) + '...';
      return text || 'Thinking...';
    }
    case 'ERROR':
      return 'Error encountered';
    default:
      return '';
  }
}

export interface ArenaEvent {
  type: string;
  teamId?: string;
  payload?: Record<string, unknown>;
  timestamp?: string | number;
}

export class EventProcessor {
  private momentum: Map<string, TeamMomentum> = new Map();
  private processedCount = 0;

  constructor(teamIds: string[]) {
    for (const id of teamIds) {
      this.momentum.set(id, {
        energy: INITIAL_ENERGY,
        basePose: 'idle',
        lastEventTime: Date.now(),
        recentTypes: [],
        eventCounts: { reasoning: 0, fileCreate: 0, toolCall: 0, error: 0 },
        latestAction: '',
      });
    }
  }

  getMomentum(teamId: string): TeamMomentum {
    return this.momentum.get(teamId) ?? {
      energy: 0,
      basePose: 'idle' as BasePose,
      lastEventTime: Date.now(),
      recentTypes: [],
      eventCounts: { reasoning: 0, fileCreate: 0, toolCall: 0, error: 0 },
      latestAction: '',
    };
  }

  /**
   * Process new events. On first call (processedCount=0), all historical events
   * are processed for momentum only — no AnimationCommands are emitted to prevent
   * a frame spike.
   */
  processEvents(events: ArenaEvent[], skipCount?: number): AnimationCommand[] {
    const start = skipCount ?? this.processedCount;
    const commands: AnimationCommand[] = [];
    const isFirstCall = this.processedCount === 0 && start === 0;

    for (let i = start; i < events.length; i++) {
      const ev = events[i];
      if (!ev.teamId) continue;

      const m = this.momentum.get(ev.teamId);
      if (!m) continue;

      // Update energy
      const delta = ENERGY_MAP[ev.type] ?? DEFAULT_ENERGY;
      m.energy = clampEnergy(m.energy + delta);
      m.lastEventTime = Date.now();

      // Track recent types (last 5)
      m.recentTypes.push(ev.type);
      if (m.recentTypes.length > 5) m.recentTypes.shift();

      // Update event counts
      switch (ev.type) {
        case 'REASONING':
          m.eventCounts.reasoning++;
          break;
        case 'FILE_CREATE':
        case 'FILE_MODIFY':
          m.eventCounts.fileCreate++;
          break;
        case 'TOOL_CALL':
          m.eventCounts.toolCall++;
          break;
        case 'ERROR':
          m.eventCounts.error++;
          break;
      }

      // Update latest action
      const action = deriveLatestAction(ev.type, ev.payload);
      if (action) m.latestAction = action;

      // Derive base pose
      m.basePose = m.recentTypes.length >= 5 && m.recentTypes.every(t => t === 'REASONING')
        ? 'thinking'
        : 'idle';

      // Only generate animation commands for genuinely new events (not historical backfill)
      if (!isFirstCall) {
        const flash = flashForType(ev.type);
        const particle = particleForType(ev.type);

        // Skip COMMENTARY — no animation
        if (ev.type === 'COMMENTARY') continue;

        if (flash || particle) {
          commands.push({
            teamId: ev.teamId,
            flash,
            basePose: m.basePose,
            particle,
          });
        } else if (ev.type === 'REASONING') {
          // Content-aware reasoning: detect plan items, decisions, completions
          const text = (ev.payload?.text as string ?? '').toLowerCase();
          const isDecision = /\b(decided|set|locked|chosen|plan update|fixed)\b/.test(text);
          const isListItem = /^[\s]*[•\-→✓]\s/.test(ev.payload?.text as string ?? '');
          const isCompletion = /\b(succeeded|completed|done|finished|built)\b/.test(text);

          // Boost energy for substantive reasoning (decisions, completions)
          if (isDecision || isCompletion) {
            m.energy = clampEnergy(m.energy + 0.05);
          }

          // Every Nth reasoning event OR substantive content → subtle power pulse
          const shouldPulse = (m.eventCounts.reasoning % REASONING_PULSE_INTERVAL === 0)
            || isDecision || isCompletion;

          commands.push({
            teamId: ev.teamId,
            basePose: m.basePose,
            // Subtle power flash on pulse events to keep the gladiator visually active
            ...(shouldPulse ? { flash: 'power' as FlashPose, particle: 'power_burst' as ParticleType } : {}),
          });
        }
      }
    }

    this.processedCount = events.length;
    return commands;
  }

  /** Called every frame. dt is seconds since last tick. */
  tick(dt: number): void {
    for (const m of this.momentum.values()) {
      if (m.terminalPose) continue;
      m.energy = clampEnergy(m.energy - ENERGY_DECAY_PER_SEC * dt);
    }
  }

  /** Set terminal poses when competition ends. null winnerId = tie (all salute). */
  setTerminalPoses(winnerId: string | null, teamIds: string[]): void {
    for (const id of teamIds) {
      const m = this.momentum.get(id);
      if (!m) continue;

      let pose: TerminalPose;
      if (winnerId === null) {
        pose = 'salute';
      } else if (id === winnerId) {
        pose = 'triumph';
      } else {
        pose = 'kneel';
      }

      m.terminalPose = pose;
    }
  }
}
