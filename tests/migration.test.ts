/**
 * The island model, tested with the network taken out.
 *
 * `nextGeneration` takes migrants from a function, not from a socket, so all
 * of this runs offline and deterministically. That is the point of the seam.
 */

import { describe, expect, it } from 'vitest';

import { rngFromSeed } from '../src/core/rng';
import {
  carOps,
  nextGeneration,
  DEFAULT_CROSSOVER,
  DEFAULT_GOAL,
  DEFAULT_SELECTION,
  type CarScore,
  type GAParams,
} from '../src/ga/evolution';
import { randomCar, type CarDef } from '../src/ga/genome';

function params(over: Partial<GAParams> = {}): GAParams {
  return {
    populationSize: 20,
    mutationRate: 0.05,
    mutationSize: 1,
    eliteCount: 1,
    selection: DEFAULT_SELECTION,
    crossoverMode: DEFAULT_CROSSOVER,
    goal: DEFAULT_GOAL,
    diversityPressure: 0,
    immigrants: 0,
    migrants: 0,
    ...over,
  };
}

/** A scored population of locally bred cars. */
function population(seed: string, size = 20): CarScore<CarDef>[] {
  const rng = rngFromSeed(seed);
  return Array.from({ length: size }, (_, i) => {
    const def = randomCar(rng);
    return {
      def,
      score: size - i,
      avgSpeed: 1,
      distance: size - i,
      maxY: 1,
      minY: 0,
      mass: 100,
      isElite: false,
      lineage: i,
    };
  });
}

/** A car that could only have come from somewhere else. */
function foreign(): CarDef {
  return randomCar(rngFromSeed('another-machine'));
}

const identical = (a: CarDef, b: CarDef) => carOps.distance(a, b) === 0;

describe('migration', () => {
  it('places exactly as many migrants as asked for', () => {
    const rng = rngFromSeed('place');
    for (const count of [0, 1, 3, 7]) {
      const next = nextGeneration(
        population('p'),
        params({ migrants: count }),
        rng,
        carOps,
        100,
        () => foreign(),
      );
      const arrived = next.filter((entry) => identical(entry.def, foreign()));
      expect(arrived).toHaveLength(count);
    }
  });

  it('does nothing at all when no source is connected', () => {
    const rng = rngFromSeed('nosource');
    const withParam = nextGeneration(population('p'), params({ migrants: 5 }), rng, carOps, 100);
    const withoutParam = nextGeneration(
      population('p'),
      params({ migrants: 0 }),
      rngFromSeed('nosource'),
      carOps,
      100,
    );
    // Same random stream consumed either way: asking for migrants with nobody
    // to take from must not perturb the local search.
    expect(withParam.map((e) => e.def)).toEqual(withoutParam.map((e) => e.def));
  });

  it('breeds a normal child when the room has nothing to offer', () => {
    const next = nextGeneration(
      population('p'),
      params({ migrants: 4 }),
      rngFromSeed('empty'),
      carOps,
      100,
      () => null,
    );
    expect(next).toHaveLength(20);
    for (const entry of next) expect(identical(entry.def, foreign())).toBe(false);
  });

  it('never displaces an elite', () => {
    const scored = population('elites');
    const best = scored[0]!.def;
    const next = nextGeneration(
      scored,
      params({ migrants: 8, eliteCount: 3 }),
      rngFromSeed('keep'),
      carOps,
      100,
      () => foreign(),
    );
    expect(next.slice(0, 3).every((e) => e.isElite)).toBe(true);
    expect(identical(next[0]!.def, best)).toBe(true);
  });

  it('gives each migrant a lineage of its own', () => {
    const next = nextGeneration(
      population('lineage'),
      params({ migrants: 3 }),
      rngFromSeed('lin'),
      carOps,
      500,
      () => foreign(),
    );
    const migrants = next.filter((e) => identical(e.def, foreign()));
    const lineages = new Set(migrants.map((e) => e.lineage));
    expect(lineages.size).toBe(3);
    // Numbered from where the caller said new lines start, so a foreign line
    // can never be confused with a local one.
    for (const lineage of lineages) expect(lineage).toBeGreaterThanOrEqual(500);
  });

  it('still returns a full population however many migrants are asked for', () => {
    for (const count of [0, 1, 20, 50]) {
      const next = nextGeneration(
        population('full'),
        params({ migrants: count, eliteCount: 2, immigrants: 3 }),
        rngFromSeed('size'),
        carOps,
        100,
        () => foreign(),
      );
      expect(next).toHaveLength(20);
      expect(next.map((e) => e.index)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    }
  });

  it('leaves room for immigrants alongside migrants', () => {
    const next = nextGeneration(
      population('both'),
      params({ migrants: 5, immigrants: 4, eliteCount: 1 }),
      rngFromSeed('both'),
      carOps,
      100,
      () => foreign(),
    );
    expect(next.filter((e) => identical(e.def, foreign()))).toHaveLength(5);
    expect(next).toHaveLength(20);
  });

  it('ignores a migrant count that arrived as undefined from old settings', () => {
    const stale = params();
    delete (stale as Partial<GAParams>).migrants;
    const next = nextGeneration(
      population('stale'),
      stale,
      rngFromSeed('stale'),
      carOps,
      100,
      () => foreign(),
    );
    expect(next).toHaveLength(20);
    expect(next.filter((e) => identical(e.def, foreign()))).toHaveLength(0);
  });
});
