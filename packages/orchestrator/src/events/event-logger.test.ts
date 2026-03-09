import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLogger } from './event-logger.js';
import { EventType } from '@arena/shared';
import type { ArenaEvent } from '@arena/shared';
import { randomUUID } from 'node:crypto';

function makeEvent(type: EventType = EventType.REASONING): ArenaEvent {
  return {
    eventId: randomUUID(),
    competitionId: 'comp-test',
    teamId: 'team-a',
    timestamp: new Date().toISOString(),
    type,
    payload: { text: 'hello' },
    metadata: {},
  };
}

describe('EventLogger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'arena-event-logger-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates a JSONL file and writes one line per event', async () => {
    const logger = new EventLogger(dir, 'comp-test');
    await logger.open();

    await logger.log(makeEvent(EventType.REASONING));
    await logger.log(makeEvent(EventType.TOOL_CALL));
    await logger.close();

    const content = await readFile(join(dir, 'comp-test.jsonl'), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('each line is valid JSON with required ArenaEvent fields', async () => {
    const logger = new EventLogger(dir, 'comp-test');
    await logger.open();
    await logger.log(makeEvent());
    await logger.close();

    const content = await readFile(join(dir, 'comp-test.jsonl'), 'utf8');
    const parsed = JSON.parse(content.trim()) as Record<string, unknown>;
    expect(parsed).toHaveProperty('eventId');
    expect(parsed).toHaveProperty('competitionId', 'comp-test');
    expect(parsed).toHaveProperty('type');
    expect(parsed).toHaveProperty('timestamp');
  });

  it('appends if the file already exists', async () => {
    const logger = new EventLogger(dir, 'comp-test');
    await logger.open();
    await logger.log(makeEvent());
    await logger.close();

    const logger2 = new EventLogger(dir, 'comp-test');
    await logger2.open();
    await logger2.log(makeEvent());
    await logger2.close();

    const content = await readFile(join(dir, 'comp-test.jsonl'), 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it('throws if log() is called before open()', async () => {
    const logger = new EventLogger(dir, 'comp-test');
    await expect(logger.log(makeEvent())).rejects.toThrow(/not open/i);
  });
});
