import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClockManager } from './clock-manager.js';
import { EventType } from '@arena/shared';

describe('ClockManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits TIME_WARNING at 80% of the limit', () => {
    const clock = new ClockManager(1000);
    const warnings: number[] = [];
    clock.on(EventType.TIME_WARNING, (elapsed: number) => warnings.push(elapsed));

    clock.start();
    vi.advanceTimersByTime(800);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(800);
  });

  it('emits TIME_UP at the limit', () => {
    const clock = new ClockManager(1000);
    const ups: number[] = [];
    clock.on(EventType.TIME_UP, (elapsed: number) => ups.push(elapsed));

    clock.start();
    vi.advanceTimersByTime(1000);

    expect(ups).toHaveLength(1);
    expect(ups[0]).toBe(1000);
  });

  it('does not emit TIME_WARNING a second time if already fired', () => {
    const clock = new ClockManager(1000);
    let count = 0;
    clock.on(EventType.TIME_WARNING, () => count++);

    clock.start();
    vi.advanceTimersByTime(800);
    vi.advanceTimersByTime(100);

    expect(count).toBe(1);
  });

  it('stop() prevents further events from firing', () => {
    const clock = new ClockManager(1000);
    let warningFired = false;
    let upFired = false;
    clock.on(EventType.TIME_WARNING, () => (warningFired = true));
    clock.on(EventType.TIME_UP, () => (upFired = true));

    clock.start();
    vi.advanceTimersByTime(500);
    clock.stop();
    vi.advanceTimersByTime(1000);

    expect(warningFired).toBe(false);
    expect(upFired).toBe(false);
  });

  it('elapsed() returns milliseconds since start', () => {
    const clock = new ClockManager(1000);
    clock.start();
    vi.advanceTimersByTime(400);
    expect(clock.elapsed()).toBe(400);
  });

  it('elapsed() returns 0 before start', () => {
    const clock = new ClockManager(1000);
    expect(clock.elapsed()).toBe(0);
  });

  describe('pause and resume', () => {
    it('freezes elapsed time while paused', () => {
      const clock = new ClockManager(5000);

      clock.start();
      vi.advanceTimersByTime(300);
      clock.pause();
      // Time advances but clock is paused — elapsed should stay at 300
      vi.advanceTimersByTime(500);

      expect(clock.elapsed()).toBe(300);
    });

    it('resumes accounting from where it left off after multiple pause/resume cycles', () => {
      const clock = new ClockManager(5000);

      clock.start();
      vi.advanceTimersByTime(200); // elapsed: 200
      clock.pause();
      vi.advanceTimersByTime(100); // paused: 100 (not counted)
      clock.resume();
      vi.advanceTimersByTime(300); // elapsed: 500
      clock.pause();
      vi.advanceTimersByTime(400); // paused: 400 (not counted)
      clock.resume();
      vi.advanceTimersByTime(100); // elapsed: 600

      expect(clock.elapsed()).toBe(600);
    });
  });
});
