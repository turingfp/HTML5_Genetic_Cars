/**
 * Selection and generation turnover.
 *
 * Generic over the genome so the 2D and 3D modes share one evolution engine:
 * each supplies a `GenomeOps` describing how to create, breed and mutate its
 * own kind of car.
 *
 * Most of what makes a run interesting to watch lives here rather than in the
 * physics. What counts as a good car, how parents are picked, whether being
 * unusual is worth anything, and how much fresh blood arrives each round all
 * change the character of the search far more than any single gene does.
 */

import type { Rng } from '../core/rng';
import {
  cloneCar,
  crossover,
  genomeDistance,
  mutate,
  randomCar,
  type CarDef,
  type CrossoverMode,
  type MutationParams,
} from './genome';

export type { CrossoverMode };

/** How parents are drawn from the ranked population. */
export type SelectionMethod = 'rank' | 'tournament' | 'roulette';

/** What the population is actually being selected for. */
export type FitnessGoal = 'distance' | 'speed' | 'airtime' | 'efficiency';

/** Everything evolution needs to know about a genome. */
export interface GenomeOps<T> {
  random(rng: Rng): T;
  crossover(rng: Rng, a: T, b: T, mode: CrossoverMode): T;
  mutate(rng: Rng, def: T, params: MutationParams): T;
  clone(def: T): T;
  /** 0 for identical cars, larger for more different ones. */
  distance(a: T, b: T): number;
}

export const carOps: GenomeOps<CarDef> = {
  random: randomCar,
  crossover,
  mutate,
  clone: cloneCar,
  distance: genomeDistance,
};

/** What a finished run measured, before any goal is applied to it. */
export interface CarScore<T = CarDef> {
  def: T;
  /** Fitness under the current goal. Recomputed when the goal changes. */
  score: number;
  /** Average speed in m/s. */
  avgSpeed: number;
  /** Furthest x reached. */
  distance: number;
  maxY: number;
  minY: number;
  /** Total mass of chassis and wheels. */
  mass: number;
  isElite: boolean;
  /** Which founding line this car descends from. */
  lineage: number;
}

export interface GAParams {
  populationSize: number;
  mutationRate: number;
  mutationSize: number;
  eliteCount: number;
  /** How parents are chosen. */
  selection: SelectionMethod;
  /** How two parents are combined. */
  crossoverMode: CrossoverMode;
  /** What the population is scored on. */
  goal: FitnessGoal;
  /**
   * How much being unusual is worth, from 0 to 1.
   *
   * At 0 this is pure winner-takes-most and the population collapses onto one
   * body plan within a dozen generations, which you can watch happen in the
   * gene pool heatmap. Above 0 a car in a crowded corner of the search space
   * has its fitness divided by how crowded that corner is, so odd designs stay
   * alive long enough to be worth something.
   */
  diversityPressure: number;
  /** Fresh random cars injected each generation, replacing the worst children. */
  immigrants: number;
}

export const DEFAULT_SELECTION: SelectionMethod = 'rank';
export const DEFAULT_CROSSOVER: CrossoverMode = 'two-point';
export const DEFAULT_GOAL: FitnessGoal = 'speed';

/** A genome placed into a generation, with its identity for that round. */
export interface CarEntry<T = CarDef> {
  def: T;
  index: number;
  isElite: boolean;
  lineage: number;
}

/**
 * Mass a car is compared against when scoring efficiency. Roughly a mid sized
 * car, so the multiplier sits near 1 for something ordinary.
 */
const REFERENCE_MASS = 150;

/** Turn what a run measured into a single number, under the chosen goal. */
export function fitnessOf(
  run: { distance: number; avgSpeed: number; maxY: number; minY: number; mass: number },
  goal: FitnessGoal,
): number {
  switch (goal) {
    case 'distance':
      // Pure ground covered. Slow grinders do well, and the winners are long
      // and stable rather than quick.
      return run.distance;
    case 'airtime':
      // Ground covered plus every metre of vertical range. Rewards cars that
      // launch off crests, and the population turns into jumpers.
      return run.distance + (run.maxY - run.minY) * 6;
    case 'efficiency':
      // Distance per unit mass. Punishes the usual answer of "make it heavier
      // until it stops tipping over".
      return run.distance * (REFERENCE_MASS / Math.max(run.mass, 1));
    case 'speed':
    default:
      // The original's rule: distance with a bonus for getting there quickly.
      return run.distance + run.avgSpeed;
  }
}

/**
 * Exponential rank selection: rank 0 (the best car) is most likely, and the
 * probability decays from there.
 *
 * The modulo wrap is inherited from the original. It folds the long tail of
 * the exponential back onto good ranks rather than truncating it.
 */
export function pickParentIndex(rng: Rng, populationSize: number): number {
  const r = rng();
  if (r === 0) return 0;
  return Math.floor(-Math.log(r) * populationSize) % populationSize;
}

/** How many entrants a tournament draws. Larger is greedier. */
const TOURNAMENT_SIZE = 3;

/**
 * Pick one parent from a ranked list under the chosen method.
 *
 * `weights` are the shared fitnesses in rank order, needed only by roulette.
 * They are already non-negative.
 */
export function pickParent(
  rng: Rng,
  method: SelectionMethod,
  count: number,
  weights: number[],
): number {
  if (count <= 1) return 0;

  if (method === 'tournament') {
    // Draw a few at random and keep the best rank. Milder than exponential
    // rank selection, so weaker lines survive longer.
    let best = Math.floor(rng() * count) % count;
    for (let i = 1; i < TOURNAMENT_SIZE; i++) {
      const other = Math.floor(rng() * count) % count;
      if (other < best) best = other;
    }
    return best;
  }

  if (method === 'roulette') {
    // Probability proportional to fitness. Once one car is far ahead it takes
    // over almost immediately, which is exactly what makes it interesting to
    // watch next to the others.
    let total = 0;
    for (let i = 0; i < count; i++) total += Math.max(0, weights[i] ?? 0);
    if (total <= 0) return Math.floor(rng() * count) % count;
    let ticket = rng() * total;
    for (let i = 0; i < count; i++) {
      ticket -= Math.max(0, weights[i] ?? 0);
      if (ticket <= 0) return i;
    }
    return count - 1;
  }

  return pickParentIndex(rng, count);
}

/**
 * A finite number, or the fallback.
 *
 * Params reach here from persisted settings, so a key added after someone last
 * used the page arrives undefined. Left unguarded that turns into NaN, and the
 * population silently comes back with only its elites in it rather than
 * failing in any visible way.
 */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Fitness, highest first. */
export function sortByScore<T>(scores: CarScore<T>[]): CarScore<T>[] {
  return scores.slice().sort((a, b) => b.score - a.score);
}

/**
 * How far apart two cars have to be to count as different designs.
 *
 * `genomeDistance` is normalised so that 1 is a substantial difference, so a
 * niche a fifth of that wide groups cars that are recognisably the same idea.
 */
const NICHE_RADIUS = 0.2;

/**
 * Divide each car's fitness by how many near-identical cars it is competing
 * with. Standard fitness sharing.
 *
 * Returned in the same order as `ranked`, and never negative, so roulette can
 * use them as weights directly.
 */
export function sharedFitness<T>(
  ranked: CarScore<T>[],
  pressure: number,
  ops: GenomeOps<T>,
): number[] {
  const raw = ranked.map((s) => s.score);
  if (!(pressure > 0)) return raw.map((v) => Math.max(0, v));

  const shared: number[] = [];
  for (let i = 0; i < ranked.length; i++) {
    let crowd = 1;
    for (let j = 0; j < ranked.length; j++) {
      if (i === j) continue;
      const d = ops.distance(ranked[i]!.def, ranked[j]!.def);
      // Triangular sharing: identical cars count fully, cars a niche apart
      // count for nothing.
      if (d < NICHE_RADIUS) crowd += 1 - d / NICHE_RADIUS;
    }
    shared.push(Math.max(0, (raw[i] ?? 0) / (1 + pressure * (crowd - 1))));
  }
  return shared;
}

/** How many distinct designs are alive, at the niche radius used for sharing. */
export function countLineages<T>(scores: CarScore<T>[]): number {
  return new Set(scores.map((s) => s.lineage)).size;
}

export function randomPopulation<T>(
  rng: Rng,
  size: number,
  ops: GenomeOps<T> = carOps as unknown as GenomeOps<T>,
  firstLineage = 0,
): CarEntry<T>[] {
  const entries: CarEntry<T>[] = [];
  for (let i = 0; i < size; i++) {
    entries.push({ def: ops.random(rng), index: i, isElite: false, lineage: firstLineage + i });
  }
  return entries;
}

/**
 * Build the next generation: elite clones first, then children of two selected
 * parents, then any fresh immigrants.
 *
 * `nextLineage` is where new founding lines start numbering, so the caller can
 * keep them unique across a whole run.
 */
export function nextGeneration<T>(
  scores: CarScore<T>[],
  params: GAParams,
  rng: Rng,
  ops: GenomeOps<T> = carOps as unknown as GenomeOps<T>,
  nextLineage = 0,
): CarEntry<T>[] {
  const ranked = sortByScore(scores);
  const populationSize = Math.max(1, Math.round(finiteOr(params.populationSize, 20)));
  const mutationRate = finiteOr(params.mutationRate, 0);
  const mutationSize = finiteOr(params.mutationSize, 1);
  const eliteCount = finiteOr(params.eliteCount, 0);
  const elites = Math.max(0, Math.min(eliteCount, populationSize, ranked.length));
  const entries: CarEntry<T>[] = [];
  const weights = sharedFitness(ranked, finiteOr(params.diversityPressure, 0), ops);

  for (let i = 0; i < elites; i++) {
    // Clone rather than carry the object forward: the original shared vertex
    // objects between generations, so mutating a child could disturb a parent.
    const elite = ranked[i]!;
    entries.push({ def: ops.clone(elite.def), index: i, isElite: true, lineage: elite.lineage });
  }

  // Immigrants take the last few slots, so they replace the weakest children
  // rather than pushing out an elite.
  const immigrants = Math.max(
    0,
    Math.min(finiteOr(params.immigrants, 0), populationSize - elites),
  );
  const bred = populationSize - immigrants;
  let lineage = nextLineage;

  for (let i = elites; i < bred; i++) {
    let def: T;
    let inherited = lineage++;
    if (ranked.length === 0) {
      def = ops.random(rng);
    } else {
      const ai = pickParent(rng, params.selection ?? DEFAULT_SELECTION, ranked.length, weights);
      const bi = pickParent(rng, params.selection ?? DEFAULT_SELECTION, ranked.length, weights);
      const a = ranked[ai]!;
      const b = ranked[bi]!;
      // A child belongs to the line of whichever parent scored better, so a
      // lineage marks descent rather than merely a shared ancestor somewhere.
      inherited = (a.score >= b.score ? a : b).lineage;
      def = ops.mutate(rng, ops.crossover(rng, a.def, b.def, params.crossoverMode ?? DEFAULT_CROSSOVER), {
        rate: mutationRate,
        size: mutationSize,
      });
    }
    entries.push({ def, index: i, isElite: false, lineage: inherited });
  }

  for (let i = bred; i < populationSize; i++) {
    entries.push({ def: ops.random(rng), index: i, isElite: false, lineage: lineage++ });
  }

  return entries;
}
