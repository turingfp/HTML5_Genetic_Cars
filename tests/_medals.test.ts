import { describe, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import { defaultSpec, medalFor } from '../src/track/spec';

describe('reachable', () => {
  it('measures how far a population gets on the default course', () => {
    for (const tiles of [200, 120, 90]) {
      const spec = { ...defaultSpec('classic'), tiles };
      let best = 0;
      let length = 0;
      for (const seed of ['a', 'b', 'c']) {
        const sim = new Simulation({ trackSeed: seed, runSeed: seed });
        sim.setTrackSpec({ ...spec, seed });
        length = sim.track.length;
        while (sim.generation < 30) sim.step();
        best = Math.max(best, sim.bestX);
      }
      console.log(
        `${tiles} tiles (${length.toFixed(0)}m): best ${best.toFixed(0)}m = ` +
          `${((best / length) * 100).toFixed(0)}% -> ${medalFor(best, length) ?? 'nothing'}`,
      );
    }
  }, 900_000);
});
