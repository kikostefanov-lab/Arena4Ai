import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isVendoredPath } from '@arena/shared';
import { MAX_FILE_BYTES } from './base-adapter.js';

export interface WatchedFile {
  /** Relative to the workdir, the same shape stream events use. */
  path: string;
  op: 'create' | 'modify';
}

interface Options {
  root: string;
  /** How long an observation waits for the stream to claim it. */
  holdMs?: number;
  pollMs?: number;
  now?: () => number;
  onFile: (f: WatchedFile) => void;
}

const DEFAULT_HOLD_MS = 5000;
const DEFAULT_POLL_MS = 1000;

/**
 * Sees files the agent CLI's own event stream never reports (Codex and Gemini
 * sub-agents write straight to disk). It polls the workdir, holds each
 * observation for `holdMs`, and emits it only if the stream did not report the
 * same path around that time: the CLI's events stay authoritative.
 */
export class WorkdirWatcher {
  private readonly holdMs: number;
  private readonly pollMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  /** Last stat signature per path, to spot changes between scans. */
  private readonly known = new Map<string, string>();
  /** Paths already reported by either source: the next one is a modify. */
  private readonly reported = new Set<string>();
  private readonly pending = new Map<string, number>();
  private readonly streamAt = new Map<string, number>();

  constructor(private readonly opts: Options) {
    this.holdMs = opts.holdMs ?? DEFAULT_HOLD_MS;
    this.pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
    this.now = opts.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.scanOnce(); this.flushDue(); }, this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The stream reported this path (relative to the workdir). */
  noteStreamPath(relPath: string): void {
    this.streamAt.set(relPath, this.now());
    this.reported.add(relPath);
  }

  scanOnce(): void {
    const t = this.now();
    this.walk('', (rel, signature) => {
      if (this.known.get(rel) === signature) return;
      this.known.set(rel, signature);
      if (!this.pending.has(rel)) this.pending.set(rel, t);
    });
  }

  flushDue(): void {
    const t = this.now();
    for (const [rel, observedAt] of [...this.pending]) {
      if (t - observedAt < this.holdMs) continue;
      this.pending.delete(rel);
      const streamed = this.streamAt.get(rel);
      if (streamed !== undefined && streamed >= observedAt - this.holdMs) continue;
      const op = this.reported.has(rel) ? 'modify' : 'create';
      this.reported.add(rel);
      this.opts.onFile({ path: rel, op });
    }
  }

  private walk(rel: string, visit: (rel: string, signature: string) => void): void {
    let entries;
    try {
      entries = readdirSync(join(this.opts.root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || isVendoredPath(childRel)) continue;
        this.walk(childRel, visit);
      } else if (entry.isFile()) {
        if (isVendoredPath(childRel)) continue;
        try {
          const info = statSync(join(this.opts.root, childRel));
          if (info.size > MAX_FILE_BYTES) continue;
          visit(childRel, `${info.mtimeMs}:${info.size}`);
        } catch { /* vanished mid-scan */ }
      }
    }
  }
}
