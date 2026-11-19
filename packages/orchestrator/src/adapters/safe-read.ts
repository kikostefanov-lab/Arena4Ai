/**
 * Reading files an agent wrote, without trusting what it wrote.
 *
 * A workdir is shaped by model-written code. It can plant a FIFO (opening it
 * blocks until a writer appears, i.e. forever, and a sync open freezes the
 * whole event loop), a symlink to /dev/zero (an endless read), or a symlink to
 * a file outside the workdir (a read of the operator's files). It can also swap
 * a regular file for one of those between our directory listing and our read.
 *
 * So every read here:
 *  - opens with O_NOFOLLOW (a symlink fails with ELOOP instead of being
 *    followed) and O_NONBLOCK (a FIFO or device opens at once instead of
 *    waiting for a writer);
 *  - fstat()s the open fd, so the checks apply to the thing actually opened,
 *    not to whatever the path named a moment earlier;
 *  - reads only a regular file, only up to its fstat size and the caller's cap;
 *  - always closes the fd.
 *
 * O_NOFOLLOW guards the last path component only. The walkers lstat each
 * directory before descending, which narrows (but cannot close, without
 * openat) the window for swapping a parent directory for a symlink.
 */
import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from 'node:fs';
import { open } from 'node:fs/promises';

/** O_NOFOLLOW / O_NONBLOCK are POSIX; on Windows they are absent and FIFOs are not a concern. */
const SAFE_OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

export interface SafeRead {
  /** Bytes read: the whole file, or its first `limit` bytes when a limit was given. */
  data: Buffer;
  /** Size of the opened file, from fstat. */
  size: number;
}

/**
 * Synchronously read a regular file at `full`, or return null when it is not
 * one (symlink, FIFO, device, socket, directory), is larger than `maxBytes`,
 * or cannot be opened. `limit` reads only the first bytes (a sniff).
 */
export function readRegularFileSync(full: string, maxBytes: number, limit?: number): SafeRead | null {
  let fd: number | undefined;
  try {
    fd = openSync(full, SAFE_OPEN_FLAGS);
    const info: Stats = fstatSync(fd);
    if (!info.isFile() || info.size > maxBytes) return null;
    const want = Math.min(info.size, limit ?? info.size);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const n = readSync(fd, buf, got, want - got, got);
      if (n === 0) break; // truncated since fstat
      got += n;
    }
    return { data: buf.subarray(0, got), size: info.size };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* already gone */ }
    }
  }
}

/** Async twin of {@link readRegularFileSync}, for collection. */
export async function readRegularFile(full: string, maxBytes: number): Promise<SafeRead | null> {
  let handle;
  try {
    handle = await open(full, SAFE_OPEN_FLAGS);
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return null;
    const buf = Buffer.alloc(info.size);
    let got = 0;
    while (got < info.size) {
      const { bytesRead } = await handle.read(buf, got, info.size - got, got);
      if (bytesRead === 0) break; // truncated since fstat
      got += bytesRead;
    }
    return { data: buf.subarray(0, got), size: info.size };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
