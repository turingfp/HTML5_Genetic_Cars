/**
 * Replay recording.
 *
 * A car's shape never changes, so a replay only needs the pose of the chassis
 * and the two wheels per frame — nine floats. The original stored every
 * polygon of every car every frame, which allocated tens of thousands of
 * objects per second and grew without bound.
 */

import { REPLAY_FLOATS_PER_FRAME, REPLAY_MAX_FRAMES } from '../config';
import type { CarDef } from '../ga/genome';

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export class ReplayRecorder {
  private data: Float32Array;
  private count = 0;

  constructor(initialFrames = 1024) {
    this.data = new Float32Array(initialFrames * REPLAY_FLOATS_PER_FRAME);
  }

  get frameCount(): number {
    return this.count;
  }

  add(chassis: Pose, wheel1: Pose, wheel2: Pose): void {
    if (this.count >= REPLAY_MAX_FRAMES) return;

    const needed = (this.count + 1) * REPLAY_FLOATS_PER_FRAME;
    if (needed > this.data.length) {
      const grown = new Float32Array(Math.min(this.data.length * 2, REPLAY_MAX_FRAMES * REPLAY_FLOATS_PER_FRAME));
      grown.set(this.data);
      this.data = grown;
    }

    const o = this.count * REPLAY_FLOATS_PER_FRAME;
    const d = this.data;
    d[o] = chassis.x;
    d[o + 1] = chassis.y;
    d[o + 2] = chassis.angle;
    d[o + 3] = wheel1.x;
    d[o + 4] = wheel1.y;
    d[o + 5] = wheel1.angle;
    d[o + 6] = wheel2.x;
    d[o + 7] = wheel2.y;
    d[o + 8] = wheel2.angle;
    this.count++;
  }

  /** Read a frame into caller-owned poses, avoiding per-frame allocation. */
  read(frame: number, chassis: Pose, wheel1: Pose, wheel2: Pose): boolean {
    if (frame < 0 || frame >= this.count) return false;
    const o = frame * REPLAY_FLOATS_PER_FRAME;
    const d = this.data;
    chassis.x = d[o]!;
    chassis.y = d[o + 1]!;
    chassis.angle = d[o + 2]!;
    wheel1.x = d[o + 3]!;
    wheel1.y = d[o + 4]!;
    wheel1.angle = d[o + 5]!;
    wheel2.x = d[o + 6]!;
    wheel2.y = d[o + 7]!;
    wheel2.angle = d[o + 8]!;
    return true;
  }

  /** Trim to exactly the frames recorded, for long-term storage as a ghost. */
  finish(): Float32Array {
    return this.data.slice(0, this.count * REPLAY_FLOATS_PER_FRAME);
  }
}

/** A finished replay, kept as the ghost to race against. */
export interface Replay {
  def: CarDef;
  frames: Float32Array;
  frameCount: number;
  score: number;
  generation: number;
}

export function readReplayFrame(
  replay: Replay,
  frame: number,
  chassis: Pose,
  wheel1: Pose,
  wheel2: Pose,
): boolean {
  if (frame < 0 || frame >= replay.frameCount) return false;
  const o = frame * REPLAY_FLOATS_PER_FRAME;
  const d = replay.frames;
  chassis.x = d[o]!;
  chassis.y = d[o + 1]!;
  chassis.angle = d[o + 2]!;
  wheel1.x = d[o + 3]!;
  wheel1.y = d[o + 4]!;
  wheel1.angle = d[o + 5]!;
  wheel2.x = d[o + 6]!;
  wheel2.y = d[o + 7]!;
  wheel2.angle = d[o + 8]!;
  return true;
}
