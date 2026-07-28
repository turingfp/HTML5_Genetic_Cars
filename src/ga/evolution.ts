/**
 * Selection and generation turnover.
 *
 * Generic over the genome so the 2D and 3D modes share one evolution engine:
 * each supplies a `GenomeOps` describing how to create, breed and mutate its
 * own kind of car.
 */

import type { Rng } from '../core/rng';
import { cloneCar, crossover, mutate, randomCar, type CarDef, type MutationParams } from './genome';

/** Everything evolution needs to know about a genome. */
export interface GenomeOps<T> {
  random(rng: Rng): T;
  crossover(rng: Rng, a: T, b: T): T;
  mutate(rng: Rng, def: T, params: MutationParams): T;
  clone(def: T): T;
}

export const carOps: GenomeOps<CarDef> = {
  random: randomCar,
  crossover,
  mutate,
  clone: cloneCar,
};

export interface CarScore<T = CarDef> {
  def: T;
  /** Fitness: distance travelled plus average speed. */
  score: number;
  /** Average speed in m/s. */
  avgSpeed: number;
  /** Furthest x reached. */
  distance: number;
  maxY: number;
  minY: number;
  isElite: boolean;
}

export interface GAParams {
  populationSize: number;
  mutationRate: number;
  mutationSize: number;
  eliteCount: number;
}

/** A genome placed into a generation, with its identity for that round. */
export interface CarEntry<T = CarDef> {
  def: T;
  index: number;
  isElite: boolean;
}

/**
 * Exponential rank selection: rank 0 (the best car) is most likely, and the
 * probability decays from there.
 *
 * The modulo wrap is inherited from the original — it folds the long tail of
 * the exponential back onto good ranks rather than truncating it.
 */
export function pickParentIndex(rng: Rng, populationSize: number): number {
  const r = rng();
  if (r === 0) return 0;
  return Math.floor(-Math.log(r) * populationSize) % populationSize;
}

/** Fitness, highest first. */
export function sortByScore<T>(scores: CarScore<T>[]): CarScore<T>[] {
  return scores.slice().sort((a, b) => b.score - a.score);
}

export function randomPopulation<T>(
  rng: Rng,
  size: number,
  ops: GenomeOps<T> = carOps as unknown as GenomeOps<T>,
): CarEntry<T>[] {
  const entries: CarEntry<T>[] = [];
  for (let i = 0; i < size; i++) {
    entries.push({ def: ops.random(rng), index: i, isElite: false });
  }
  return entries;
}

/**
 * Build the next generation: elite clones first, then children of two
 * rank-selected parents, mutated.
 */
export function nextGeneration<T>(
  scores: CarScore<T>[],
  params: GAParams,
  rng: Rng,
  ops: GenomeOps<T> = carOps as unknown as GenomeOps<T>,
): CarEntry<T>[] {
  const ranked = sortByScore(scores);
  const { populationSize, eliteCount, mutationRate, mutationSize } = params;
  const elites = Math.max(0, Math.min(eliteCount, populationSize, ranked.length));
  const entries: CarEntry<T>[] = [];

  for (let i = 0; i < elites; i++) {
    // Clone rather than carry the object forward: the original shared vertex
    // objects between generations, so mutating a child could disturb a parent.
    entries.push({ def: ops.clone(ranked[i]!.def), index: i, isElite: true });
  }

  for (let i = elites; i < populationSize; i++) {
    let def: T;
    if (ranked.length === 0) {
      def = ops.random(rng);
    } else {
      const a = ranked[pickParentIndex(rng, ranked.length)]!.def;
      const b = ranked[pickParentIndex(rng, ranked.length)]!.def;
      def = ops.mutate(rng, ops.crossover(rng, a, b), {
        rate: mutationRate,
        size: mutationSize,
      });
    }
    entries.push({ def, index: i, isElite: false });
  }

  return entries;
}
