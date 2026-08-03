/**
 * Replay recording for the 3D mode.
 *
 * Only the chassis is stored. Every wheel hangs off a mount that is fixed in
 * the body's own frame, so given the chassis pose the wheels can be put back
 * exactly where they were, and how far each has spun is distance over radius.
 * Storing a full pose per body instead would be sixty-three floats a frame
 * against seven, which for twenty cars over a ninety second round is the
 * difference between three megabytes and twenty-seven. On a phone that is the
 * difference between a feature and a crash.
 *
 * Seven floats: three of position, four of rotation. Quaternions are kept whole
 * rather than compressed, because a ghost that drifts out of true is worse than
 * one that costs a little more.
 */

import { REPLAY_MAX_FRAMES } from '../config';
import type { Car3DDef } from '../ga/genome3d';
import type { Quat, Vec3 } from '../sim3d/box3d';

/** Floats per recorded frame: position then rotation. */
export const REPLAY3D_STRIDE = 7;

/**
 * Frames between samples.
 *
 * A ghost is watched, not measured, and two samples a frame apart are within a
 * few centimetres of each other at any speed a car reaches. Halving the rate
 * halves the memory for a difference nobody can see.
 */
export const REPLAY3D_SAMPLE_EVERY = 2;

export class Replay3DRecorder {
  private data: Float32Array;
  private count = 0;
  private since = 0;

  constructor(initialFrames = 512) {
    this.data = new Float32Array(initialFrames * REPLAY3D_STRIDE);
  }

  get frameCount(): number {
    return this.count;
  }

  /**
   * Offer the current pose. Returns quietly when it is not a sampling frame,
   * so the caller can hand over every step without knowing the rate.
   */
  add(position: Vec3, rotation: Quat): void {
    if (this.since++ % REPLAY3D_SAMPLE_EVERY !== 0) return;
    if (this.count >= REPLAY_MAX_FRAMES) return;

    const needed = (this.count + 1) * REPLAY3D_STRIDE;
    if (needed > this.data.length) {
      const grown = new Float32Array(
        Math.min(Math.max(this.data.length * 2, needed), REPLAY_MAX_FRAMES * REPLAY3D_STRIDE),
      );
      grown.set(this.data);
      this.data = grown;
    }

    const d = this.data;
    let o = this.count * REPLAY3D_STRIDE;
    d[o++] = position.x;
    d[o++] = position.y;
    d[o++] = position.z;
    d[o++] = rotation.x;
    d[o++] = rotation.y;
    d[o++] = rotation.z;
    d[o++] = rotation.w;
    this.count++;
  }

  /** Trim to exactly what was recorded, for keeping as a ghost. */
  finish(): Float32Array {
    return this.data.slice(0, this.count * REPLAY3D_STRIDE);
  }
}

/** A finished 3D run, kept as the ghost to race against. */
export interface Replay3D {
  def: Car3DDef;
  frames: Float32Array;
  frameCount: number;
  score: number;
  generation: number;
  /** Who drove it. Empty for your own. */
  who: string;
}

/** Read a frame into caller-owned values, so playback allocates nothing. */
export function readReplay3DFrame(
  replay: Replay3D,
  frame: number,
  position: Vec3,
  rotation: Quat,
): boolean {
  if (frame < 0 || frame >= replay.frameCount) return false;
  const d = replay.frames;
  let o = frame * REPLAY3D_STRIDE;
  position.x = d[o++]!;
  position.y = d[o++]!;
  position.z = d[o++]!;
  rotation.x = d[o++]!;
  rotation.y = d[o++]!;
  rotation.z = d[o++]!;
  rotation.w = d[o++]!;
  return true;
}

/** How many physics steps one recorded frame stands for. */
export function replay3DStepsPerFrame(): number {
  return REPLAY3D_SAMPLE_EVERY;
}
