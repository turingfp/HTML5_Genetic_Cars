/**
 * The 3D genome.
 *
 * A 3D car is the 2D silhouette given a width: the chassis is that outline
 * extruded along z into a convex hull, and each wheel becomes a pair mounted
 * on either side. So a car evolved in 2D is still a valid car here, and the
 * shared genes keep the same meaning.
 *
 * The two new genes are what make 3D interesting: a narrow, tall car is fast
 * but rolls on banked ground, and a wide one is stable but heavy.
 */

import {
  CHASSIS_HALF_WIDTH_MIN,
  CHASSIS_HALF_WIDTH_RANGE,
  WHEEL_GAP_MIN,
  WHEEL_GAP_RANGE,
} from '../config';
import type { Rng } from '../core/rng';
import {
  cloneCar,
  crossover,
  genomeDistance,
  mutate,
  mutateValue,
  randomCar,
  type CarDef,
  type CrossoverMode,
  type MutationParams,
} from './genome';
import type { GenomeOps } from './evolution';

export interface Car3DDef {
  /** The x-y silhouette, wheel radii, densities and mounting points. */
  base: CarDef;
  /** Half the chassis width along z. */
  halfWidth: number;
  /** How far each wheel sits outboard of the chassis side. */
  wheelGap: number;
}

export function randomCar3D(rng: Rng): Car3DDef {
  return {
    base: randomCar(rng),
    halfWidth: rng() * CHASSIS_HALF_WIDTH_RANGE + CHASSIS_HALF_WIDTH_MIN,
    wheelGap: rng() * WHEEL_GAP_RANGE + WHEEL_GAP_MIN,
  };
}

export function cloneCar3D(def: Car3DDef): Car3DDef {
  return { base: cloneCar(def.base), halfWidth: def.halfWidth, wheelGap: def.wheelGap };
}

export function crossover3D(
  rng: Rng,
  a: Car3DDef,
  b: Car3DDef,
  mode: CrossoverMode = 'two-point',
): Car3DDef {
  if (mode === 'none') return cloneCar3D(rng() < 0.5 ? a : b);
  return {
    base: crossover(rng, a.base, b.base, mode),
    // The two width genes are inherited independently of the silhouette.
    halfWidth: rng() < 0.5 ? a.halfWidth : b.halfWidth,
    wheelGap: rng() < 0.5 ? a.wheelGap : b.wheelGap,
  };
}

export function mutate3D(rng: Rng, def: Car3DDef, params: MutationParams): Car3DDef {
  mutate(rng, def.base, params);
  if (rng() < params.rate) {
    def.halfWidth = mutateValue(
      rng,
      def.halfWidth,
      CHASSIS_HALF_WIDTH_MIN,
      CHASSIS_HALF_WIDTH_RANGE,
      params.size,
    );
  }
  if (rng() < params.rate) {
    def.wheelGap = mutateValue(rng, def.wheelGap, WHEEL_GAP_MIN, WHEEL_GAP_RANGE, params.size);
  }
  return def;
}

/** As `genomeDistance`, plus the two genes that only exist in three dimensions. */
export function genomeDistance3D(a: Car3DDef, b: Car3DDef): number {
  const body = genomeDistance(a.base, b.base);
  const dw = (a.halfWidth - b.halfWidth) / CHASSIS_HALF_WIDTH_RANGE;
  const dg = (a.wheelGap - b.wheelGap) / WHEEL_GAP_RANGE;
  // Averaged in as two more terms alongside the silhouette's.
  return Math.sqrt((body * body * 21 + dw * dw + dg * dg) / 23);
}

export const car3DOps: GenomeOps<Car3DDef> = {
  random: randomCar3D,
  crossover: crossover3D,
  mutate: mutate3D,
  clone: cloneCar3D,
  distance: genomeDistance3D,
};

/** The chassis hull: the silhouette mirrored to both sides. */
export function chassisHullPoints(def: Car3DDef): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  for (const v of def.base.vertices) {
    points.push({ x: v.x, y: v.y, z: -def.halfWidth });
    points.push({ x: v.x, y: v.y, z: def.halfWidth });
  }
  return points;
}

/**
 * Where each wheel sits, in chassis-local space. Every wheel of the silhouette
 * becomes a mirrored pair, so a two wheeler has four and a four wheeler eight.
 */
export function wheelMounts(def: Car3DDef): { x: number; y: number; z: number; wheel: number }[] {
  const mounts: { x: number; y: number; z: number; wheel: number }[] = [];
  const z = def.halfWidth + def.wheelGap;
  for (let wheel = 0; wheel < def.base.wheels.length; wheel++) {
    const v = def.base.vertices[def.base.wheels[wheel]!.vertex]!;
    mounts.push({ x: v.x, y: v.y, z: -z, wheel });
    mounts.push({ x: v.x, y: v.y, z, wheel });
  }
  return mounts;
}
