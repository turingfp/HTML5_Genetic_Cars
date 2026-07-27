/**
 * The genome: what a car *is*, independent of any physics engine.
 *
 * Everything here is pure — the random source is passed in — so evolution can
 * be unit-tested and replayed deterministically.
 */

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_VERTEX_COUNT,
  GENE_COUNT,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../config';
import type { Rng } from '../core/rng';

export interface Vec2 {
  x: number;
  y: number;
}

export interface CarDef {
  /** Radius of each wheel, in metres. */
  wheelRadius: [number, number];
  /** Density of each wheel; heavier wheels grip but cost torque. */
  wheelDensity: [number, number];
  /** Which chassis vertex each wheel hangs from. Always distinct. */
  wheelVertex: [number, number];
  /** Eight chassis corners, one per octant, in counter-clockwise order. */
  vertices: Vec2[];
}

export interface MutationParams {
  /** Probability that any single gene mutates. */
  rate: number;
  /** Mutation window width as a fraction of the gene's full range. */
  size: number;
}

/**
 * Sign of each octant vertex. Index 0 points along +x and they proceed
 * counter-clockwise; zeroed components stay pinned to the axis.
 */
const OCTANT: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** One chassis axis length, drawn from [CHASSIS_AXIS_MIN, +RANGE). */
function randomAxis(rng: Rng): number {
  return rng() * CHASSIS_AXIS_RANGE + CHASSIS_AXIS_MIN;
}

function randomVertexIndex(rng: Rng): number {
  return Math.floor(rng() * CHASSIS_VERTEX_COUNT) % CHASSIS_VERTEX_COUNT;
}

/**
 * Guarantee the two wheels hang from different vertices.
 *
 * Both crossover (genes drawn from different parents) and mutation can
 * otherwise stack both wheels on one point, producing a unicycle that can
 * never drive. The original had this bug; cars born into it were wasted slots.
 */
function repairWheelVertices(rng: Rng, def: CarDef): void {
  if (def.wheelVertex[0] !== def.wheelVertex[1]) return;
  let next = randomVertexIndex(rng);
  while (next === def.wheelVertex[0]) next = randomVertexIndex(rng);
  def.wheelVertex[1] = next;
}

export function randomCar(rng: Rng): CarDef {
  const vertices: Vec2[] = OCTANT.map(([sx, sy]) => ({
    x: sx === 0 ? 0 : sx * randomAxis(rng),
    y: sy === 0 ? 0 : sy * randomAxis(rng),
  }));

  const wheelVertex1 = randomVertexIndex(rng);
  let wheelVertex2 = wheelVertex1;
  while (wheelVertex2 === wheelVertex1) wheelVertex2 = randomVertexIndex(rng);

  return {
    wheelRadius: [
      rng() * WHEEL_RADIUS_RANGE + WHEEL_RADIUS_MIN,
      rng() * WHEEL_RADIUS_RANGE + WHEEL_RADIUS_MIN,
    ],
    wheelDensity: [
      rng() * WHEEL_DENSITY_RANGE + WHEEL_DENSITY_MIN,
      rng() * WHEEL_DENSITY_RANGE + WHEEL_DENSITY_MIN,
    ],
    wheelVertex: [wheelVertex1, wheelVertex2],
    vertices,
  };
}

export function cloneCar(def: CarDef): CarDef {
  return {
    wheelRadius: [def.wheelRadius[0], def.wheelRadius[1]],
    wheelDensity: [def.wheelDensity[0], def.wheelDensity[1]],
    wheelVertex: [def.wheelVertex[0], def.wheelVertex[1]],
    vertices: def.vertices.map((v) => ({ x: v.x, y: v.y })),
  };
}

/**
 * Two-point crossover over the 14 genes, in the original's gene order:
 * wheel radii, wheel attachment points, the eight chassis axes, wheel
 * densities. The active parent flips at each swap point.
 */
export function crossover(rng: Rng, a: CarDef, b: CarDef): CarDef {
  const swap1 = Math.round(rng() * (GENE_COUNT - 1));
  let swap2 = swap1;
  while (swap2 === swap1) swap2 = Math.round(rng() * (GENE_COUNT - 1));

  const parents = [a, b];
  let current = 0;
  /** Advance to gene `i`, flipping parents when a swap point is crossed. */
  const pick = (i: number): CarDef => {
    if (i === swap1 || i === swap2) current = current === 1 ? 0 : 1;
    return parents[current]!;
  };

  const wheelRadius: [number, number] = [pick(0).wheelRadius[0], pick(1).wheelRadius[1]];
  const wheelVertex: [number, number] = [pick(2).wheelVertex[0], pick(3).wheelVertex[1]];
  const vertices: Vec2[] = [];
  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    const v = pick(4 + i).vertices[i]!;
    vertices.push({ x: v.x, y: v.y });
  }
  const wheelDensity: [number, number] = [pick(12).wheelDensity[0], pick(13).wheelDensity[1]];

  const child: CarDef = { wheelRadius, wheelDensity, wheelVertex, vertices };
  repairWheelVertices(rng, child);
  return child;
}

/**
 * Nudge a value within a window of `range * size` centred on the old value,
 * clamped so the result stays inside [min, min + range).
 *
 * At size = 1 the window covers the whole range, which is why the default
 * "mutation size" of 100% behaves like a random re-roll.
 */
function mutateValue(rng: Rng, old: number, min: number, range: number, size: number): number {
  const span = range * size;
  let base = old - 0.5 * span;
  if (base < min) base = min;
  if (base > min + (range - span)) base = min + (range - span);
  return base + span * rng();
}

/** Mutate one chassis vertex, preserving its octant's sign convention. */
function mutateVertex(rng: Rng, def: CarDef, index: number, rate: number, size: number): void {
  if (rng() >= rate) return;
  const [sx, sy] = OCTANT[index]!;
  const v = def.vertices[index]!;
  def.vertices[index] = {
    x: sx === 0 ? 0 : sx * mutateValue(rng, sx * v.x, CHASSIS_AXIS_MIN, CHASSIS_AXIS_RANGE, size),
    y: sy === 0 ? 0 : sy * mutateValue(rng, sy * v.y, CHASSIS_AXIS_MIN, CHASSIS_AXIS_RANGE, size),
  };
}

/** Mutate a genome in place and return it. */
export function mutate(rng: Rng, def: CarDef, params: MutationParams): CarDef {
  const { rate, size } = params;

  for (const i of [0, 1] as const) {
    if (rng() < rate) {
      def.wheelRadius[i] = mutateValue(
        rng,
        def.wheelRadius[i],
        WHEEL_RADIUS_MIN,
        WHEEL_RADIUS_RANGE,
        size,
      );
    }
  }

  // Wheel placement is disruptive, so a small mutation size also throttles how
  // often it happens — the original's trick for "many small mutations" mode.
  const placementRate = Math.min(size, rate);
  for (const i of [0, 1] as const) {
    if (rng() < placementRate) {
      // Unlike the original, keep the wheels on distinct vertices; two wheels
      // sharing a vertex produces a degenerate car that can never drive.
      const other = def.wheelVertex[i === 0 ? 1 : 0];
      let next = randomVertexIndex(rng);
      while (next === other) next = randomVertexIndex(rng);
      def.wheelVertex[i] = next;
    }
  }

  for (const i of [0, 1] as const) {
    if (rng() < rate) {
      def.wheelDensity[i] = mutateValue(
        rng,
        def.wheelDensity[i],
        WHEEL_DENSITY_MIN,
        WHEEL_DENSITY_RANGE,
        size,
      );
    }
  }

  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    mutateVertex(rng, def, i, rate, size);
  }

  return def;
}
