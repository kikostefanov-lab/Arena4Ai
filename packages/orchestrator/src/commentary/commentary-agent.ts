import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { CompetitionRunner } from '../engine/competition-runner.js';
import { EventType, type ArenaEvent } from '@arena/shared';
import { claudeEnv } from '../utils/claude-env.js';

export interface CommentaryOptions {
  claudeBin?: string;
  /** How many events to buffer before generating commentary. Default 5. */
  batchSize?: number;
}

export class CommentaryAgent {
  private buffer: ArenaEvent[] = [];
  private readonly batchSize: number;
  private readonly claudeBin: string;
  private running = false;
  private generating = false;

  constructor(
    private readonly runner: CompetitionRunner,
    options: CommentaryOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 5;
    this.claudeBin = options.claudeBin ?? 'claude';
  }

  start(): void {
    this.running = true;
    this.runner.on('arenaEvent', (event: ArenaEvent) => {
      if (!this.running) return;
      // Don't buffer commentary events to avoid feedback loops
      if (event.type === EventType.COMMENTARY) return;
      this.buffer.push(event);
      if (this.buffer.length >= this.batchSize && !this.generating) {
        void this.flush();
      }
    });
  }

  stop(): void {
    this.running = false;
  }

  private async flush(): Promise<void> {
    if (this.generating || this.buffer.length === 0) return;
    this.generating = true;
    const events = this.buffer.splice(0, this.batchSize);

    const eventSummary = events
      .map(e => `[${e.teamId || 'system'}] ${e.type}: ${
        typeof e.payload === 'object' && e.payload !== null && 'text' in e.payload
          ? String((e.payload as { text: string }).text).slice(0, 100)
          : JSON.stringify(e.payload).slice(0, 100)
      }`)
      .join('\n');

    const prompt = `You are a witty sports commentator for an AI coding competition. Based on these recent events, write ONE sentence of live commentary (max 120 chars). Be energetic, specific, and reference the teams. No preamble.\n\nEvents:\n${eventSummary}\n\nCommentary:`;

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          this.claudeBin,
          ['--print', '-', '--output-format', 'text', '--dangerously-skip-permissions'],
          { stdio: ['pipe', 'pipe', 'ignore'], env: claudeEnv() },
        );
        child.stdin!.write(prompt);
        child.stdin!.end();
        let out = '';
        child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
        const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, 15_000);
        child.on('close', (code: number | null) => {
          clearTimeout(timer);
          if (code === 0) resolve(out.trim());
          else reject(new Error(`exited ${code}`));
        });
        child.on('error', reject);
      });

      if (text) {
        const commentaryEvent: ArenaEvent = {
          eventId: randomUUID(),
          competitionId: this.runner.competitionId,
          teamId: '',
          type: EventType.COMMENTARY,
          payload: { text },
          timestamp: new Date().toISOString(),
          metadata: {},
        };
        this.runner.emit('arenaEvent', commentaryEvent);
      }
    } catch {
      // Non-fatal — commentary failures don't affect the competition
    } finally {
      this.generating = false;
    }
  }
}
