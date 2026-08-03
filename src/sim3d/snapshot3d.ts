/**
 * The 3D view model.
 *
 * Kept apart from the simulation so the application can hold snapshots without
 * importing Box3D, which is only fetched when someone switches to 3D.
 */

import { BRAIN_NODE_COUNT, BRAIN_RECURRENT } from '../ga/brain';
import type { Car3DDef } from '../ga/genome3d';
import type { Quat, Vec3 } from './box3d';

export interface Pose3D {
  position: Vec3;
  rotation: Quat;
}

export interface Car3DSnapshot {
  alive: boolean;
  isElite: boolean;
  index: number;
  def: Car3DDef | null;
  chassis: Pose3D;
  wheels: Pose3D[];
  health01: number;
  maxX: number;
  /** This car's network as it last fired. Copied, so it is safe to hold on to. */
  activations: Float32Array;
  /** What its hidden layer is carrying into the next step. */
  memory: Float32Array;
  /** Which founding line this car descends from. */
  lineage: number;
}

export interface World3DSnapshot {
  frame: number;
  generation: number;
  aliveCount: number;
  leaderIndex: number;
  leader: Vec3;
  bestX: number;
  cars: Car3DSnapshot[];
  /**
   * Where every crate is now.
   *
   * Poses only. The renderer builds one box mesh and reuses it, so it needs
   * positions per frame and nothing else. Reused objects, like the car poses,
   * so a frame allocates nothing.
   */
  crates: Pose3D[];
}

export function emptyPose3D(): Pose3D {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
}

export function emptyActivations(): Float32Array {
  return new Float32Array(BRAIN_NODE_COUNT);
}

export function emptyMemory(): Float32Array {
  return new Float32Array(BRAIN_RECURRENT);
}

export function createSnapshot3D(): World3DSnapshot {
  return {
    frame: 0,
    generation: 0,
    aliveCount: 0,
    leaderIndex: -1,
    leader: { x: 0, y: 0, z: 0 },
    bestX: 0,
    cars: [],
    crates: [],
  };
}
