import type { PlayerInput } from '@dd/sim';

/** Records per-tick inputs so a run can be replayed deterministically with other tuning values. */
export class ReplayRecorder {
  private frames: [PlayerInput, PlayerInput][] = [];
  private mode: 'idle' | 'recording' | 'playing' = 'idle';
  private cursor = 0;

  get state(): 'idle' | 'recording' | 'playing' {
    return this.mode;
  }

  get length(): number {
    return this.frames.length;
  }

  startRecording(): void {
    this.frames = [];
    this.mode = 'recording';
  }

  stop(): void {
    this.mode = 'idle';
  }

  /** Returns true when there is something to play. */
  startPlayback(): boolean {
    if (this.frames.length === 0) return false;
    this.cursor = 0;
    this.mode = 'playing';
    return true;
  }

  /** Call once per tick with the live inputs; returns the inputs to feed the sim. */
  process(live: [PlayerInput, PlayerInput]): [PlayerInput, PlayerInput] {
    if (this.mode === 'recording') {
      this.frames.push([{ ...live[0] }, { ...live[1] }]);
      return live;
    }
    if (this.mode === 'playing') {
      const f = this.frames[this.cursor++];
      if (!f) {
        this.mode = 'idle';
        return live;
      }
      return f;
    }
    return live;
  }
}
