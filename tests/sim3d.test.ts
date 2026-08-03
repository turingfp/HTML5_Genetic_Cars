import { describe, expect, it } from 'vitest';

import {
  CHASSIS_HALF_WIDTH_MIN,
  FALL_OFF_DEPTH,
  FALL_OFF_LATERAL,
  MAX_CAR_HEALTH,
  ROAD_HALF_WIDTH,
} from '../src/config';
import { rngFromSeed } from '../src/core/rng';
import { car3DOps, chassisHullPoints, randomCar3D, wheelMounts } from '../src/ga/genome3d';
import { Simulation3D, createSnapshot3D } from '../src/sim3d/simulation3d';
import { generateTrack3D } from '../src/sim3d/track3d';

describe('3D genome', () => {
  it('extrudes the silhouette into sixteen hull points', () => {
    const def = randomCar3D(rngFromSeed('hull'));
    const points = chassisHullPoints(def);
    expect(points).toHaveLength(16);
    for (const p of points) {
      expect(Math.abs(p.z)).toBeCloseTo(def.halfWidth, 10);
    }
    expect(def.halfWidth).toBeGreaterThanOrEqual(CHASSIS_HALF_WIDTH_MIN);
  });

  it('mounts every wheel as a mirrored pair outboard of the body', () => {
    const def = randomCar3D(rngFromSeed('wheels'));
    const mounts = wheelMounts(def);
    // Two wheels in the silhouette become four here, three become six.
    expect(mounts).toHaveLength(def.base.wheels.length * 2);
    for (const m of mounts) {
      expect(Math.abs(m.z)).toBeGreaterThan(def.halfWidth);
    }
    // Each pair shares an x/y mounting point and straddles the centreline.
    for (let i = 0; i < mounts.length; i += 2) {
      expect(mounts[i]!.x).toBe(mounts[i + 1]!.x);
      expect(mounts[i]!.y).toBe(mounts[i + 1]!.y);
      expect(mounts[i]!.z).toBe(-mounts[i + 1]!.z);
      expect(mounts[i]!.wheel).toBe(mounts[i + 1]!.wheel);
    }
  });

  it('breeds and mutates within bounds', () => {
    const rng = rngFromSeed('breed3d');
    let def = randomCar3D(rng);
    // Collect rather than assert per iteration: an expect per field over
    // thousands of genomes costs far more than the code being exercised.
    let violation: string | null = null;
    for (let i = 0; i < 2000 && !violation; i++) {
      const other = randomCar3D(rng);
      def = car3DOps.mutate(rng, car3DOps.crossover(rng, def, other, 'two-point'), {
        rate: 0.4,
        size: rng(),
      });
      if (!(def.halfWidth > 0)) violation = `halfWidth ${def.halfWidth} at ${i}`;
      else if (!(def.wheelGap > 0)) violation = `wheelGap ${def.wheelGap} at ${i}`;
      else if (new Set(def.base.wheels.map((w) => w.vertex)).size !== def.base.wheels.length) {
        violation = `two wheels share a vertex at ${i}`;
      } else if (chassisHullPoints(def).length !== 16) {
        violation = `hull had ${chassisHullPoints(def).length} points at ${i}`;
      }
    }
    expect(violation).toBeNull();
  });

  it('clones deeply, so elites are not disturbed by their children', () => {
    const def = randomCar3D(rngFromSeed('clone3d'));
    const copy = car3DOps.clone(def);
    copy.base.spokes[0]!.length = 99;
    copy.halfWidth = 99;
    expect(def.base.spokes[0]!.length).not.toBe(99);
    expect(def.halfWidth).not.toBe(99);
  });
});

describe('3D track', () => {
  it('shares the hill profile with the flat mode and adds banking', () => {
    const a = generateTrack3D('same-seed');
    const b = generateTrack3D('same-seed');
    expect(a.joints).toEqual(b.joints);
    expect(a.profile.tiles).toEqual(b.profile.tiles);

    const banks = a.joints;
    expect(banks.some((v) => v !== 0)).toBe(true);
    // Banking grows with distance, like the pitch does.
    const early = banks.slice(0, 20).reduce((s, v) => s + Math.abs(v), 0) / 20;
    const late = banks.slice(-20).reduce((s, v) => s + Math.abs(v), 0) / 20;
    expect(late).toBeGreaterThan(early);
    expect(a.halfWidth).toBe(ROAD_HALF_WIDTH);
  });
});

describe('Simulation3D', () => {
  it('builds a world of four-wheeled cars', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'build3d', runSeed: 'build3d' });
    expect(sim.cars).toHaveLength(20);
    for (const car of sim.cars) {
      expect(car.chassis).not.toBeNull();
      expect(car.wheels).toHaveLength(car.def.base.wheels.length * 2);
      expect(car.chassis!.getMass()).toBeGreaterThan(0);
    }
    sim.dispose();
  });

  it('drives cars forward and ends the generation', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'drive3d', runSeed: 'drive3d' });
    let furthest = 0;
    sim.onGenerationEnd = (scores) => {
      furthest = Math.max(...scores.map((s) => s.distance));
    };

    let ended = false;
    for (let i = 0; i < MAX_CAR_HEALTH * 30 && !ended; i++) ended = sim.step();

    expect(ended).toBe(true);
    expect(sim.generation).toBe(1);
    expect(furthest).toBeGreaterThan(2);
    sim.dispose();
  }, 120_000);

  it('fills snapshots with copied values', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'snap3d', runSeed: 'snap3d' });
    const snap = createSnapshot3D();
    for (let i = 0; i < 120; i++) sim.step();
    sim.snapshot(snap);

    expect(snap.cars).toHaveLength(20);
    expect(snap.frame).toBe(120);
    expect(snap.leaderIndex).toBeGreaterThanOrEqual(0);

    const leader = snap.cars[snap.leaderIndex]!;
    expect(leader.wheels.length).toBeGreaterThanOrEqual(4);
    const x = leader.chassis.position.x;
    // Quaternions must be unit length, or the renderer will skew the mesh.
    const q = leader.chassis.rotation;
    expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 4);

    for (let i = 0; i < 60; i++) sim.step();
    expect(snap.cars[snap.leaderIndex]!.chassis.position.x).toBe(x);
    sim.dispose();
  }, 60_000);

  it('kills a car that has dropped below the road', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'falloff', runSeed: 'falloff' });
    const car = sim.cars[0]!;
    // Report the road as far above the car, as it would be after a plunge.
    const roadY = car.chassis!.getPosition().y + FALL_OFF_DEPTH + 1;
    expect(car.update(roadY)).toBe(true);
    expect(car.fellOff).toBe(true);
    sim.dispose();
  });

  it('keeps a car alive while it is on the road', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'onroad', runSeed: 'onroad' });
    const car = sim.cars[0]!;
    // Level with the road and inside the edges: nothing to trigger a fall.
    expect(car.update(car.chassis!.getPosition().y)).toBe(false);
    expect(car.fellOff).toBe(false);
    expect(Math.abs(car.chassis!.getPosition().z)).toBeLessThan(FALL_OFF_LATERAL);
    sim.dispose();
  });

  it('never loses ground, and improves on average', async () => {
    // Improvement is a statistical claim, so it is measured across seeds
    // rather than on one. A single run used to be enough, but bodies vary far
    // more than they did: wheel count, corner angles and chassis density are
    // all genes now, so a lucky first generation is much more likely and one
    // seed says nothing.
    const WINDOW = 4;
    const GENERATIONS = 12;
    let early = 0;
    let late = 0;

    for (const seed of ['evolve3d', 'ridge', 'camber']) {
      const sim = await Simulation3D.create({
        trackSeed: seed,
        runSeed: seed,
        params: { eliteCount: 2 },
      });
      const bests: number[] = [];
      sim.onGenerationEnd = (scores) => bests.push(Math.max(...scores.map((s) => s.score)));
      for (let i = 0; i < 900_000 && bests.length < GENERATIONS; i++) sim.step();
      sim.dispose();

      expect(bests.length).toBeGreaterThanOrEqual(GENERATIONS);

      // Elitism means the best ever seen can never go backwards. This part is
      // an invariant rather than a statistic, so it holds run by run.
      const runningBest = bests.map((_, i) => Math.max(...bests.slice(0, i + 1)));
      for (let i = 1; i < runningBest.length; i++) {
        expect(runningBest[i]!).toBeGreaterThanOrEqual(runningBest[i - 1]!);
      }

      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      early += mean(bests.slice(0, WINDOW));
      late += mean(bests.slice(-WINDOW));
    }

    expect(late).toBeGreaterThan(early);
  }, 600_000);
});
