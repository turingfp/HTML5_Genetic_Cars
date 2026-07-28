import { describe, expect, it } from 'vitest';

import { MAX_CAR_HEALTH } from '../src/config';
import { Simulation, createSnapshot } from '../src/sim/simulation';

describe('Simulation', () => {
  it('builds a world with a full population', () => {
    const sim = new Simulation({ trackSeed: 'test-track', runSeed: 'test-run' });
    expect(sim.cars).toHaveLength(20);
    expect(sim.aliveCount).toBe(20);
    for (const car of sim.cars) {
      expect(car.chassis).not.toBeNull();
      expect(car.wheels).not.toBeNull();
      expect(car.chassis!.getMass()).toBeGreaterThan(0);
    }
  });

  it('drives cars forward and eventually ends the generation', () => {
    const sim = new Simulation({ trackSeed: 'drive', runSeed: 'drive' });
    let furthest = 0;
    sim.onGenerationEnd = (scores) => {
      furthest = Math.max(...scores.map((s) => s.distance));
    };

    let ended = false;
    let steps = 0;
    // A generation cannot outlast one health bar past the last bit of progress,
    // but give it plenty of room.
    const limit = MAX_CAR_HEALTH * 30;
    while (!ended && steps < limit) {
      ended = sim.step();
      steps++;
    }

    expect(ended).toBe(true);
    expect(sim.generation).toBe(1);
    // At least one car in a random population of 20 should get somewhere.
    expect(furthest).toBeGreaterThan(2);
    // The counter resets for the fresh generation that just spawned.
    expect(sim.bestX).toBe(0);
  });

  it('produces finite scores for every car and respawns a full grid', () => {
    const sim = new Simulation({ trackSeed: 'scores', runSeed: 'scores' });
    const finished: number[] = [];
    sim.onGenerationEnd = (scores) => {
      expect(scores).toHaveLength(20);
      for (const s of scores) {
        expect(Number.isFinite(s.score)).toBe(true);
        expect(Number.isFinite(s.distance)).toBe(true);
        expect(s.score).toBeGreaterThanOrEqual(s.distance);
      }
      finished.push(scores.length);
    };

    for (let i = 0; i < MAX_CAR_HEALTH * 60 && sim.generation < 3; i++) sim.step();

    expect(sim.generation).toBeGreaterThanOrEqual(3);
    expect(finished.length).toBeGreaterThanOrEqual(3);
    expect(sim.aliveCount).toBe(20);
    expect(sim.cars.filter((c) => c.isElite)).toHaveLength(1);
  });

  it('improves over many generations', () => {
    const sim = new Simulation({
      trackSeed: 'evolve',
      runSeed: 'evolve',
      params: { eliteCount: 2 },
    });
    const bests: number[] = [];
    sim.onGenerationEnd = (scores) => {
      bests.push(Math.max(...scores.map((s) => s.score)));
    };

    for (let i = 0; i < 400_000 && bests.length < 12; i++) sim.step();
    expect(bests.length).toBeGreaterThanOrEqual(12);

    // Elitism means the running best can never fall.
    const runningBest = bests.map((_, i) => Math.max(...bests.slice(0, i + 1)));
    for (let i = 1; i < runningBest.length; i++) {
      expect(runningBest[i]!).toBeGreaterThanOrEqual(runningBest[i - 1]!);
    }
    // And evolution should actually find something better than generation zero.
    expect(Math.max(...bests)).toBeGreaterThan(bests[0]!);
  }, 120_000);

  it('fills snapshots with copied values, not live physics vectors', () => {
    const sim = new Simulation({ trackSeed: 'snap', runSeed: 'snap' });
    const snap = createSnapshot();

    for (let i = 0; i < 120; i++) sim.step();
    sim.snapshot(snap);

    expect(snap.cars).toHaveLength(20);
    expect(snap.generation).toBe(0);
    expect(snap.frame).toBe(120);
    expect(snap.leaderIndex).toBeGreaterThanOrEqual(0);

    const leaderX = snap.leaderX;
    const carX = snap.cars[snap.leaderIndex]!.chassis.x;

    // Stepping again must not retroactively change the old snapshot.
    for (let i = 0; i < 60; i++) sim.step();
    expect(snap.leaderX).toBe(leaderX);
    expect(snap.cars[snap.leaderIndex]!.chassis.x).toBe(carX);

    for (const car of snap.cars) {
      expect(car.health01).toBeGreaterThanOrEqual(0);
      expect(car.health01).toBeLessThanOrEqual(1);
    }
  });

  it('records a replay frame per step for each car', () => {
    const sim = new Simulation({ trackSeed: 'replay', runSeed: 'replay' });
    for (let i = 0; i < 50; i++) sim.step();
    // One frame at spawn plus one per step, for cars still alive throughout.
    const alive = sim.cars.filter((c) => c.alive);
    expect(alive.length).toBeGreaterThan(0);
    for (const car of alive) {
      expect(sim.recorders[sim.cars.indexOf(car)]!.frameCount).toBe(51);
    }
  });

  it('rebuilds the world for a new track seed', () => {
    const sim = new Simulation({ trackSeed: 'first', runSeed: 'r' });
    for (let i = 0; i < 100; i++) sim.step();
    const firstTiles = sim.track.tiles;

    sim.setTrack('second');
    expect(sim.trackSeed).toBe('second');
    expect(sim.track.tiles).not.toEqual(firstTiles);
    expect(sim.generation).toBe(0);
    expect(sim.aliveCount).toBe(20);
    expect(sim.frame).toBe(0);
    expect(() => sim.step()).not.toThrow();
  });

  it('honours a custom population size', () => {
    const sim = new Simulation({
      trackSeed: 'pop',
      runSeed: 'pop',
      params: { populationSize: 8, eliteCount: 3 },
    });
    expect(sim.cars).toHaveLength(8);
    for (let i = 0; i < MAX_CAR_HEALTH * 40 && sim.generation < 1; i++) sim.step();
    expect(sim.generation).toBe(1);
    expect(sim.cars).toHaveLength(8);
    expect(sim.cars.filter((c) => c.isElite)).toHaveLength(3);
  }, 60_000);
});
