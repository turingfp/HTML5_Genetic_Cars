/**
 * Replay recording.
 *
 * A car's shape never changes, so a replay only needs the pose of the chassis
 * and each wheel per frame: three floats each. The original stored every
 * polygon of every car every frame, which allocated tens of thousands of
 * objects per second and grew without bound.
 *
 * A car can have two to four wheels, so the stride is fixed per recorder rather
 * than globally.
 */

import { REPLAY_MAX_FRAMES } from '../config';
import type { CarDef } from '../ga/genome';

const FLOATS_PER_POSE = 3;

/** Floats per frame for a car with this many wheels. */
export function replayStride(wheelCount: number): number {
  return (1 + wheelCount) * FLOATS_PER_POSE;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export class ReplayRecorder {
  readonly wheelCount: number;
  readonly stride: number;
  private data: Float32Array;
  private count = 0;

  constructor(wheelCount: number, initialFrames = 1024) {
    this.wheelCount = wheelCount;
    this.stride = replayStride(wheelCount);
    this.data = new Float32Array(initialFrames * this.stride);
  }

  get frameCount(): number {
    return this.count;
  }

  add(chassis: Pose, wheels: readonly Pose[]): void {
    if (this.count >= REPLAY_MAX_FRAMES) return;

    const needed = (this.count + 1) * this.stride;
    if (needed > this.data.length) {
      const grown = new Float32Array(
        Math.min(this.data.length * 2, REPLAY_MAX_FRAMES * this.stride),
      );
      grown.set(this.data);
      this.data = grown;
    }

    const d = this.data;
    let o = this.count * this.stride;
    d[o++] = chassis.x;
    d[o++] = chassis.y;
    d[o++] = chassis.angle;
    for (let i = 0; i < this.wheelCount; i++) {
      const wheel = wheels[i];
      d[o++] = wheel?.x ?? 0;
      d[o++] = wheel?.y ?? 0;
      d[o++] = wheel?.angle ?? 0;
    }
    this.count++;
  }

  /** Trim to exactly the frames recorded, for long-term storage as a ghost. */
  finish(): Float32Array {
    return this.data.slice(0, this.count * this.stride);
  }
}

/** A finished replay, kept as the ghost to race against. */
export interface Replay {
  def: CarDef;
  frames: Float32Array;
  frameCount: number;
  wheelCount: number;
  score: number;
  generation: number;
}

/** Read a frame into caller-owned poses, avoiding per-frame allocation. */
export function readReplayFrame(
  replay: Replay,
  frame: number,
  chassis: Pose,
  wheels: Pose[],
): boolean {
  if (frame < 0 || frame >= replay.frameCount) return false;
  const d = replay.frames;
  let o = frame * replayStride(replay.wheelCount);
  chassis.x = d[o++]!;
  chassis.y = d[o++]!;
  chassis.angle = d[o++]!;
  while (wheels.length < replay.wheelCount) wheels.push({ x: 0, y: 0, angle: 0 });
  wheels.length = replay.wheelCount;
  for (let i = 0; i < replay.wheelCount; i++) {
    const wheel = wheels[i]!;
    wheel.x = d[o++]!;
    wheel.y = d[o++]!;
    wheel.angle = d[o++]!;
  }
  return true;
}
