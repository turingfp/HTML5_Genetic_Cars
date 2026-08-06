/**
 * The MAP-Elites archive.
 *
 * The one property everything else rests on: a car only ever competes with
 * the best car of its own body shape. Get that wrong and this is just a
 * leaderboard with extra squares.
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHIVE_GRID,
  describeCar,
  describeCar3D,
  EliteArchive,
} from '../src/ga/archive';
import { rngFromSeed } from '../src/core/rng';
import { cloneCar, randomCar, type CarDef } from '../src/ga/genome';
import { randomCar3D } from '../src/ga/genome3d';
import {
  carOps,
  nextGeneration,
  DEFAULT_CROSSOVER,
  DEFAULT_GOAL,
  DEFAULT_SELECTION,
  type CarScore,
  type GAParams,
} from '../src/ga/evolution';

const params = (search: 'climb' | 'illuminate'): GAParams => ({
  populationSize: 20,
  mutationRate: 0.3,
  mutationSize: 0.3,
  eliteCount: 2,
  selection: DEFAULT_SELECTION,
  search,
  crossoverMode: DEFAULT_CROSSOVER,
  goal: DEFAULT_GOAL,
  diversityPressure: 0,
  immigrants: 0,
  migrants: 0,
});

const scored = (def: CarDef, score: number): CarScore => ({
  def,
  score,
  avgSpeed: 1,
  distance: score,
  maxY: 0,
  minY: 0,
  mass: 1,
  isElite: false,
  lineage: 0,
});

describe('the descriptor', () => {
  it('keeps every car inside the map', () => {
    const rng = rngFromSeed('desc');
    for (let i = 0; i < 3000; i++) {
      const d = describeCar(randomCar(rng));
      expect(d.body).toBeGreaterThanOrEqual(0);
      expect(d.body).toBeLessThanOrEqual(1);
      expect(d.wheel).toBeGreaterThanOrEqual(0);
      expect(d.wheel).toBeLessThanOrEqual(1);
    }
  });

  it('is the same for a 3D car as for its silhouette', () => {
    const def = randomCar3D(rngFromSeed('flat'));
    expect(describeCar3D(def)).toEqual(describeCar(def.base));
  });

  it('actually spreads cars across cells rather than piling them in one', () => {
    const rng = rngFromSeed('spread');
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    for (let i = 0; i < 500; i++) archive.offer(randomCar(rng), 1, 0);
    // Random cars cluster near the middle of morphology space, but 500 of
    // them must still land in a good number of distinct niches.
    expect(archive.filled).toBeGreaterThan(20);
  });
});

describe('the archive', () => {
  it('keeps a car only if it beats the best of its own shape', () => {
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    const def = randomCar(rngFromSeed('same'));
    expect(archive.offer(def, 10, 0)).toBe(true);
    expect(archive.offer(cloneCar(def), 5, 1)).toBe(false);
    expect(archive.offer(cloneCar(def), 15, 2)).toBe(true);
    expect(archive.filled).toBe(1);
    expect(archive.bestScore).toBe(15);
  });

  it('never loses a niche to a better car of a different shape', () => {
    const rng = rngFromSeed('niches');
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    let placed = 0;
    while (placed < 6) if (archive.offer(randomCar(rng), 10 + placed, 0)) placed++;
    // A wildly better car lands in its own cell and displaces nobody else.
    while (!archive.offer(randomCar(rng), 1000, 1)) {
      // Keep drawing until one falls in a fresh or beatable cell.
    }
    expect(archive.filled).toBeGreaterThanOrEqual(6);
    expect(archive.bestScore).toBe(1000);
  });

  it('clones what it keeps, so breeding cannot corrupt the map', () => {
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    const def = randomCar(rngFromSeed('clone'));
    archive.offer(def, 10, 0);
    def.spokes[0]!.length = 99;
    const held = archive.pick(rngFromSeed('p'));
    expect(held?.spokes[0]?.length).not.toBe(99);
  });

  it('picks uniformly from the filled cells', () => {
    const rng = rngFromSeed('uniform');
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    while (archive.filled < 10) archive.offer(randomCar(rng), rng() * 100, 0);
    const counts = new Map<CarDef, number>();
    const draw = rngFromSeed('draw');
    for (let i = 0; i < 5000; i++) {
      const def = archive.pick(draw)!;
      counts.set(def, (counts.get(def) ?? 0) + 1);
    }
    expect(counts.size).toBe(10);
    for (const n of counts.values()) {
      // Uniform over 10 cells is 500 each; anything wildly off means the
      // walk over cells is skipping or double-counting.
      expect(n).toBeGreaterThan(350);
      expect(n).toBeLessThan(650);
    }
  });

  it('refuses scores that are not numbers', () => {
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    expect(archive.offer(randomCar(rngFromSeed('nan')), NaN, 0)).toBe(false);
    expect(archive.filled).toBe(0);
    expect(archive.pick(rngFromSeed('x'))).toBeNull();
  });
});

describe('illuminate as a search', () => {
  it('breeds from the archive when asked and from the winners when not', () => {
    const rng = rngFromSeed('modes');
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    const marker = randomCar(rngFromSeed('marker'));
    archive.offer(marker, 1000, 0);

    // No ranked population at all, so the live-winner mate is unavailable
    // and both parents must come from the map. With one filled cell, no
    // mutation and asexual crossover, every child is that cell's elite,
    // byte for byte.
    const p = { ...params('illuminate'), mutationRate: 0, crossoverMode: 'none' as const };
    const entries = nextGeneration([], p, rngFromSeed('gen'), carOps, 0, null, archive);
    const children = entries.filter((e) => !e.isElite);
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(JSON.stringify(child.def.spokes)).toBe(JSON.stringify(marker.spokes));
    }

    // Same call in climb mode never touches the archive.
    const population = Array.from({ length: 10 }, (_, i) =>
      scored(randomCar(rng), 10 + i),
    );
    const climbed = nextGeneration(population, { ...p, search: 'climb' }, rngFromSeed('gen'), carOps, 0, null, archive);
    const copies = climbed.filter(
      (e) => !e.isElite && JSON.stringify(e.def.spokes) === JSON.stringify(marker.spokes),
    );
    expect(copies).toHaveLength(0);
  });

  it('fills more of the map than climbing does, which is its whole claim', () => {
    // A cheap synthetic world: fitness is how close the body is to one exact
    // shape, so a pure climber collapses onto it. The archive should still
    // spread. This is the algorithmic property; the physics version of this
    // measurement is in the README.
    const rng = rngFromSeed('world');
    const target = describeCar(randomCar(rng));
    const fitness = (def: CarDef) => {
      const d = describeCar(def);
      return 100 - Math.hypot(d.body - target.body, d.wheel - target.wheel) * 100;
    };

    const run = (search: 'climb' | 'illuminate') => {
      const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
      const r = rngFromSeed('run-' + search);
      let population = Array.from({ length: 20 }, () => randomCar(r));
      for (let gen = 0; gen < 30; gen++) {
        const scores = population.map((def) => scored(def, fitness(def)));
        for (const s of scores) archive.offer(s.def, s.score, gen);
        population = nextGeneration(scores, params(search), r, carOps, 0, null, archive).map(
          (e) => e.def,
        );
      }
      return archive.filled;
    };

    expect(run('illuminate')).toBeGreaterThan(run('climb'));
  });

  it('a grid cell index never escapes the grid', () => {
    const archive = new EliteArchive<CarDef>(describeCar, cloneCar);
    const rng = rngFromSeed('bounds');
    for (let i = 0; i < 2000; i++) archive.offer(randomCar(rng), rng() * 100, 0);
    expect(archive.cells.length).toBe(ARCHIVE_GRID * ARCHIVE_GRID);
    expect(archive.filled).toBeLessThanOrEqual(archive.cells.length);
    expect(archive.at(-1, 0)).toBeNull();
    expect(archive.at(0, ARCHIVE_GRID)).toBeNull();
  });
});
