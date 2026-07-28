import { describe, expect, it } from 'vitest';

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_VERTEX_COUNT,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../src/config';
import { mulberry32, rngFromSeed } from '../src/core/rng';
import { cloneCar, crossover, mutate, randomCar, type CarDef } from '../src/ga/genome';
import { nextGeneration, pickParentIndex, sortByScore, type CarScore } from '../src/ga/evolution';

const EPS = 1e-9;

function withinAxisBounds(value: number): boolean {
  const m = Math.abs(value);
  return m === 0 || (m >= CHASSIS_AXIS_MIN - EPS && m < CHASSIS_AXIS_MIN + CHASSIS_AXIS_RANGE + EPS);
}

/**
 * Describe what is wrong with a genome, or null if it is valid.
 *
 * Returning a description rather than asserting matters in the loops below:
 * they check tens of thousands of genomes, and an `expect` per field would
 * spend all its time in the assertion library rather than in the code under
 * test. One assertion at the end is both faster and reports the first real
 * problem instead of an opaque timeout.
 */
function genomeViolation(def: CarDef): string | null {
  for (const i of [0, 1] as const) {
    const radius = def.wheelRadius[i];
    if (!(radius >= WHEEL_RADIUS_MIN - EPS && radius < WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE + EPS)) {
      return `wheelRadius[${i}] out of range: ${radius}`;
    }
    const density = def.wheelDensity[i];
    if (
      !(density >= WHEEL_DENSITY_MIN - EPS && density < WHEEL_DENSITY_MIN + WHEEL_DENSITY_RANGE + EPS)
    ) {
      return `wheelDensity[${i}] out of range: ${density}`;
    }
    const vertex = def.wheelVertex[i];
    if (!(Number.isInteger(vertex) && vertex >= 0 && vertex < CHASSIS_VERTEX_COUNT)) {
      return `wheelVertex[${i}] out of range: ${vertex}`;
    }
  }
  if (def.wheelVertex[0] === def.wheelVertex[1]) {
    return `both wheels on vertex ${def.wheelVertex[0]}`;
  }
  if (def.vertices.length !== CHASSIS_VERTEX_COUNT) {
    return `expected ${CHASSIS_VERTEX_COUNT} vertices, got ${def.vertices.length}`;
  }
  for (let i = 0; i < def.vertices.length; i++) {
    const v = def.vertices[i]!;
    if (!withinAxisBounds(v.x)) return `vertex ${i} x out of range: ${v.x}`;
    if (!withinAxisBounds(v.y)) return `vertex ${i} y out of range: ${v.y}`;
  }
  return null;
}

function expectValidCar(def: CarDef): void {
  expect(genomeViolation(def)).toBeNull();
}

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = rngFromSeed('hello');
    const b = rngFromSeed('hello');
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = Array.from({ length: 20 }, rngFromSeed('one'));
    const b = Array.from({ length: 20 }, rngFromSeed('two'));
    expect(a).not.toEqual(b);
  });

  it('stays within [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randomCar', () => {
  it('generates valid cars and repeats them for the same seed', () => {
    const first = Array.from({ length: 30 }, () => randomCar(rngFromSeed('seed-a')));
    const again = randomCar(rngFromSeed('seed-a'));
    expect(again).toEqual(first[0]);
    for (const def of first) expectValidCar(def);
  });

  it('pins axis-aligned vertices to their axis', () => {
    const def = randomCar(rngFromSeed('axes'));
    // Octants 0 and 4 lie on the x axis; 2 and 6 lie on the y axis.
    expect(def.vertices[0]!.y).toBe(0);
    expect(def.vertices[4]!.y).toBe(0);
    expect(def.vertices[2]!.x).toBe(0);
    expect(def.vertices[6]!.x).toBe(0);
    // Signs follow the octant layout.
    expect(def.vertices[0]!.x).toBeGreaterThan(0);
    expect(def.vertices[4]!.x).toBeLessThan(0);
    expect(def.vertices[2]!.y).toBeGreaterThan(0);
    expect(def.vertices[6]!.y).toBeLessThan(0);
  });
});

describe('mutate', () => {
  it('keeps every gene in bounds and wheels on distinct vertices', () => {
    const rng = rngFromSeed('mutations');
    let def = randomCar(rng);
    let violation: string | null = null;
    for (let i = 0; i < 10_000 && !violation; i++) {
      def = mutate(rng, def, { rate: 0.5, size: rng() });
      const bad = genomeViolation(def);
      if (bad) violation = `after ${i} mutations: ${bad}`;
    }
    expect(violation).toBeNull();
  });

  it('leaves genomes untouched at rate 0', () => {
    const rng = rngFromSeed('none');
    const def = randomCar(rng);
    const before = cloneCar(def);
    mutate(rng, def, { rate: 0, size: 1 });
    expect(def).toEqual(before);
  });

  it('makes only small changes at a small mutation size', () => {
    const rng = rngFromSeed('small');
    const def = randomCar(rng);
    const before = cloneCar(def);
    // Always mutate, but only within 2% of each gene's range.
    mutate(rng, def, { rate: 1, size: 0.02 });
    expect(Math.abs(def.wheelRadius[0] - before.wheelRadius[0])).toBeLessThan(
      WHEEL_RADIUS_RANGE * 0.02 + EPS,
    );
    expect(Math.abs(def.wheelDensity[0] - before.wheelDensity[0])).toBeLessThan(
      WHEEL_DENSITY_RANGE * 0.02 + EPS,
    );
  });
});

describe('crossover', () => {
  it('takes every gene from one parent or the other', () => {
    const rng = rngFromSeed('cross');
    for (let i = 0; i < 500; i++) {
      const a = randomCar(rng);
      const b = randomCar(rng);
      const child = crossover(rng, a, b);
      expect(genomeViolation(child)).toBeNull();
      for (const k of [0, 1] as const) {
        expect([a.wheelRadius[k], b.wheelRadius[k]]).toContain(child.wheelRadius[k]);
        expect([a.wheelDensity[k], b.wheelDensity[k]]).toContain(child.wheelDensity[k]);
      }
      // The first wheel is always inherited. The second is too, unless both
      // parents named the same vertex, in which case it gets moved off.
      expect([a.wheelVertex[0], b.wheelVertex[0]]).toContain(child.wheelVertex[0]);
      const inherited = [a.wheelVertex[1], b.wheelVertex[1]].includes(child.wheelVertex[1]);
      if (!inherited) {
        // Repair only fires when the inherited value collided with wheel 0.
        expect([a.wheelVertex[1], b.wheelVertex[1]]).toContain(child.wheelVertex[0]);
      }
      for (let v = 0; v < CHASSIS_VERTEX_COUNT; v++) {
        expect([a.vertices[v]!.x, b.vertices[v]!.x]).toContain(child.vertices[v]!.x);
      }
    }
  });

  it('does not alias parent vertex objects', () => {
    const rng = rngFromSeed('alias');
    const a = randomCar(rng);
    const b = randomCar(rng);
    const child = crossover(rng, a, b);
    child.vertices[0]!.x = 999;
    expect(a.vertices[0]!.x).not.toBe(999);
    expect(b.vertices[0]!.x).not.toBe(999);
  });
});

describe('selection', () => {
  it('favours the best ranks', () => {
    const rng = rngFromSeed('select');
    const N = 20;
    const samples = 200_000;
    const counts = new Array(N).fill(0);
    for (let i = 0; i < samples; i++) counts[pickParentIndex(rng, N)]++;

    // Folding the exponential tail back around gives a geometric distribution
    // over ranks: P(k) = (e^(-k/N) - e^(-(k+1)/N)) / (1 - e^-1).
    const expected = (k: number) =>
      (Math.exp(-k / N) - Math.exp(-(k + 1) / N)) / (1 - Math.exp(-1));

    expect(Math.max(...counts)).toBe(counts[0]);
    for (let k = 0; k < N; k++) {
      expect(counts[k] / samples).toBeCloseTo(expected(k), 2);
    }
    // The better half of the population supplies most of the parents.
    const topHalf = counts.slice(0, N / 2).reduce((a, b) => a + b, 0) / samples;
    expect(topHalf).toBeGreaterThan(0.6);
  });

  it('always returns an in-range index', () => {
    const rng = rngFromSeed('range');
    let min = Infinity;
    let max = -Infinity;
    let allIntegers = true;
    for (let i = 0; i < 50_000; i++) {
      const idx = pickParentIndex(rng, 20);
      if (idx < min) min = idx;
      if (idx > max) max = idx;
      if (!Number.isInteger(idx)) allIntegers = false;
    }
    expect({ min, max, allIntegers }).toEqual({ min: 0, max: 19, allIntegers: true });
  });
});

describe('nextGeneration', () => {
  const makeScores = (rng: () => number, n: number): CarScore[] =>
    Array.from({ length: n }, (_, i) => ({
      def: randomCar(rng),
      score: rng() * 100,
      avgSpeed: 1,
      distance: i,
      maxY: 0,
      minY: 0,
      isElite: false,
    }));

  it('carries the best cars through as elites, by value', () => {
    const rng = rngFromSeed('elites');
    const scores = makeScores(rng, 20);
    const best = sortByScore(scores)[0]!;
    const gen = nextGeneration(scores, {
      populationSize: 20,
      mutationRate: 0.05,
      mutationSize: 1,
      eliteCount: 3,
    }, rng);

    expect(gen).toHaveLength(20);
    expect(gen.filter((e) => e.isElite)).toHaveLength(3);
    expect(gen[0]!.def).toEqual(best.def);
    // Cloned, not shared: mutating the new generation must not touch the old.
    gen[0]!.def.vertices[0]!.x = 42;
    expect(best.def.vertices[0]!.x).not.toBe(42);
  });

  it('produces valid cars and respects population size', () => {
    const rng = rngFromSeed('gen');
    let scores = makeScores(rng, 20);
    for (let g = 0; g < 25; g++) {
      const gen = nextGeneration(scores, {
        populationSize: 16,
        mutationRate: 0.2,
        mutationSize: 0.6,
        eliteCount: 2,
      }, rng);
      expect(gen).toHaveLength(16);
      gen.forEach((entry, i) => {
        expect(entry.index).toBe(i);
        expectValidCar(entry.def);
      });
      scores = gen.map((e, i) => ({
        def: e.def,
        score: rng() * 100,
        avgSpeed: 1,
        distance: i,
        maxY: 0,
        minY: 0,
        isElite: e.isElite,
      }));
    }
  });

  it('clamps elite count to the population', () => {
    const rng = rngFromSeed('clamp');
    const gen = nextGeneration(makeScores(rng, 20), {
      populationSize: 5,
      mutationRate: 0.05,
      mutationSize: 1,
      eliteCount: 10,
    }, rng);
    expect(gen).toHaveLength(5);
    expect(gen.every((e) => e.isElite)).toBe(true);
  });
});
