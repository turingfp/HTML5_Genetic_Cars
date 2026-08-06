/**
 * The ghost: the best run seen so far, replayed alongside the current
 * generation so progress is visible rather than merely charted.
 */

import type { CarDef } from '../ga/genome';
import type { GhostFrame } from '../render/renderer';
import { readReplayFrame, type Pose, type Replay, type ReplayRecorder } from './recorder';

export class Ghost {
  private replay: Replay | null = null;
  private cursor = 0;

  private chassis: Pose = { x: 0, y: 0, angle: 0 };
  private wheels: Pose[] = [];
  private frame: GhostFrame | null = null;

  get score(): number {
    return this.replay?.score ?? -Infinity;
  }

  get available(): boolean {
    return this.replay !== null;
  }

  get generation(): number {
    return this.replay?.generation ?? 0;
  }

  get frameCount(): number {
    return this.replay?.frameCount ?? 0;
  }

  get position(): number {
    return this.cursor;
  }

  /** Adopt a finished run if it beat the current ghost. */
  consider(recorder: ReplayRecorder, def: CarDef, score: number, generation: number): boolean {
    if (this.replay && score <= this.replay.score) return false;
    this.replay = {
      def,
      frames: recorder.finish(),
      frameCount: recorder.frameCount,
      wheelCount: recorder.wheelCount,
      score,
      generation,
    };
    this.rewind();
    return true;
  }

  clear(): void {
    this.replay = null;
    this.frame = null;
    this.cursor = 0;
  }

  rewind(): void {
    this.cursor = 0;
  }

  advance(): void {
    if (!this.replay) return;
    if (this.cursor < this.replay.frameCount - 1) this.cursor++;
  }

  /** Whether playback has reached the end of the recording. */
  get finished(): boolean {
    return !this.replay || this.cursor >= this.replay.frameCount - 1;
  }

  /** Current pose, or null when there is no ghost yet. Reuses its buffers. */
  current(): GhostFrame | null {
    const replay = this.replay;
    if (!replay) return null;
    if (!readReplayFrame(replay, this.cursor, this.chassis, this.wheels)) {
      return null;
    }
    if (!this.frame) {
      this.frame = { def: replay.def, chassis: this.chassis, wheels: this.wheels };
    } else {
      this.frame.def = replay.def;
    }
    return this.frame;
  }

  get def(): CarDef | null {
    return this.replay?.def ?? null;
  }
}
