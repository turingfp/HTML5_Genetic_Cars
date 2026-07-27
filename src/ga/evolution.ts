/**
 * Selection and generation turnover.
 */

import type { Rng } from '../core/rng';
import { cloneCar, crossover, mutate, randomCar, type CarDef } from './genome';

export interface CarScore {
  def: CarDef;
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
export interface CarEntry {
  def: CarDef;
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
export function sortByScore(scores: CarScore[]): CarScore[] {
  return scores.slice().sort((a, b) => b.score - a.score);
}

export function randomPopulation(rng: Rng, size: number): CarEntry[] {
  const entries: CarEntry[] = [];
  for (let i = 0; i < size; i++) {
    entries.push({ def: randomCar(rng), index: i, isElite: false });
  }
  return entries;
}

/**
 * Build the next generation: elite clones first, then children of two
 * rank-selected parents, mutated.
 */
export function nextGeneration(scores: CarScore[], params: GAParams, rng: Rng): CarEntry[] {
  const ranked = sortByScore(scores);
  const { populationSize, eliteCount, mutationRate, mutationSize } = params;
  const elites = Math.max(0, Math.min(eliteCount, populationSize, ranked.length));
  const entries: CarEntry[] = [];

  for (let i = 0; i < elites; i++) {
    // Clone rather than carry the object forward: the original shared vertex
    // objects between generations, so mutating a child could disturb a parent.
    entries.push({ def: cloneCar(ranked[i]!.def), index: i, isElite: true });
  }

  for (let i = elites; i < populationSize; i++) {
    let def: CarDef;
    if (ranked.length === 0) {
      def = randomCar(rng);
    } else {
      const a = ranked[pickParentIndex(rng, ranked.length)]!.def;
      const b = ranked[pickParentIndex(rng, ranked.length)]!.def;
      def = mutate(rng, crossover(rng, a, b), { rate: mutationRate, size: mutationSize });
    }
    entries.push({ def, index: i, isElite: false });
  }

  return entries;
}
