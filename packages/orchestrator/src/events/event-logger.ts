import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArenaEvent } from '@arena/shared';

/**
 * Writes ArenaEvents to a newline-delimited JSON (JSONL) file.
 *
 * One file per competition: `<logDir>/<competitionId>.jsonl`
 *
 * Usage:
 *   const logger = new EventLogger('/var/arena/logs', 'comp-123');
 *   await logger.open();
 *   logger.on('arenaEvent', (e) => logger.log(e));   // wire up to adapter
 *   await logger.close();
 */
export class EventLogger {
  private readonly filePath: string;
  private stream: WriteStream | null = null;

  constructor(
    private readonly logDir: string,
    private readonly competitionId: string,
  ) {
    this.filePath = join(logDir, `${competitionId}.jsonl`);
  }

  /** Open (or re-open) the log file for appending. */
  async open(): Promise<void> {
    await mkdir(this.logDir, { recursive: true });
    return new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
      ws.on('open', () => {
        this.stream = ws;
        resolve();
      });
      ws.on('error', reject);
    });
  }

  /**
   * Append a single ArenaEvent as a JSON line.
   * Throws if open() has not been called.
   */
  async log(event: ArenaEvent): Promise<void> {
    if (!this.stream) {
      throw new Error('EventLogger is not open. Call open() before log().');
    }
    const line = JSON.stringify(event) + '\n';
    return new Promise<void>((resolve, reject) => {
      this.stream!.write(line, (err) => (err ? reject(err) : resolve()));
    });
  }

  /** Flush and close the underlying write stream. */
  async close(): Promise<void> {
    if (!this.stream) return;
    return new Promise<void>((resolve, reject) => {
      this.stream!.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
      this.stream = null;
    });
  }

  /** Path of the JSONL file being written to. */
  get path(): string {
    return this.filePath;
  }
}
