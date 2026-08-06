/**
 * When a generation is allowed to end.
 *
 * Two rules stop a round dragging on. Each car must keep gaining its own new
 * ground (see health.test.ts), and the round as a whole ends once the furthest
 * point reached stops advancing. The second rule exists because the first is
 * not enough: a pack of slow cars can each satisfy it indefinitely while the
 * frontier never moves. Before it, a 3D generation on this track ran the full
 * 90 second cap with its last real progress at 9 seconds.
 */

import { describe, expect, it } from 'vitest';

import { MAX_GENERATION_SECONDS, PHYSICS_HZ, STALL_SECONDS } from '../src/config';
import { Simulation } from '../src/sim/simulation';
import { Simulation3D } from '../src/sim3d/simulation3d';

interface Round {
  seconds: number;
  wastedSeconds: number;
}

/** Run one generation, reporting how long it ran and how much was dead time. */
function runGeneration(sim: {
  step(): boolean;
  bestX: number;
}): Round {
  let frames = 0;
  let lastProgress = 0;
  let best = 0;
  let ended = false;
  const limit = MAX_GENERATION_SECONDS * PHYSICS_HZ * 2;

  while (!ended && frames < limit) {
    ended = sim.step();
    frames++;
    if (sim.bestX > best + 0.05) {
      best = sim.bestX;
      lastProgress = frames;
    }
  }

  expect(ended).toBe(true);
  return {
    seconds: frames / PHYSICS_HZ,
    wastedSeconds: (frames - lastProgress) / PHYSICS_HZ,
  };
}

/** A little slack over the stall window for the final step and rounding. */
const TOLERANCE = 1.5;

describe('generation length', () => {
  it('ends a flat round soon after the frontier stops moving', () => {
    const sim = new Simulation({ trackSeed: 'ridge', runSeed: 'r' });
    for (let g = 0; g < 4; g++) {
      const round = runGeneration(sim);
      expect(round.wastedSeconds).toBeLessThan(STALL_SECONDS + TOLERANCE);
      expect(round.seconds).toBeLessThan(MAX_GENERATION_SECONDS);
    }
  }, 60_000);

  it('ends a 3D round soon after the frontier stops moving', async () => {
    const sim = await Simulation3D.create({ trackSeed: 'ridge', runSeed: 'r' });
    for (let g = 0; g < 4; g++) {
      const round = runGeneration(sim);
      expect(round.wastedSeconds).toBeLessThan(STALL_SECONDS + TOLERANCE);
      // This is the case that used to run the full cap for 80 seconds of nothing.
      expect(round.seconds).toBeLessThan(30);
    }
    sim.dispose();
  }, 120_000);

  it('still lets a productive round run on', () => {
    // The rule must not cut short a generation that keeps making progress: the
    // window only starts once nothing new has happened.
    const sim = new Simulation({ trackSeed: 'ridge', runSeed: 'r' });
    const round = runGeneration(sim);
    expect(round.seconds).toBeGreaterThan(STALL_SECONDS + 1);
  }, 60_000);
});
