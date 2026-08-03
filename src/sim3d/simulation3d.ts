/**
 * The 3D simulation.
 *
 * Mirrors the flat mode's shape (one world, one generation, a snapshot for
 * the renderer) but on Box3D, with a road that banks and cars that can roll
 * off it.
 */

import {
  DEFAULT_DIVERSITY_PRESSURE,
  DEFAULT_ELITE_COUNT,
  DEFAULT_IMMIGRANTS,
  DEFAULT_MUTATION_RATE,
  DEFAULT_MUTATION_SIZE,
  DEFAULT_POPULATION_SIZE,
  GRAVITY_Y,
  MAX_GENERATION_FRAMES,
  PROGRESS_EPSILON,
  STALL_FRAMES,
  MAX_CAR_HEALTH,
  ROAD_THICKNESS,
  SUB_STEP_COUNT,
  TILE_FRICTION,
  TIME_STEP,
} from '../config';
import { randomSeed, rngFromSeed, type Rng } from '../core/rng';
import {
  DEFAULT_CROSSOVER,
  DEFAULT_GOAL,
  DEFAULT_SELECTION,
  fitnessOf,
  nextGeneration,
  randomPopulation,
  type CarEntry,
  type CarScore,
  type GAParams,
} from '../ga/evolution';
import { car3DOps, type Car3DDef } from '../ga/genome3d';
import { slopeProbes, surfaceIndexAt, type SlopeProbes } from '../sim/track';
import { generateTrack3D, roadCrossSections, type Track3D } from './track3d';
import { Car3D } from './car3d';
import type { Box3DBody, Box3DWorld, Vec3 } from './box3d';
import { loadBox3D } from './box3d';
import {
  emptyActivations,
  emptyMemory,
  emptyPose3D,
  type Pose3D,
  type World3DSnapshot,
} from './snapshot3d';

export { createSnapshot3D } from './snapshot3d';
export type { Car3DSnapshot, Pose3D, World3DSnapshot } from './snapshot3d';

export interface Simulation3DOptions {
  trackSeed?: string;
  runSeed?: string;
  params?: Partial<GAParams>;
}

export class Simulation3D {
  world: Box3DWorld;
  track: Track3D;
  params: GAParams;

  cars: Car3D[] = [];
  generation = 0;
  frame = 0;
  aliveCount = 0;
  bestX = 0;

  /** Frame at which the furthest point reached last moved meaningfully. */
  private lastProgressFrame = 0;

  /** Next unused founding line number, so lineages stay unique across a run. */
  private nextLineage = 0;

  /** Reused terrain lookahead, so stepping allocates nothing. */
  private readonly probes: SlopeProbes = { near: 0, mid: 0, far: 0 };

  private scores: CarScore<Car3DDef>[] = [];
  private roadBodies: Box3DBody[] = [];
  private rng: Rng;

  onCarDeath: ((car: Car3D) => void) | null = null;
  onGenerationEnd: ((scores: CarScore<Car3DDef>[], generation: number) => void) | null = null;

  /** Box3D has to compile its WebAssembly before a world can exist. */
  static async create(options: Simulation3DOptions = {}): Promise<Simulation3D> {
    const module = await loadBox3D();
    return new Simulation3D(module.World, options);
  }

  private constructor(
    WorldClass: new (options: { gravity: Vec3 }) => Box3DWorld,
    options: Simulation3DOptions,
  ) {
    this.rng = rngFromSeed(options.runSeed ?? randomSeed());
    this.params = {
      populationSize: DEFAULT_POPULATION_SIZE,
      mutationRate: DEFAULT_MUTATION_RATE,
      mutationSize: DEFAULT_MUTATION_SIZE,
      eliteCount: DEFAULT_ELITE_COUNT,
      selection: DEFAULT_SELECTION,
      crossoverMode: DEFAULT_CROSSOVER,
      goal: DEFAULT_GOAL,
      diversityPressure: DEFAULT_DIVERSITY_PRESSURE,
      immigrants: DEFAULT_IMMIGRANTS,
      ...options.params,
    };

    this.world = new WorldClass({ gravity: { x: 0, y: GRAVITY_Y, z: 0 } });
    this.track = generateTrack3D(options.trackSeed ?? randomSeed());
    this.buildRoad();
    this.spawn(randomPopulation(this.rng, this.params.populationSize, car3DOps));
  }

  get trackSeed(): string {
    return this.track.seed;
  }

  /**
   * One collider per segment, shaped from the same cross-sections the renderer
   * draws.
   *
   * Boxes were used at first, each taking the average of the banks at the two
   * joints it spans. That put the physical surface as much as 1.7 metres from
   * the visible one at the road edges, so cars struck invisible seams and sank
   * into the drawn road. Building both from `roadCrossSections` means they
   * cannot drift apart.
   */
  private buildRoad(): void {
    for (const body of this.roadBodies) body.destroy();
    this.roadBodies = [];

    const sections = roadCrossSections(this.track);

    for (let k = 0; k + 1 < sections.length; k++) {
      const a = sections[k]!;
      const b = sections[k + 1]!;
      const center = {
        x: (a.left[0] + a.right[0] + b.left[0] + b.right[0]) / 4,
        y: (a.left[1] + a.right[1] + b.left[1] + b.right[1]) / 4,
        z: (a.left[2] + a.right[2] + b.left[2] + b.right[2]) / 4,
      };

      // The surface, plus the same four points pushed down along the normal to
      // give the slab thickness. Hull points are relative to the body's origin.
      const points: { x: number; y: number; z: number }[] = [];
      for (const section of [a, b]) {
        for (const edge of [section.left, section.right]) {
          points.push({
            x: edge[0] - center.x,
            y: edge[1] - center.y,
            z: edge[2] - center.z,
          });
          points.push({
            x: edge[0] - section.up[0] * ROAD_THICKNESS - center.x,
            y: edge[1] - section.up[1] * ROAD_THICKNESS - center.y,
            z: edge[2] - section.up[2] * ROAD_THICKNESS - center.z,
          });
        }
      }

      const body = this.world.createBody({ type: 'static', position: center });
      body.createHull({ points, friction: TILE_FRICTION });
      this.roadBodies.push(body);
    }
  }

  /** Height of the road under a given x, used for the fell-off check. */
  private roadHeightAt(x: number): number {
    const surface = this.track.profile.surface;
    const i = Math.min(surfaceIndexAt(this.track.profile, x), surface.length - 1);
    return surface[i]!.y;
  }

  private spawn(entries: CarEntry<Car3DDef>[]): void {
    this.cars = entries.map((e) => new Car3D(this.world, e.def, e.index, e.isElite, e.lineage));
    this.nextLineage = Math.max(this.nextLineage, ...entries.map((e) => e.lineage + 1));
    this.aliveCount = this.cars.length;
    this.scores = [];
    this.frame = 0;
    this.bestX = 0;
    this.lastProgressFrame = 0;
  }

  /** Advance one fixed step. Returns true if the generation ended. */
  step(): boolean {
    // Drivers act first on what they saw last step, then the world moves.
    for (const car of this.cars) {
      if (!car.alive || !car.chassis) continue;
      slopeProbes(this.track.profile, car.chassis.getPosition().x, this.probes);
      car.drive(this.probes);
    }

    this.world.step(TIME_STEP, SUB_STEP_COUNT);
    this.frame++;

    for (const car of this.cars) {
      if (!car.alive) continue;
      const died = car.update(this.roadHeightAt(car.maxX));
      if (car.maxX > this.bestX + PROGRESS_EPSILON) {
        this.bestX = car.maxX;
        this.lastProgressFrame = this.frame;
      } else if (car.maxX > this.bestX) {
        this.bestX = car.maxX;
      }
      if (died) this.killCar(car);
    }

    // Retire the survivors once the round is over in all but name, as the flat
    // mode does: the frontier has stopped advancing, or the hard cap is hit.
    const stalled = this.frame - this.lastProgressFrame >= STALL_FRAMES;
    if (stalled || this.frame >= MAX_GENERATION_FRAMES) {
      for (const car of this.cars) {
        if (car.alive) this.killCar(car);
      }
    }

    if (this.aliveCount <= 0) {
      this.endGeneration();
      return true;
    }
    return false;
  }

  private killCar(car: Car3D): void {
    // Capture the road height first: a car that went over the edge is far below
    // the surface, and a marker floating in the void says less than one sitting
    // where along the course it came to grief.
    car.deathRoadY = this.roadHeightAt(car.maxX);
    const run = {
      distance: car.maxX,
      avgSpeed: car.avgSpeed,
      maxY: car.maxY,
      minY: car.minY,
      mass: car.mass,
    };
    car.destroy();
    this.aliveCount--;
    this.scores.push({
      def: car.def,
      score: fitnessOf(run, this.params.goal),
      avgSpeed: run.avgSpeed,
      distance: run.distance,
      maxY: run.maxY,
      minY: run.minY,
      mass: run.mass,
      isElite: car.isElite,
      lineage: car.lineage,
    });
    this.onCarDeath?.(car);
  }

  private endGeneration(): void {
    const finished = this.scores;
    this.onGenerationEnd?.(finished, this.generation);
    this.generation++;
    this.spawn(nextGeneration(finished, this.params, this.rng, car3DOps, this.nextLineage));
  }

  resetPopulation(): void {
    this.clearCars();
    this.generation = 0;
    this.nextLineage = 0;
    this.spawn(randomPopulation(this.rng, this.params.populationSize, car3DOps));
  }

  setTrack(seed: string): void {
    this.clearCars();
    this.track = generateTrack3D(seed);
    this.buildRoad();
    this.generation = 0;
    this.nextLineage = 0;
    this.spawn(randomPopulation(this.rng, this.params.populationSize, car3DOps));
  }

  private clearCars(): void {
    for (const car of this.cars) {
      if (car.alive) car.destroy();
    }
    this.cars = [];
  }

  /** Release the WebAssembly world when switching away from 3D. */
  dispose(): void {
    this.clearCars();
    this.roadBodies = [];
    this.world.destroy();
  }

  snapshot(out: World3DSnapshot): void {
    while (out.cars.length < this.cars.length) {
      out.cars.push({
        alive: false,
        isElite: false,
        index: out.cars.length,
        def: null,
        chassis: emptyPose3D(),
        wheels: [emptyPose3D(), emptyPose3D(), emptyPose3D(), emptyPose3D()],
        health01: 0,
        maxX: 0,
        activations: emptyActivations(),
        memory: emptyMemory(),
        lineage: 0,
      });
    }
    out.cars.length = this.cars.length;

    out.frame = this.frame;
    out.generation = this.generation;
    out.aliveCount = this.aliveCount;
    out.bestX = this.bestX;

    let leaderIndex = -1;
    let leaderX = -Infinity;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      const snap = out.cars[i]!;
      snap.index = car.index;
      snap.def = car.def;
      snap.isElite = car.isElite;
      snap.alive = car.alive;
      snap.lineage = car.lineage;
      snap.health01 = Math.max(0, car.health) / MAX_CAR_HEALTH;
      snap.maxX = car.maxX;
      snap.activations.set(car.brain.activations);
      snap.memory.set(car.brain.memory);

      if (!car.alive || !car.chassis) continue;

      // Copy values out: the engine hands back live vectors.
      copyPose(car.chassis, snap.chassis);
      while (snap.wheels.length < car.wheels.length) snap.wheels.push(emptyPose3D());
      snap.wheels.length = car.wheels.length;
      for (let w = 0; w < car.wheels.length; w++) {
        copyPose(car.wheels[w]!, snap.wheels[w]!);
      }

      if (snap.chassis.position.x > leaderX) {
        leaderX = snap.chassis.position.x;
        leaderIndex = i;
        out.leader.x = snap.chassis.position.x;
        out.leader.y = snap.chassis.position.y;
        out.leader.z = snap.chassis.position.z;
      }
    }

    out.leaderIndex = leaderIndex;
  }
}

function copyPose(body: Box3DBody, pose: Pose3D): void {
  const p = body.getPosition();
  pose.position.x = p.x;
  pose.position.y = p.y;
  pose.position.z = p.z;
  const r = body.getRotation();
  pose.rotation.x = r.x;
  pose.rotation.y = r.y;
  pose.rotation.z = r.z;
  pose.rotation.w = r.w;
}
