import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isVendoredPath } from '@arena/shared';
import { MAX_FILE_BYTES } from './base-adapter.js';
import { readRegularFileSync } from './safe-read.js';

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
/** The spec's poll interval: a full walk every second was twice the cost for no gain. */
const DEFAULT_POLL_MS = 2000;
/** Bytes sniffed for a NUL to tell a binary file from text, as collection does. */
const SNIFF_BYTES = 8192;
/** Files one scan looks at before giving up on the rest (a vendored tree we missed). */
export const MAX_SCAN_FILES = 5000;

/**
 * True when the file's first bytes contain a NUL (collection would skip it too)
 * or it cannot be read as a regular file. The read never follows a symlink and
 * never blocks on a FIFO or device the agent swapped in (see safe-read.ts).
 */
function looksBinary(full: string): boolean {
  const read = readRegularFileSync(full, MAX_FILE_BYTES, SNIFF_BYTES);
  if (!read) return true; // not a regular file: nothing collection could show either
  return read.data.includes(0);
}

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
  private cappedLogged = false;

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

  /**
   * Last look before collection: one more scan, then every pending observation
   * goes out now rather than after its hold, so files a sub-agent wrote in the
   * final seconds still reach the city. The stream still wins: a path it
   * reported around the observation is not emitted again.
   */
  finalFlush(): void {
    this.stop();
    this.scanOnce();
    this.flushDue(true);
  }

  /** The stream reported this path (relative to the workdir). */
  noteStreamPath(relPath: string): void {
    this.streamAt.set(relPath, this.now());
    this.reported.add(relPath);
  }

  scanOnce(): void {
    const t = this.now();
    let seen = 0;
    this.walk('', (rel, signature, full) => {
      if (++seen > MAX_SCAN_FILES) {
        if (!this.cappedLogged) {
          this.cappedLogged = true;
          console.warn(`[arena] workdir watcher: ${this.opts.root} has more than ${MAX_SCAN_FILES} files; scanning only the first ${MAX_SCAN_FILES}`);
        }
        return false;
      }
      if (this.known.get(rel) === signature) return true;
      this.known.set(rel, signature);
      // Sniffed once per change: a binary is remembered by its signature too,
      // so it is not re-read on every scan.
      if (looksBinary(full)) return true;
      if (!this.pending.has(rel)) this.pending.set(rel, t);
      return true;
    });
  }

  /** Emit observations whose hold has passed (all of them when `now` is set). */
  flushDue(now = false): void {
    const t = this.now();
    for (const [rel, observedAt] of [...this.pending]) {
      if (!now && t - observedAt < this.holdMs) continue;
      this.pending.delete(rel);
      const streamed = this.streamAt.get(rel);
      if (streamed !== undefined && streamed >= observedAt - this.holdMs) continue;
      const op = this.reported.has(rel) ? 'modify' : 'create';
      this.reported.add(rel);
      this.opts.onFile({ path: rel, op });
    }
  }

  /** Walk the tree; `visit` returns false to stop the walk. Returns false once stopped. */
  private walk(rel: string, visit: (rel: string, signature: string, full: string) => boolean): boolean {
    let entries;
    try {
      entries = readdirSync(join(this.opts.root, rel), { withFileTypes: true });
    } catch {
      return true;
    }
    // Agent-controlled tree: lstat, never stat. A symlink, FIFO or device is
    // skipped, and an entry swapped since readdir is re-checked here.
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || isVendoredPath(childRel)) continue;
        if (!isRealDirectory(join(this.opts.root, childRel))) continue;
        if (!this.walk(childRel, visit)) return false;
      } else if (entry.isFile()) {
        if (isVendoredPath(childRel)) continue;
        const full = join(this.opts.root, childRel);
        let info;
        try {
          info = lstatSync(full);
        } catch { continue; /* vanished mid-scan */ }
        if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
        if (!visit(childRel, `${info.mtimeMs}:${info.size}`, full)) return false;
      }
    }
    return true;
  }
}

/** True for a directory that is not a symlink (lstat), at the moment of asking. */
function isRealDirectory(full: string): boolean {
  try {
    return lstatSync(full).isDirectory();
  } catch {
    return false;
  }
}
