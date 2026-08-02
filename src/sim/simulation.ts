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
  DEFAULT_ELITE_COUNT,
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
import { BRAIN_NODE_COUNT } from '../ga/brain';
import { nextGeneration, randomPopulation, type CarEntry, type CarScore, type GAParams } from '../ga/evolution';
import type { CarDef } from '../ga/genome';
import { randomSeed, rngFromSeed, type Rng } from '../core/rng';
import { ReplayRecorder, type Pose } from '../replay/recorder';
import { generateTrack, slopeAhead, type TrackDef } from './track';
import { Car } from './car';

export interface CarSnapshot {
  alive: boolean;
  isElite: boolean;
  index: number;
  /** The genome, so the renderer can build geometry without the physics world. */
  def: CarDef | null;
  chassis: Pose;
  wheels: [Pose, Pose];
  /** Remaining health in [0, 1]. */
  health01: number;
  maxX: number;
  /** This car's network as it last fired. Copied, so it is safe to hold on to. */
  activations: Float32Array;
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

  /** Scores of cars that have already died this generation. */
  private scores: CarScore[] = [];
  private trackBodies: Body[] = [];
  private rng: Rng;
  private runSeed: string;

  onCarDeath: ((car: Car) => void) | null = null;
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
    this.cars = entries.map((e) => new Car(this.world, e.def, e.index, e.isElite));
    this.recorders = this.cars.map(() => new ReplayRecorder());
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
      const w1 = car.wheels[0].getPosition();
      const w2 = car.wheels[1].getPosition();
      this.recorders[i]!.add(
        { x: c.x, y: c.y, angle: car.chassis.getAngle() },
        { x: w1.x, y: w1.y, angle: car.wheels[0].getAngle() },
        { x: w2.x, y: w2.y, angle: car.wheels[1].getAngle() },
      );
    }
  }

  /** Advance the world one fixed step. Returns true if the generation ended. */
  step(): boolean {
    // Drivers act on what they saw at the end of the last step, then the world
    // moves. Doing it the other way round would let a car react to a collision
    // in the same instant it happened.
    for (const car of this.cars) {
      if (!car.alive || !car.chassis) continue;
      car.drive(slopeAhead(this.track, car.chassis.getPosition().x));
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
    car.destroy(this.world);
    this.aliveCount--;
    this.scores.push({
      def: car.def,
      score: car.score,
      avgSpeed: car.avgSpeed,
      distance: car.maxX,
      maxY: car.maxY,
      minY: car.minY,
      isElite: car.isElite,
    });
    this.onCarDeath?.(car);
  }

  private endGeneration(): void {
    const finished = this.scores;
    this.onGenerationEnd?.(finished, this.generation);
    this.generation++;
    this.spawn(nextGeneration(finished, this.params, this.rng));
  }

  /** Start over with a fresh random population on the same track. */
  resetPopulation(): void {
    this.clearCars();
    this.generation = 0;
    this.spawn(randomPopulation(this.rng, this.params.populationSize));
  }

  /** Build a new track and start over. */
  setTrack(seed: string): void {
    this.clearCars();
    this.track = generateTrack(seed);
    this.buildTrackBodies();
    this.generation = 0;
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
        wheels: [emptyPose(), emptyPose()],
        health01: 0,
        maxX: 0,
        activations: new Float32Array(BRAIN_NODE_COUNT),
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
      snap.health01 = Math.max(0, car.health) / MAX_CAR_HEALTH;
      snap.maxX = car.maxX;
      snap.activations.set(car.brain.activations);

      if (!car.alive || !car.chassis || !car.wheels) continue;

      // Copy the numbers out: planck returns live vectors that keep changing.
      const c = car.chassis.getPosition();
      snap.chassis.x = c.x;
      snap.chassis.y = c.y;
      snap.chassis.angle = car.chassis.getAngle();
      for (let w = 0; w < 2; w++) {
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
