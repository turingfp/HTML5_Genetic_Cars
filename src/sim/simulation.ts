/**
 * The simulation: one planck world, one generation of cars, and the rules that
 * decide when a generation is over.
 *
 * Nothing here touches the DOM. Presentation reads state through `snapshot()`,
 * which fills a caller-owned buffer, so drawing costs no allocations and the
 * renderer never sees a physics object.
 */

import { Box, Vec2, World, type Body } from 'planck';

import {
  DEFAULT_DIVERSITY_PRESSURE,
  DEFAULT_ELITE_COUNT,
  DEFAULT_IMMIGRANTS,
  DEFAULT_MIGRANTS,
  DEFAULT_MUTATION_RATE,
  DEFAULT_MUTATION_SIZE,
  DEFAULT_POPULATION_SIZE,
  GRAVITY_Y,
  MAX_GENERATION_FRAMES,
  PROGRESS_EPSILON,
  STALL_FRAMES,
  MAX_CAR_HEALTH,
  POSITION_ITERATIONS,
  TILE_FRICTION,
  TILE_HEIGHT,
  TILE_WIDTH,
  TIME_STEP,
  VELOCITY_ITERATIONS,
} from '../config';
import { BRAIN_NODE_COUNT, BRAIN_RECURRENT } from '../ga/brain';
import {
  DEFAULT_CROSSOVER,
  DEFAULT_GOAL,
  DEFAULT_SEARCH,
  DEFAULT_SELECTION,
  fitnessOf,
  nextGeneration,
  randomPopulation,
  type CarEntry,
  type CarScore,
  type GAParams,
} from '../ga/evolution';
import { describeCar, EliteArchive } from '../ga/archive';
import { cloneCar, type CarDef } from '../ga/genome';
import { randomSeed, rngFromSeed, type Rng } from '../core/rng';
import { ReplayRecorder, type Pose } from '../replay/recorder';
import {
  generateTrack,
  generateTrackFromSpec,
  slopeProbes,
  type SlopeProbes,
  type TrackDef,
} from './track';
import { defaultSpec, type TrackSpec } from '../track/spec';
import { Car } from './car';

export interface CarSnapshot {
  alive: boolean;
  isElite: boolean;
  index: number;
  /** The genome, so the renderer can build geometry without the physics world. */
  def: CarDef | null;
  chassis: Pose;
  wheels: Pose[];
  /** Remaining health in [0, 1]. */
  health01: number;
  maxX: number;
  /** This car's network as it last fired. Copied, so it is safe to hold on to. */
  activations: Float32Array;
  /** What its hidden layer is carrying into the next step. */
  memory: Float32Array;
  /** Which founding line this car descends from. */
  lineage: number;
}

export interface WorldSnapshot {
  frame: number;
  generation: number;
  aliveCount: number;
  /** Index of the furthest living car, or -1 when none are alive. */
  leaderIndex: number;
  leaderX: number;
  leaderY: number;
  /** Furthest any car has reached this generation. */
  bestX: number;
  cars: CarSnapshot[];
}

export interface SimulationOptions {
  trackSeed?: string;
  runSeed?: string;
  params?: Partial<GAParams>;
}

function emptyPose(): Pose {
  return { x: 0, y: 0, angle: 0 };
}

export function createSnapshot(): WorldSnapshot {
  return {
    frame: 0,
    generation: 0,
    aliveCount: 0,
    leaderIndex: -1,
    leaderX: 0,
    leaderY: 0,
    bestX: 0,
    cars: [],
  };
}

export class Simulation {
  world: World;
  track: TrackDef;
  params: GAParams;

  cars: Car[] = [];
  recorders: ReplayRecorder[] = [];
  generation = 0;
  frame = 0;
  aliveCount = 0;
  bestX = 0;

  /** Frame at which the furthest point reached last moved meaningfully. */
  private lastProgressFrame = 0;

  /** Reused terrain lookahead, so stepping allocates nothing. */
  private readonly probes: SlopeProbes = { near: 0, mid: 0, far: 0 };

  /** Next unused founding line number, so lineages stay unique across a run. */
  private nextLineage = 0;

  /** Scratch poses handed to the recorders, so recording allocates nothing. */
  private readonly chassisPose: Pose = { x: 0, y: 0, angle: 0 };
  private readonly posePool: Pose[] = [];

  /** Scores of cars that have already died this generation. */
  private scores: CarScore[] = [];
  private trackBodies: Body[] = [];
  private rng: Rng;
  private runSeed: string;

  onCarDeath: ((car: Car) => void) | null = null;

  /**
   * Cars a person built by hand, waiting for a place in the next generation.
   *
   * Kept apart from migrants because it must not depend on a setting: someone
   * who presses "race this car" has said exactly what they want, and finding
   * that it silently did nothing because a slider was at zero would be absurd.
   */
  private pending: CarDef[] = [];

  /** Put a hand-built car into the next generation. */
  enqueue(def: CarDef): void {
    // A small cap, so holding the button cannot crowd out the population.
    if (this.pending.length < 8) this.pending.push(def);
  }

  /**
   * Give each queued car a slot, taking the weakest non-elite places.
   *
   * Placed among the ordinary children so a hand-built car competes on the
   * same terms as everything else, and given a lineage of its own, since it
   * descends from nothing in this run.
   */
  private placePending(entries: CarEntry[], elites: number): void {
    if (this.pending.length === 0) return;
    let slot = entries.length - 1;
    for (const def of this.pending.splice(0)) {
      if (slot < elites || slot < 0) break;
      entries[slot] = { def, index: slot, isElite: false, lineage: this.nextLineage++ };
      slot--;
    }
  }

  /**
   * Where migrant cars come from, when a room is connected.
   *
   * A function rather than a reference to the room, so the simulation knows
   * nothing about networking and the island model can be tested offline.
   */
  migrantSource: (() => CarDef | null) | null = null;

  /** Best car of every body shape this session. See the 3D twin for why. */
  readonly archive = new EliteArchive<CarDef>(describeCar, cloneCar);
  onGenerationEnd: ((scores: CarScore[], generation: number) => void) | null = null;

  constructor(options: SimulationOptions = {}) {
    const trackSeed = options.trackSeed ?? randomSeed();
    this.runSeed = options.runSeed ?? randomSeed();
    this.rng = rngFromSeed(this.runSeed);

    this.params = {
      populationSize: DEFAULT_POPULATION_SIZE,
      mutationRate: DEFAULT_MUTATION_RATE,
      mutationSize: DEFAULT_MUTATION_SIZE,
      eliteCount: DEFAULT_ELITE_COUNT,
      selection: DEFAULT_SELECTION,
      search: DEFAULT_SEARCH,
      crossoverMode: DEFAULT_CROSSOVER,
      goal: DEFAULT_GOAL,
      diversityPressure: DEFAULT_DIVERSITY_PRESSURE,
      immigrants: DEFAULT_IMMIGRANTS,
      migrants: DEFAULT_MIGRANTS,
      ...options.params,
    };

    this.world = new World({ gravity: new Vec2(0, GRAVITY_Y) });
    this.track = generateTrack(trackSeed);
    this.buildTrackBodies();
    this.spawn(randomPopulation(this.rng, this.params.populationSize));
  }

  get trackSeed(): string {
    return this.track.seed;
  }

  private buildTrackBodies(): void {
    for (const body of this.trackBodies) this.world.destroyBody(body);
    this.trackBodies = [];

    for (const tile of this.track.tiles) {
      // A gap keeps its geometry so every lookup along the surface still
      // works, but there is deliberately nothing here to drive on.
      if (!tile.solid) continue;
      const [a, b, c, d] = tile.vertices;
      // Rebuild the tile as a centred, rotated box: planck wants a local shape
      // plus a transform rather than world-space corners.
      const cx = (a.x + b.x + c.x + d.x) / 4;
      const cy = (a.y + b.y + c.y + d.y) / 4;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const body = this.world.createBody({ type: 'static', position: new Vec2(cx, cy), angle });
      body.createFixture({
        shape: new Box(TILE_WIDTH / 2, TILE_HEIGHT / 2),
        friction: TILE_FRICTION,
      });
      this.trackBodies.push(body);
    }
  }

  private spawn(entries: CarEntry[]): void {
    this.cars = entries.map((e) => new Car(this.world, e.def, e.index, e.isElite, e.lineage));
    this.nextLineage = Math.max(this.nextLineage, ...entries.map((e) => e.lineage + 1));
    this.recorders = this.cars.map((car) => new ReplayRecorder(car.def.wheels.length));
    this.aliveCount = this.cars.length;
    this.scores = [];
    this.frame = 0;
    this.bestX = 0;
    this.lastProgressFrame = 0;
    this.recordFrame();
  }

  /** Capture the current pose of every living car into its replay. */
  private recordFrame(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      if (!car.alive || !car.chassis || !car.wheels) continue;
      const c = car.chassis.getPosition();
      const poses = this.posePool;
      while (poses.length < car.wheels.length) poses.push({ x: 0, y: 0, angle: 0 });
      for (let w = 0; w < car.wheels.length; w++) {
        const body = car.wheels[w]!;
        const p = body.getPosition();
        const pose = poses[w]!;
        pose.x = p.x;
        pose.y = p.y;
        pose.angle = body.getAngle();
      }
      this.chassisPose.x = c.x;
      this.chassisPose.y = c.y;
      this.chassisPose.angle = car.chassis.getAngle();
      this.recorders[i]!.add(this.chassisPose, poses);
    }
  }

  /** Advance the world one fixed step. Returns true if the generation ended. */
  step(): boolean {
    // Drivers act on what they saw at the end of the last step, then the world
    // moves. Doing it the other way round would let a car react to a collision
    // in the same instant it happened.
    for (const car of this.cars) {
      if (!car.alive || !car.chassis) continue;
      slopeProbes(this.track, car.chassis.getPosition().x, this.probes);
      car.drive(this.probes);
    }

    this.world.step(TIME_STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.frame++;

    for (const car of this.cars) {
      if (!car.alive) continue;
      const died = car.update();
      if (car.maxX > this.bestX + PROGRESS_EPSILON) {
        this.bestX = car.maxX;
        this.lastProgressFrame = this.frame;
      } else if (car.maxX > this.bestX) {
        this.bestX = car.maxX;
      }
      if (died) this.killCar(car);
    }

    this.recordFrame();

    // Retire the survivors once the round is over in all but name: either the
    // furthest point reached has stopped advancing, or the hard cap is hit.
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

  private killCar(car: Car): void {
    const run = {
      distance: car.maxX,
      avgSpeed: car.avgSpeed,
      maxY: car.maxY,
      minY: car.minY,
      mass: car.mass,
    };
    car.destroy(this.world);
    this.aliveCount--;
    this.scores.push({
      def: car.def,
      // Fitness is applied here rather than inside the car, so changing the
      // goal changes what wins without the physics knowing anything about it.
      score: fitnessOf(run, this.params.goal),
      avgSpeed: run.avgSpeed,
      distance: run.distance,
      maxY: run.maxY,
      minY: run.minY,
      mass: run.mass,
      isElite: car.isElite,
      lineage: car.lineage,
    });
    this.archive.offer(car.def, fitnessOf(run, this.params.goal), this.generation);
    this.onCarDeath?.(car);
  }

  private endGeneration(): void {
    const finished = this.scores;
    this.onGenerationEnd?.(finished, this.generation);
    this.generation++;
    const entries = nextGeneration(
      finished,
      this.params,
      this.rng,
      undefined,
      this.nextLineage,
      this.migrantSource,
      this.archive,
    );
    this.placePending(entries, entries.filter((e) => e.isElite).length);
    this.spawn(entries);
  }

  /** Start over with a fresh random population on the same track. */
  resetPopulation(): void {
    this.clearCars();
    this.generation = 0;
    this.nextLineage = 0;
    this.spawn(randomPopulation(this.rng, this.params.populationSize));
  }

  /** Build a new track and start over. */
  setTrack(seed: string): void {
    this.setTrackSpec(defaultSpec(seed));
  }

  /** Build the track this design describes and start over. */
  setTrackSpec(spec: TrackSpec): void {
    this.archive.clear();
    this.clearCars();
    this.track = generateTrackFromSpec(spec);
    this.buildTrackBodies();
    this.generation = 0;
    this.nextLineage = 0;
    this.spawn(randomPopulation(this.rng, this.params.populationSize));
  }

  private clearCars(): void {
    for (const car of this.cars) {
      if (car.alive) car.destroy(this.world);
    }
    this.cars = [];
    this.recorders = [];
  }

  /** Fill a caller-owned snapshot. Allocates only when the population changes. */
  snapshot(out: WorldSnapshot): void {
    while (out.cars.length < this.cars.length) {
      out.cars.push({
        alive: false,
        isElite: false,
        index: out.cars.length,
        def: null,
        chassis: emptyPose(),
        wheels: [],
        health01: 0,
        maxX: 0,
        activations: new Float32Array(BRAIN_NODE_COUNT),
        memory: new Float32Array(BRAIN_RECURRENT),
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
    let leaderY = 0;

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

      if (!car.alive || !car.chassis || !car.wheels) continue;

      // Copy the numbers out: planck returns live vectors that keep changing.
      const c = car.chassis.getPosition();
      snap.chassis.x = c.x;
      snap.chassis.y = c.y;
      snap.chassis.angle = car.chassis.getAngle();
      while (snap.wheels.length < car.wheels.length) snap.wheels.push(emptyPose());
      snap.wheels.length = car.wheels.length;
      for (let w = 0; w < car.wheels.length; w++) {
        const p = car.wheels[w]!.getPosition();
        snap.wheels[w]!.x = p.x;
        snap.wheels[w]!.y = p.y;
        snap.wheels[w]!.angle = car.wheels[w]!.getAngle();
      }

      if (c.x > leaderX) {
        leaderX = c.x;
        leaderY = c.y;
        leaderIndex = i;
      }
    }

    out.leaderIndex = leaderIndex;
    if (leaderIndex >= 0) {
      out.leaderX = leaderX;
      out.leaderY = leaderY;
    }
  }

  /** Genome of a car by index, for thumbnails and export. */
  defAt(index: number): CarDef | null {
    return this.cars[index]?.def ?? null;
  }
}
