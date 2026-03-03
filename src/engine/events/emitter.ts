/**
 * RunEventEmitter — buffers execution events and forwards them to the renderer via IPC.
 *
 * Each DAG run gets its own emitter. Events are sent on a dynamic channel
 * `engine:event:{runId}` following the same pattern as agent events.
 */

import type { WebContents } from 'electron';
import type { ExecutionEvent } from './types';
import { IPC_CHANNELS } from '../../types/ipc';

export class RunEventEmitter {
  private buffer: ExecutionEvent[] = [];
  private webContents: WebContents;
  private runId: string;

  constructor(webContents: WebContents, runId: string) {
    this.webContents = webContents;
    this.runId = runId;
  }

  /** Emit an event: buffer it and forward to the renderer via IPC. */
  emit(event: ExecutionEvent): void {
    this.buffer.push(event);

    if (!this.webContents.isDestroyed()) {
      const channel = IPC_CHANNELS.engineEvent(this.runId);
      this.webContents.send(channel, event);
    }
  }

  /** Return all buffered events (for future persistence). */
  getBuffer(): ExecutionEvent[] {
    return [...this.buffer];
  }

  /** Clear the event buffer. */
  clear(): void {
    this.buffer = [];
  }
}
