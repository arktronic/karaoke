import type { Cursor, Project } from './types';

export interface TapSnapshot {
  /** State before the tap. */
  project: Project;
  cursor: Cursor;
  /** Playback time of the tap, used to seek back on undo. */
  atMs: number;
}

export class TapHistory {
  private stack: TapSnapshot[] = [];

  constructor(private readonly limit = 200) {}

  push(snapshot: TapSnapshot): void {
    this.stack.push(snapshot);
    if (this.stack.length > this.limit) {
      this.stack.shift();
    }
  }

  pop(): TapSnapshot | undefined {
    return this.stack.pop();
  }

  clear(): void {
    this.stack = [];
  }
}
