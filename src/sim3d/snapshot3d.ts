/**
 * The 3D view model.
 *
 * Kept apart from the simulation so the application can hold snapshots without
 * importing Box3D — the engine is only fetched when someone switches to 3D.
 */

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
}

export interface World3DSnapshot {
  frame: number;
  generation: number;
  aliveCount: number;
  leaderIndex: number;
  leader: Vec3;
  bestX: number;
  cars: Car3DSnapshot[];
}

export function emptyPose3D(): Pose3D {
  return { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
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
  };
}
