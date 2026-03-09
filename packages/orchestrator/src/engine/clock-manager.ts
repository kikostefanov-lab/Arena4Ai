import { EventEmitter } from 'node:events';
import { EventType } from '@arena/shared';

const WARNING_THRESHOLD = 0.8;
const TICK_MS = 100;

/**
 * Manages competition wall-clock time.
 *
 * Emits:
 *   EventType.TIME_WARNING  (elapsed: number)  — once, at 80% of limitMs
 *   EventType.TIME_UP       (elapsed: number)  — once, at limitMs
 */
export class ClockManager extends EventEmitter {
  private readonly limitMs: number;
  private startedAt: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private warnFired = false;
  private upFired = false;
  /** Timestamp when pause() was called, or undefined if not paused. */
  private _pausedAt: number | undefined;
  /** Total milliseconds accumulated during all pause periods. */
  private _totalPausedMs = 0;

  constructor(limitMs: number) {
    super();
    this.limitMs = limitMs;
  }

  start(): void {
    if (this.intervalId !== null) return; // already running
    this.startedAt = Date.now();
    this.warnFired = false;
    this.upFired = false;
    this._pausedAt = undefined;
    this._totalPausedMs = 0;

    this.intervalId = setInterval(() => this._tick(), TICK_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  pause(): void {
    if (this._pausedAt !== undefined) return; // already paused
    if (this.intervalId === null) return; // not running
    this._pausedAt = Date.now();
    clearInterval(this.intervalId);
    this.intervalId = null;
  }

  resume(): void {
    if (this._pausedAt === undefined) return; // not paused
    this._totalPausedMs += Date.now() - this._pausedAt;
    this._pausedAt = undefined;
    this.intervalId = setInterval(() => this._tick(), TICK_MS);
  }

  /** Milliseconds elapsed since start(), excluding any paused time, or 0 if not yet started. */
  elapsed(): number {
    if (this.startedAt === null) return 0;
    const pausedNow = this._pausedAt !== undefined ? Date.now() - this._pausedAt : 0;
    return Date.now() - this.startedAt - this._totalPausedMs - pausedNow;
  }

  private _tick(): void {
    const elapsed = this.elapsed();
    const warningAt = this.limitMs * WARNING_THRESHOLD;

    if (!this.warnFired && elapsed >= warningAt) {
      this.warnFired = true;
      this.emit(EventType.TIME_WARNING, elapsed);
    }

    if (!this.upFired && elapsed >= this.limitMs) {
      this.upFired = true;
      this.stop();
      this.emit(EventType.TIME_UP, elapsed);
    }
  }
}
