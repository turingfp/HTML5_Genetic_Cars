/**
 * The genome: what a car *is*, independent of any physics engine.
 *
 * Everything here is pure, with the random source passed in, so evolution can
 * be unit-tested and replayed deterministically.
 *
 * The body is deliberately more variable than the original's. There, a car was
 * an octagon with eight fixed compass directions and one evolvable distance
 * along each, carrying exactly two wheels, at one fixed density. So every car
 * in every generation had the same silhouette topology and the same weight per
 * unit of area, and the search could only ever stretch that one shape. Here a
 * corner can also swing within its own sector, a car can carry two to four
 * wheels, and the chassis has a density of its own.
 */

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_DENSITY_MIN,
  CHASSIS_DENSITY_RANGE,
  CHASSIS_VERTEX_COUNT,
  MAX_WHEEL_COUNT,
  MIN_WHEEL_COUNT,
  SPOKE_ANGLE_JITTER,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../config';
import type { Rng } from '../core/rng';
import { cloneBrain, crossoverBrain, mutateBrain, randomBrain, type Brain } from './brain';
import { mutateValue, type MutationParams } from './mutation';

export { mutateValue };
export type { MutationParams };

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * How two parents are combined.
 *
 * `two-point` is the original's: the active parent flips at two points along
 * the chassis, so a child inherits runs of adjacent corners. `uniform` decides
 * every corner independently, which mixes far harder and destroys good runs of
 * shape as readily as it finds new ones. `none` makes this asexual: children
 * are mutated clones of a single parent, which is a genuinely different search
 * and worth being able to compare against.
 */
export type CrossoverMode = 'two-point' | 'uniform' | 'none';

/** One chassis corner, in polar form. This is what actually mutates. */
export interface Spoke {
  /**
   * Where in its sector the corner sits, in [-1, 1]. Zero is the middle of the
   * sector, which is where the original always put it.
   */
  angle: number;
  /** How far out, in metres. */
  length: number;
}

export interface WheelDef {
  /** Radius in metres. */
  radius: number;
  /** Heavier wheels grip but cost torque. */
  density: number;
  /** Which chassis corner it hangs from. Distinct across a car's wheels. */
  vertex: number;
}

export interface CarDef {
  /** Between two and four wheels. */
  wheels: WheelDef[];
  /** The corners as polar genes. */
  spokes: Spoke[];
  /**
   * The same corners in cartesian form, rebuilt whenever the spokes change.
   *
   * Derived rather than evolved, and cached because the physics, the renderer
   * and the wheel mounts all want it every frame.
   */
  vertices: Vec2[];
  /** How heavy the body is for its size. */
  chassisDensity: number;
  /** The network that drives the wheels. Its weights evolve with the body. */
  brain: Brain;
}

/** Angle of the middle of sector `i`. */
const SECTOR = (Math.PI * 2) / CHASSIS_VERTEX_COUNT;

/** Half a sector, scaled by how far a corner is allowed to swing. */
const HALF_SWING = (SECTOR / 2) * SPOKE_ANGLE_JITTER;

/**
 * Rebuild the cartesian corners from the spokes.
 *
 * Corners stay in counter-clockwise order because a corner can never leave its
 * own sector, which is what keeps the fan of triangles the chassis is built
 * from convex however spiky the genome gets.
 */
export function rebuildVertices(def: CarDef): void {
  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    const spoke = def.spokes[i]!;
    const theta = i * SECTOR + spoke.angle * HALF_SWING;
    const vertex = def.vertices[i];
    const x = Math.cos(theta) * spoke.length;
    const y = Math.sin(theta) * spoke.length;
    if (vertex) {
      vertex.x = x;
      vertex.y = y;
    } else {
      def.vertices[i] = { x, y };
    }
  }
  def.vertices.length = CHASSIS_VERTEX_COUNT;
}

function randomLength(rng: Rng): number {
  return rng() * CHASSIS_AXIS_RANGE + CHASSIS_AXIS_MIN;
}

function randomVertexIndex(rng: Rng): number {
  return Math.floor(rng() * CHASSIS_VERTEX_COUNT) % CHASSIS_VERTEX_COUNT;
}

function randomWheelCount(rng: Rng): number {
  const span = MAX_WHEEL_COUNT - MIN_WHEEL_COUNT + 1;
  return MIN_WHEEL_COUNT + (Math.floor(rng() * span) % span);
}

function randomWheel(rng: Rng, vertex: number): WheelDef {
  return {
    radius: rng() * WHEEL_RADIUS_RANGE + WHEEL_RADIUS_MIN,
    density: rng() * WHEEL_DENSITY_RANGE + WHEEL_DENSITY_MIN,
    vertex,
  };
}

/** A corner no other wheel is already using, or -1 if they are all taken. */
function freeVertex(rng: Rng, taken: Set<number>): number {
  if (taken.size >= CHASSIS_VERTEX_COUNT) return -1;
  let next = randomVertexIndex(rng);
  while (taken.has(next)) next = (next + 1) % CHASSIS_VERTEX_COUNT;
  return next;
}

/**
 * Guarantee every wheel hangs from a different corner.
 *
 * Both crossover, which draws genes from two parents, and mutation can
 * otherwise stack two wheels on one point and produce a car that cannot drive.
 * The original had this bug with two wheels; with up to four there are more
 * ways to hit it.
 */
function repairWheelVertices(rng: Rng, def: CarDef): void {
  const taken = new Set<number>();
  for (const wheel of def.wheels) {
    if (!taken.has(wheel.vertex)) {
      taken.add(wheel.vertex);
      continue;
    }
    const next = freeVertex(rng, taken);
    if (next < 0) break;
    wheel.vertex = next;
    taken.add(next);
  }
}

export function randomCar(rng: Rng): CarDef {
  const spokes: Spoke[] = [];
  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    spokes.push({ angle: rng() * 2 - 1, length: randomLength(rng) });
  }

  const taken = new Set<number>();
  const wheels: WheelDef[] = [];
  for (let i = 0, count = randomWheelCount(rng); i < count; i++) {
    const vertex = freeVertex(rng, taken);
    if (vertex < 0) break;
    taken.add(vertex);
    wheels.push(randomWheel(rng, vertex));
  }

  const def: CarDef = {
    wheels,
    spokes,
    vertices: [],
    chassisDensity: rng() * CHASSIS_DENSITY_RANGE + CHASSIS_DENSITY_MIN,
    brain: randomBrain(rng),
  };
  rebuildVertices(def);
  return def;
}

export function cloneCar(def: CarDef): CarDef {
  return {
    wheels: def.wheels.map((w) => ({ radius: w.radius, density: w.density, vertex: w.vertex })),
    spokes: def.spokes.map((s) => ({ angle: s.angle, length: s.length })),
    vertices: def.vertices.map((v) => ({ x: v.x, y: v.y })),
    chassisDensity: def.chassisDensity,
    brain: cloneBrain(def.brain),
  };
}

/**
 * Two-point crossover over the chassis corners, in the original's spirit: the
 * active parent flips at each swap point, so a child inherits runs of adjacent
 * corners rather than a shuffle. Adjacent corners really do belong together,
 * since together they make a face.
 *
 * The wheels and the network do not have that neighbourhood, so they are drawn
 * independently instead.
 */
export function crossover(
  rng: Rng,
  a: CarDef,
  b: CarDef,
  mode: CrossoverMode = 'two-point',
): CarDef {
  // Asexual: a mutated clone of one parent, with no mixing at all.
  if (mode === 'none') return cloneCar(rng() < 0.5 ? a : b);

  const swap1 = Math.floor(rng() * CHASSIS_VERTEX_COUNT);
  let swap2 = swap1;
  while (swap2 === swap1) swap2 = Math.floor(rng() * CHASSIS_VERTEX_COUNT);

  const parents = [a, b];
  let current = 0;
  const spokes: Spoke[] = [];
  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    if (mode === 'uniform') current = rng() < 0.5 ? 0 : 1;
    else if (i === swap1 || i === swap2) current = current === 1 ? 0 : 1;
    const spoke = parents[current]!.spokes[i]!;
    spokes.push({ angle: spoke.angle, length: spoke.length });
  }

  // How many wheels comes from one parent or the other, then each slot is
  // filled from a parent that actually has one. A parent with fewer wheels
  // simply cannot contribute to the slots past its own count.
  const count = (rng() < 0.5 ? a : b).wheels.length;
  const wheels: WheelDef[] = [];
  for (let i = 0; i < count; i++) {
    const from = rng() < 0.5 ? a : b;
    const source = from.wheels[i] ?? a.wheels[i] ?? b.wheels[i];
    if (!source) break;
    wheels.push({ radius: source.radius, density: source.density, vertex: source.vertex });
  }

  const child: CarDef = {
    wheels,
    spokes,
    vertices: [],
    chassisDensity: (rng() < 0.5 ? a : b).chassisDensity,
    brain: crossoverBrain(rng, a.brain, b.brain),
  };
  repairWheelVertices(rng, child);
  rebuildVertices(child);
  return child;
}

/**
 * How different two cars are, roughly normalised so that 1 is a substantial
 * difference and 0 is identical.
 *
 * Used for the diversity pressure in `evolution.ts`, which needs to know how
 * crowded a car's corner of the search space is. The driver's weights are left
 * out deliberately: there are 94 of them against a handful of body genes, so
 * including them would drown out every difference in shape, and it is the
 * shapes that are worth keeping varied.
 */
export function genomeDistance(a: CarDef, b: CarDef): number {
  let sum = 0;
  let terms = 0;

  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    const sa = a.spokes[i]!;
    const sb = b.spokes[i]!;
    const dl = (sa.length - sb.length) / CHASSIS_AXIS_RANGE;
    // Angles already span [-1, 1], so half their difference is a fraction.
    const da = (sa.angle - sb.angle) / 2;
    sum += dl * dl + da * da;
    terms += 2;
  }

  const dw = (a.wheels.length - b.wheels.length) / (MAX_WHEEL_COUNT - MIN_WHEEL_COUNT || 1);
  const dd = (a.chassisDensity - b.chassisDensity) / CHASSIS_DENSITY_RANGE;
  // Wheel count is structural, so it is worth more than any single corner.
  sum += dw * dw * 4 + dd * dd;
  terms += 5;

  const shared = Math.min(a.wheels.length, b.wheels.length);
  for (let i = 0; i < shared; i++) {
    const dr = (a.wheels[i]!.radius - b.wheels[i]!.radius) / WHEEL_RADIUS_RANGE;
    const dn = (a.wheels[i]!.density - b.wheels[i]!.density) / WHEEL_DENSITY_RANGE;
    sum += dr * dr + dn * dn;
    terms += 2;
  }

  return Math.sqrt(sum / terms);
}

/** Mutate a genome in place and return it. */
export function mutate(rng: Rng, def: CarDef, params: MutationParams): CarDef {
  const { rate, size } = params;

  for (const spoke of def.spokes) {
    if (rng() < rate) spoke.length = mutateValue(rng, spoke.length, CHASSIS_AXIS_MIN, CHASSIS_AXIS_RANGE, size);
    if (rng() < rate) spoke.angle = mutateValue(rng, spoke.angle, -1, 2, size);
  }

  if (rng() < rate) {
    def.chassisDensity = mutateValue(
      rng,
      def.chassisDensity,
      CHASSIS_DENSITY_MIN,
      CHASSIS_DENSITY_RANGE,
      size,
    );
  }

  // Gaining or losing a wheel changes the car more than any other single
  // mutation, so like wheel placement it is throttled by the mutation size as
  // well as the rate. That was the original's trick for a "many small
  // mutations" mode, and it matters more now that there is something
  // structural to change.
  const structuralRate = Math.min(size, rate);
  if (rng() < structuralRate) {
    const taken = new Set(def.wheels.map((w) => w.vertex));
    if (rng() < 0.5 && def.wheels.length > MIN_WHEEL_COUNT) {
      def.wheels.splice(Math.floor(rng() * def.wheels.length), 1);
    } else if (def.wheels.length < MAX_WHEEL_COUNT) {
      const vertex = freeVertex(rng, taken);
      if (vertex >= 0) def.wheels.push(randomWheel(rng, vertex));
    }
  }

  for (const wheel of def.wheels) {
    if (rng() < rate) {
      wheel.radius = mutateValue(rng, wheel.radius, WHEEL_RADIUS_MIN, WHEEL_RADIUS_RANGE, size);
    }
    if (rng() < rate) {
      wheel.density = mutateValue(rng, wheel.density, WHEEL_DENSITY_MIN, WHEEL_DENSITY_RANGE, size);
    }
    if (rng() < structuralRate) {
      const taken = new Set(def.wheels.filter((w) => w !== wheel).map((w) => w.vertex));
      const next = freeVertex(rng, taken);
      if (next >= 0) wheel.vertex = next;
    }
  }

  mutateBrain(rng, def.brain, params);
  repairWheelVertices(rng, def);
  rebuildVertices(def);
  return def;
}
