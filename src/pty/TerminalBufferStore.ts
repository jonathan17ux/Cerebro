/**
 * TerminalBufferStore — persists raw PTY output per run to disk so the
 * Console tab can replay it after app restart.
 *
 * Files are stored as `task-terminal-buffers/<runId>.buf` under userData.
 * Raw UTF-8 (ANSI escape codes preserved) capped at MAX_BUFFER_SIZE per run.
 * Writes are debounced (FLUSH_INTERVAL_MS) to avoid hammering disk.
 */

import { join } from 'path';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
  appendFileSync,
} from 'fs';
import { readFile, writeFile, appendFile } from 'fs/promises';

const MAX_BUFFER_SIZE = 512 * 1024; // 512 KB per run
const FLUSH_INTERVAL_MS = 5000; // 5 seconds

export class TerminalBufferStore {
  private dir: string;
  private pending = new Map<string, string[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(userDataPath: string) {
    this.dir = join(userDataPath, 'task-terminal-buffers');
    mkdirSync(this.dir, { recursive: true });
  }

  /** Append PTY data for a run. Debounces disk writes every FLUSH_INTERVAL_MS. */
  append(runId: string, data: string): void {
    let chunks = this.pending.get(runId);
    if (!chunks) {
      chunks = [];
      this.pending.set(runId, chunks);
    }
    chunks.push(data);

    if (!this.timers.has(runId)) {
      this.timers.set(
        runId,
        setTimeout(() => {
          this.timers.delete(runId);
          void this.flushAsync(runId);
        }, FLUSH_INTERVAL_MS),
      );
    }
  }

  /** Read persisted buffer from disk. Returns null if no file exists. */
  read(runId: string): string | null {
    try {
      return readFileSync(this.filePath(runId), 'utf-8');
    } catch {
      return null;
    }
  }

  /** Delete the buffer file for a run. */
  remove(runId: string): void {
    this.pending.delete(runId);
    const timer = this.timers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }
    try {
      unlinkSync(this.filePath(runId));
    } catch {
      /* file may not exist */
    }
  }

  /** Immediately flush pending data to disk (sync) for one run. */
  flush(runId: string): void {
    const timer = this.timers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }

    const chunks = this.pending.get(runId);
    if (!chunks || chunks.length === 0) return;
    this.pending.delete(runId);

    const pendingData = chunks.join('');
    const filePath = this.filePath(runId);
    try {
      const fileSize = this.getFileSize(filePath);
      if (fileSize + pendingData.length <= MAX_BUFFER_SIZE) {
        appendFileSync(filePath, pendingData, 'utf-8');
      } else {
        let existing = '';
        try {
          existing = readFileSync(filePath, 'utf-8');
        } catch {
          /* no existing file */
        }
        const combined = this.capToSize(existing + pendingData);
        writeFileSync(filePath, combined, 'utf-8');
      }
    } catch {
      /* non-fatal */
    }
  }

  /** Flush all pending data synchronously. Called on app quit. */
  flushAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const runId of Array.from(this.pending.keys())) {
      this.flush(runId);
    }
  }

  /** Remove buffer files for runs that no longer exist. */
  pruneOrphans(validRunIds: Set<string>): void {
    try {
      const files = readdirSync(this.dir);
      for (const file of files) {
        if (!file.endsWith('.buf')) continue;
        const runId = file.slice(0, -4);
        if (!validRunIds.has(runId)) {
          try {
            unlinkSync(join(this.dir, file));
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  private filePath(runId: string): string {
    return join(this.dir, `${runId}.buf`);
  }

  private getFileSize(filePath: string): number {
    try {
      return statSync(filePath).size;
    } catch {
      return 0;
    }
  }

  private capToSize(data: string): string {
    if (data.length <= MAX_BUFFER_SIZE) return data;
    return data.slice(data.length - MAX_BUFFER_SIZE);
  }

  private async flushAsync(runId: string): Promise<void> {
    const chunks = this.pending.get(runId);
    if (!chunks || chunks.length === 0) return;
    this.pending.delete(runId);

    const pendingData = chunks.join('');
    const filePath = this.filePath(runId);
    try {
      const fileSize = this.getFileSize(filePath);
      if (fileSize + pendingData.length <= MAX_BUFFER_SIZE) {
        await appendFile(filePath, pendingData, 'utf-8');
      } else {
        let existing = '';
        try {
          existing = await readFile(filePath, 'utf-8');
        } catch {
          /* no existing file */
        }
        const combined = this.capToSize(existing + pendingData);
        await writeFile(filePath, combined, 'utf-8');
      }
    } catch {
      /* non-fatal */
    }
  }
}
