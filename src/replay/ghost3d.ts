/**
 * The 3D ghost: the best run on this track, replayed beside the cars still
 * trying.
 *
 * The flat mode has had one from the start and it is the single thing that
 * makes progress legible: a chart tells you the number went up, a ghost lets
 * you watch this generation pull away from the last one. 3D is the mode the
 * page opens in and had nothing.
 *
 * A ghost holds its own clock. It advances one recorded frame per sampling
 * interval of simulated time, so it stays in step with the live cars at any
 * speed setting, including max mode where many steps happen per drawn frame.
 */

import type { Quat, Vec3 } from '../sim3d/box3d';
import type { Car3DDef } from '../ga/genome3d';
import {
  readReplay3DFrame,
  replay3DStepsPerFrame,
  type Replay3D,
  type Replay3DRecorder,
} from './recorder3d';

/** Where a ghost is right now, for the renderer. */
export interface Ghost3DFrame {
  def: Car3DDef;
  position: Vec3;
  rotation: Quat;
  /** How far it has driven, so wheels can be spun without storing angles. */
  distance: number;
  who: string;
}

export class Ghost3D {
  private replay: Replay3D | null = null;
  /** Recorded frames elapsed, as a float so playback is smooth. */
  private cursor = 0;

  private readonly position: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rotation: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private frame: Ghost3DFrame | null = null;

  get available(): boolean {
    return this.replay !== null;
  }

  get score(): number {
    return this.replay?.score ?? -Infinity;
  }

  get generation(): number {
    return this.replay?.generation ?? 0;
  }

  get who(): string {
    return this.replay?.who ?? '';
  }

  /** Adopt a finished run if it beat the ghost already held. */
  consider(
    recorder: Replay3DRecorder,
    def: Car3DDef,
    score: number,
    generation: number,
    who = '',
  ): boolean {
    if (recorder.frameCount === 0) return false;
    if (this.replay && score <= this.replay.score) return false;
    this.replay = {
      def,
      frames: recorder.finish(),
      frameCount: recorder.frameCount,
      score,
      generation,
      who,
    };
    this.rewind();
    return true;
  }

  /** Take a ghost whole, as one arrives from someone else. */
  adopt(replay: Replay3D): boolean {
    if (this.replay && replay.score <= this.replay.score) return false;
    this.replay = replay;
    this.rewind();
    return true;
  }

  /** Back to the start line, as each generation begins. */
  rewind(): void {
    this.cursor = 0;
  }

  clear(): void {
    this.replay = null;
    this.frame = null;
    this.cursor = 0;
  }

  /** Advance by however many physics steps the world just took. */
  advance(steps: number): void {
    if (!this.replay) return;
    this.cursor = Math.min(
      this.cursor + steps / replay3DStepsPerFrame(),
      this.replay.frameCount - 1,
    );
  }

  /**
   * Where the ghost is now, or null if there is not one.
   *
   * The returned object is reused, so the renderer must not hold on to it past
   * the frame it was asked for.
   */
  current(): Ghost3DFrame | null {
    const replay = this.replay;
    if (!replay) return null;
    if (!readReplay3DFrame(replay, Math.floor(this.cursor), this.position, this.rotation)) {
      return null;
    }
    if (!this.frame) {
      this.frame = {
        def: replay.def,
        position: this.position,
        rotation: this.rotation,
        distance: 0,
        who: replay.who,
      };
    }
    this.frame.def = replay.def;
    this.frame.who = replay.who;
    // Distance along the course is enough to spin the wheels convincingly,
    // which is why no angle is recorded.
    this.frame.distance = this.position.x;
    return this.frame;
  }
}
