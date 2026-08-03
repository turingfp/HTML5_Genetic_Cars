import { describe, expect, it } from 'vitest';

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_DENSITY_MIN,
  CHASSIS_DENSITY_RANGE,
  CHASSIS_VERTEX_COUNT,
  MAX_WHEEL_COUNT,
  MIN_WHEEL_COUNT,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../src/config';
import { mulberry32, rngFromSeed } from '../src/core/rng';
import { cloneCar, crossover, mutate, randomCar, type CarDef } from '../src/ga/genome';
import { nextGeneration, pickParentIndex, sortByScore, type CarScore } from '../src/ga/evolution';

const EPS = 1e-9;

/** A corner's distance from the centre, whatever direction it points in. */
function withinReachBounds(x: number, y: number): boolean {
  const r = Math.hypot(x, y);
  return r >= CHASSIS_AXIS_MIN - EPS && r < CHASSIS_AXIS_MIN + CHASSIS_AXIS_RANGE + EPS;
}

/** Angle of a corner, normalised into [0, 2pi). */
function angleOf(x: number, y: number): number {
  const a = Math.atan2(y, x);
  return a < 0 ? a + Math.PI * 2 : a;
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
  if (def.wheels.length < MIN_WHEEL_COUNT || def.wheels.length > MAX_WHEEL_COUNT) {
    return `wheel count out of range: ${def.wheels.length}`;
  }

  const seen = new Set<number>();
  for (let i = 0; i < def.wheels.length; i++) {
    const wheel = def.wheels[i]!;
    if (
      !(wheel.radius >= WHEEL_RADIUS_MIN - EPS &&
        wheel.radius < WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE + EPS)
    ) {
      return `wheel ${i} radius out of range: ${wheel.radius}`;
    }
    if (
      !(wheel.density >= WHEEL_DENSITY_MIN - EPS &&
        wheel.density < WHEEL_DENSITY_MIN + WHEEL_DENSITY_RANGE + EPS)
    ) {
      return `wheel ${i} density out of range: ${wheel.density}`;
    }
    if (
      !(Number.isInteger(wheel.vertex) &&
        wheel.vertex >= 0 &&
        wheel.vertex < CHASSIS_VERTEX_COUNT)
    ) {
      return `wheel ${i} vertex out of range: ${wheel.vertex}`;
    }
    // Two wheels on one corner is a unicycle that cannot drive.
    if (seen.has(wheel.vertex)) return `two wheels share vertex ${wheel.vertex}`;
    seen.add(wheel.vertex);
  }

  if (
    !(def.chassisDensity >= CHASSIS_DENSITY_MIN - EPS &&
      def.chassisDensity < CHASSIS_DENSITY_MIN + CHASSIS_DENSITY_RANGE + EPS)
  ) {
    return `chassis density out of range: ${def.chassisDensity}`;
  }

  if (def.spokes.length !== CHASSIS_VERTEX_COUNT) {
    return `expected ${CHASSIS_VERTEX_COUNT} spokes, got ${def.spokes.length}`;
  }
  if (def.vertices.length !== CHASSIS_VERTEX_COUNT) {
    return `expected ${CHASSIS_VERTEX_COUNT} vertices, got ${def.vertices.length}`;
  }
  for (let i = 0; i < def.spokes.length; i++) {
    const spoke = def.spokes[i]!;
    if (!(spoke.angle >= -1 - EPS && spoke.angle <= 1 + EPS)) {
      return `spoke ${i} angle out of range: ${spoke.angle}`;
    }
    const v = def.vertices[i]!;
    if (!withinReachBounds(v.x, v.y)) return `vertex ${i} out of reach: ${v.x},${v.y}`;
  }

  // The corners must stay in counter-clockwise order, or the fan of triangles
  // the chassis is built from stops being convex. Compared as signed steps
  // rather than raw angles: corner 0 straddles zero, so its absolute angle can
  // read as either side of 2pi.
  for (let i = 1; i < def.vertices.length; i++) {
    const prev = def.vertices[i - 1]!;
    const here = def.vertices[i]!;
    let step = angleOf(here.x, here.y) - angleOf(prev.x, prev.y);
    if (step > Math.PI) step -= Math.PI * 2;
    if (step < -Math.PI) step += Math.PI * 2;
    if (step <= 0) {
      return `vertex ${i} is not past vertex ${i - 1} around the circle`;
    }
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

  it('keeps every corner inside its own sector', () => {
    // The original pinned corners to fixed compass directions. They can now
    // swing, but never past the middle of a neighbouring sector, which is what
    // keeps them in order.
    const rng = rngFromSeed('sectors');
    const sector = (Math.PI * 2) / CHASSIS_VERTEX_COUNT;
    for (let n = 0; n < 200; n++) {
      const def = randomCar(rng);
      for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
        const v = def.vertices[i]!;
        let offset = angleOf(v.x, v.y) - i * sector;
        if (offset > Math.PI) offset -= Math.PI * 2;
        if (offset < -Math.PI) offset += Math.PI * 2;
        expect(Math.abs(offset)).toBeLessThan(sector / 2 + EPS);
      }
    }
  });

  it('varies the number of wheels', () => {
    const rng = rngFromSeed('counts');
    const counts = new Set<number>();
    for (let i = 0; i < 200; i++) counts.add(randomCar(rng).wheels.length);
    // A population that is always two wheeled would be the old genome.
    expect(counts.size).toBeGreaterThan(1);
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(MIN_WHEEL_COUNT);
      expect(c).toBeLessThanOrEqual(MAX_WHEEL_COUNT);
    }
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
    expect(def.wheels).toHaveLength(before.wheels.length);
    expect(Math.abs(def.wheels[0]!.radius - before.wheels[0]!.radius)).toBeLessThan(
      WHEEL_RADIUS_RANGE * 0.02 + EPS,
    );
    expect(Math.abs(def.wheels[0]!.density - before.wheels[0]!.density)).toBeLessThan(
      WHEEL_DENSITY_RANGE * 0.02 + EPS,
    );
  });

  it('sometimes adds or removes a wheel', () => {
    // Structural change is throttled by the mutation size as well as the rate,
    // so this uses both at full to show it happens at all.
    const rng = rngFromSeed('structure');
    let changed = 0;
    for (let i = 0; i < 400; i++) {
      const def = randomCar(rng);
      const before = def.wheels.length;
      mutate(rng, def, { rate: 1, size: 1 });
      if (def.wheels.length !== before) changed++;
    }
    expect(changed).toBeGreaterThan(0);
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

      // The wheel count comes from one parent or the other.
      expect([a.wheels.length, b.wheels.length]).toContain(child.wheels.length);

      for (let k = 0; k < child.wheels.length; k++) {
        const wheel = child.wheels[k]!;
        const sources = [a.wheels[k], b.wheels[k]].filter((w) => w !== undefined);
        expect(sources.map((w) => w!.radius)).toContain(wheel.radius);
        expect(sources.map((w) => w!.density)).toContain(wheel.density);
      }

      // Chassis corners are inherited whole, angle and length together.
      for (let v = 0; v < CHASSIS_VERTEX_COUNT; v++) {
        expect([a.spokes[v]!.length, b.spokes[v]!.length]).toContain(child.spokes[v]!.length);
        expect([a.spokes[v]!.angle, b.spokes[v]!.angle]).toContain(child.spokes[v]!.angle);
      }
      expect([a.chassisDensity, b.chassisDensity]).toContain(child.chassisDensity);
    }
  });

  it('does not alias parent spoke or wheel objects', () => {
    const rng = rngFromSeed('alias');
    const a = randomCar(rng);
    const b = randomCar(rng);
    const child = crossover(rng, a, b);
    child.spokes[0]!.length = 999;
    child.wheels[0]!.radius = 999;
    expect(a.spokes[0]!.length).not.toBe(999);
    expect(b.spokes[0]!.length).not.toBe(999);
    expect(a.wheels[0]!.radius).not.toBe(999);
    expect(b.wheels[0]!.radius).not.toBe(999);
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
    gen[0]!.def.spokes[0]!.length = 42;
    expect(best.def.spokes[0]!.length).not.toBe(42);
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
