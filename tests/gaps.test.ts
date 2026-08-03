/**
 * Gaps have to be real, not drawn.
 *
 * A hole that only exists in the renderer is worse than no hole at all: cars
 * sail over invisible ground and the track code lies about what it describes.
 */

import { describe, expect, it } from 'vitest';

import { Simulation } from '../src/sim/simulation';
import { generateTrackFromSpec } from '../src/sim/track';
import { defaultSpec, type TrackSpec } from '../src/track/spec';

/** Static bodies in the world, which is the track and nothing else. */
function staticBodies(sim: Simulation): number {
  let count = 0;
  for (let body = sim.world.getBodyList(); body; body = body.getNext()) {
    if (body.isStatic()) count++;
  }
  return count;
}

const gappy: TrackSpec = { ...defaultSpec('holes'), tiles: 300, gaps: 0.2 };
const solid: TrackSpec = { ...defaultSpec('holes'), tiles: 300, gaps: 0 };

describe('gaps in the road', () => {
  it('builds one collider per solid tile and none for a gap', () => {
    const sim = new Simulation({ trackSeed: 'holes' });
    sim.setTrackSpec(gappy);

    const track = generateTrackFromSpec(gappy);
    const expected = track.tiles.filter((tile) => tile.solid).length;
    expect(expected).toBeLessThan(300);
    expect(staticBodies(sim)).toBe(expected);
  });

  it('builds a collider for every tile when there are no gaps', () => {
    const sim = new Simulation({ trackSeed: 'holes' });
    sim.setTrackSpec(solid);
    expect(staticBodies(sim)).toBe(300);
  });

  it('leaves fewer colliders than a solid track of the same length', () => {
    const withHoles = new Simulation({ trackSeed: 'holes' });
    withHoles.setTrackSpec(gappy);
    const without = new Simulation({ trackSeed: 'holes' });
    without.setTrackSpec(solid);
    expect(staticBodies(withHoles)).toBeLessThan(staticBodies(without));
  });

  it('drops a car that drives into one', () => {
    // A long flat run, then nothing. Anything that reaches the hole falls in,
    // and the surface height at that point proves it was not simply stopped.
    const sim = new Simulation({ trackSeed: 'cliff', runSeed: 'cliff' });
    const spec = { ...defaultSpec('cliff'), tiles: 120, hills: 0, gaps: 0.35 };
    sim.setTrackSpec(spec);

    // Sampled as it runs: a car that falls in is dead and destroyed by the
    // time the generation ends, so there is nothing left to measure afterwards.
    let lowest = Infinity;
    for (let i = 0; i < 60 * 40 && sim.generation === 0; i++) {
      sim.step();
      for (const car of sim.cars) {
        if (car.alive && car.chassis) lowest = Math.min(lowest, car.chassis.getPosition().y);
      }
    }

    const groundLevel = Math.min(...sim.track.surface.map((p) => p.y));
    // Somebody ended up below every piece of ground there is, which can only
    // happen through a hole.
    expect(lowest).toBeLessThan(groundLevel - 1);
  });
});
