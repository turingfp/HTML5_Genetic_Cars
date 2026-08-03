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
import {
  DEFAULT_CROSSOVER,
  DEFAULT_GOAL,
  DEFAULT_SELECTION,
  carOps,
  countLineages,
  fitnessOf,
  nextGeneration,
  pickParent,
  pickParentIndex,
  sharedFitness,
  sortByScore,
  type CarScore,
  type GAParams,
} from '../src/ga/evolution';

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

/** Base parameters, so each test only states the knob it cares about. */
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

describe('nextGeneration', () => {
  const makeScores = (rng: () => number, n: number): CarScore[] =>
    Array.from({ length: n }, (_, i) => ({
      def: randomCar(rng),
      score: rng() * 100,
      avgSpeed: 1,
      distance: i,
      maxY: 0,
      minY: 0,
      mass: 100,
      isElite: false,
      lineage: i,
    }));

  it('carries the best cars through as elites, by value', () => {
    const rng = rngFromSeed('elites');
    const scores = makeScores(rng, 20);
    const best = sortByScore(scores)[0]!;
    const gen = nextGeneration(scores, params({ eliteCount: 3 }), rng);

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
      const gen = nextGeneration(
        scores,
        params({ populationSize: 16, mutationRate: 0.2, mutationSize: 0.6, eliteCount: 2 }),
        rng,
      );
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
        mass: 100,
        isElite: e.isElite,
        lineage: e.lineage,
      }));
    }
  });

  it('clamps elite count to the population', () => {
    const rng = rngFromSeed('clamp');
    const gen = nextGeneration(
      makeScores(rng, 20),
      params({ populationSize: 5, eliteCount: 10 }),
      rng,
    );
    expect(gen).toHaveLength(5);
    expect(gen.every((e) => e.isElite)).toBe(true);
  });

  it('fills the population even when a setting is missing', () => {
    // Params arrive from persisted settings, so a key added after someone last
    // opened the page shows up undefined. That used to become NaN and hand back
    // a generation containing only its elites.
    const rng = rngFromSeed('stale');
    const stale = { populationSize: 20, mutationRate: 0.05, mutationSize: 1, eliteCount: 1 };
    const gen = nextGeneration(makeScores(rng, 20), stale as GAParams, rng);
    expect(gen).toHaveLength(20);
    gen.forEach((entry) => expectValidCar(entry.def));
  });

  it('adds the requested number of newcomers', () => {
    const rng = rngFromSeed('immigrants');
    const scores = makeScores(rng, 20);
    const gen = nextGeneration(scores, params({ eliteCount: 2, immigrants: 5 }), rng, carOps, 1000);
    expect(gen).toHaveLength(20);
    // Newcomers found their own lines, numbered from where the caller said.
    const fresh = gen.filter((e) => e.lineage >= 1000);
    expect(fresh.length).toBeGreaterThanOrEqual(5);
    // And they take the last slots, so they never displace an elite.
    expect(gen.slice(-5).every((e) => e.lineage >= 1000)).toBe(true);
    expect(gen.filter((e) => e.isElite)).toHaveLength(2);
  });

  it('passes elite lines on to their children', () => {
    const rng = rngFromSeed('lines');
    const scores = makeScores(rng, 20);
    const gen = nextGeneration(scores, params({ eliteCount: 2 }), rng);
    const known = new Set(scores.map((s) => s.lineage));
    // Nobody invents a new line unless they are an immigrant, and there are
    // none here, so every car descends from someone who ran.
    for (const entry of gen) expect(known.has(entry.lineage)).toBe(true);
    expect(countLineages(scores)).toBe(20);
  });
});

describe('fitness goals', () => {
  const run = { distance: 50, avgSpeed: 4, maxY: 9, minY: -1, mass: 300 };

  it('scores the same run differently under each goal', () => {
    const scores = (['distance', 'speed', 'airtime', 'efficiency'] as const).map((g) =>
      fitnessOf(run, g),
    );
    expect(new Set(scores).size).toBe(4);
    expect(fitnessOf(run, 'distance')).toBe(50);
    expect(fitnessOf(run, 'speed')).toBe(54);
    // Ten metres of vertical range is worth a lot to a jumper.
    expect(fitnessOf(run, 'airtime')).toBe(50 + 60);
    // Twice the mass for the same distance is worth half as much.
    expect(fitnessOf({ ...run, mass: 600 }, 'efficiency')).toBeCloseTo(
      fitnessOf(run, 'efficiency') / 2,
      6,
    );
  });

  it('never divides by zero for a weightless car', () => {
    expect(Number.isFinite(fitnessOf({ ...run, mass: 0 }, 'efficiency'))).toBe(true);
  });
});

describe('selection methods', () => {
  const weights = Array.from({ length: 20 }, (_, i) => 20 - i);

  it('keeps every method inside the population', () => {
    const rng = rngFromSeed('methods');
    for (const method of ['rank', 'tournament', 'roulette'] as const) {
      for (let i = 0; i < 5000; i++) {
        const idx = pickParent(rng, method, 20, weights);
        expect(Number.isInteger(idx)).toBe(true);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(20);
      }
    }
  });

  it('ranks the three methods by how greedy they actually are', () => {
    // Worth pinning down, and worth measuring rather than assuming. The obvious
    // guess is that exponential rank selection is the greedy one, since it is
    // named after the ranking. It is not: with twenty cars it picks a top five
    // parent about a third of the time, where a tournament of three does so
    // well over half the time. Selecting the best of three random draws is a
    // harsher filter than an exponential over the whole field.
    const rng = rngFromSeed('greed');
    const share = (method: 'rank' | 'tournament' | 'roulette') => {
      let top = 0;
      const N = 30_000;
      for (let i = 0; i < N; i++) {
        if (pickParent(rng, method, 20, weights) < 5) top++;
      }
      return top / N;
    };
    const rank = share('rank');
    const tournament = share('tournament');
    const roulette = share('roulette');

    expect(tournament).toBeGreaterThan(roulette);
    expect(roulette).toBeGreaterThan(rank);
    // All three still beat picking a parent at random, which would be 5 in 20.
    expect(rank).toBeGreaterThan(5 / 20);
    // A tournament of three has a closed form: the chance that at least one of
    // three uniform draws lands in the top quarter.
    expect(tournament).toBeCloseTo(1 - Math.pow(15 / 20, 3), 2);
  });
});

describe('diversity pressure', () => {
  it('does nothing at zero', () => {
    const rng = rngFromSeed('nopressure');
    const scores = Array.from({ length: 10 }, (_, i) => ({
      def: randomCar(rng),
      score: 100 - i,
      avgSpeed: 1,
      distance: 1,
      maxY: 0,
      minY: 0,
      mass: 100,
      isElite: false,
      lineage: i,
    }));
    expect(sharedFitness(scores, 0, carOps)).toEqual(scores.map((s) => s.score));
  });

  it('penalises a car surrounded by copies of itself', () => {
    const rng = rngFromSeed('crowd');
    const common = randomCar(rng);
    const odd = randomCar(rng);
    const score = (def: typeof common, lineage: number) => ({
      def,
      score: 100,
      avgSpeed: 1,
      distance: 1,
      maxY: 0,
      minY: 0,
      mass: 100,
      isElite: false,
      lineage,
    });

    // Nine identical cars and one different one, all scoring the same.
    const ranked = [
      ...Array.from({ length: 9 }, (_, i) => score(cloneCar(common), i)),
      score(odd, 9),
    ];
    const shared = sharedFitness(ranked, 1, carOps);

    // The loner keeps far more of its fitness than any member of the crowd.
    expect(shared[9]!).toBeGreaterThan(shared[0]! * 3);
    // And nothing goes negative, since roulette uses these as weights.
    for (const v of shared) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('calls a car identical to itself zero distance away', () => {
    const rng = rngFromSeed('selfsame');
    const def = randomCar(rng);
    expect(carOps.distance(def, cloneCar(def))).toBe(0);
    expect(carOps.distance(def, randomCar(rng))).toBeGreaterThan(0);
  });
});

describe('crossover modes', () => {
  it('clones one parent whole when asexual', () => {
    const rng = rngFromSeed('asexual');
    for (let i = 0; i < 50; i++) {
      const a = randomCar(rng);
      const b = randomCar(rng);
      const child = crossover(rng, a, b, 'none');
      const matches = (p: CarDef) =>
        p.spokes.every(
          (s, k) =>
            s.length === child.spokes[k]!.length && s.angle === child.spokes[k]!.angle,
        );
      expect(matches(a) || matches(b)).toBe(true);
    }
  });

  it('mixes harder when uniform', () => {
    // Two point inherits runs of neighbouring corners, so it changes parent at
    // most twice. Uniform can change at every corner.
    const rng = rngFromSeed('uniform');
    const a = randomCar(rng);
    const b = randomCar(rng);
    let twoPointSwitches = 0;
    let uniformSwitches = 0;
    const switches = (child: CarDef) => {
      let count = 0;
      let previous: number | null = null;
      for (let k = 0; k < child.spokes.length; k++) {
        const from = child.spokes[k]!.length === a.spokes[k]!.length ? 0 : 1;
        if (previous !== null && from !== previous) count++;
        previous = from;
      }
      return count;
    };
    for (let i = 0; i < 200; i++) {
      twoPointSwitches += switches(crossover(rng, a, b, 'two-point'));
      uniformSwitches += switches(crossover(rng, a, b, 'uniform'));
    }
    expect(uniformSwitches).toBeGreaterThan(twoPointSwitches);
  });
});
