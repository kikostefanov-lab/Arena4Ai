import { EventEmitter } from 'node:events';
import type { ArenaEvent, Brief, Deliverable, ModelAdapter } from '@arena/shared';

/**
 * Abstract base class for all model adapters.
 *
 * Subclasses must implement:
 *   - injectBrief()
 *   - startExecution()
 *   - collectDeliverables()
 *   - shutdown()
 *
 * Events emitted:
 *   'arenaEvent'  (event: ArenaEvent)  — whenever the model produces output
 *   'error'       (err: Error)         — unrecoverable adapter error
 */
export abstract class BaseAdapter extends EventEmitter implements ModelAdapter {
  readonly teamId: string;

  constructor(teamId: string) {
    super();
    this.teamId = teamId;
  }

  abstract injectBrief(brief: Brief, persona: string): Promise<void>;
  abstract startExecution(): Promise<void>;
  abstract collectDeliverables(): Promise<Deliverable>;
  abstract shutdown(): Promise<void>;

  /** Convenience: emit a typed ArenaEvent to all listeners. */
  protected emitArenaEvent(event: ArenaEvent): void {
    this.emit('arenaEvent', event);
  }
}
