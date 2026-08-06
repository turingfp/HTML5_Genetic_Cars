/**
 * Gaps have to be real, not drawn.
 *
 * A hole that only exists in the renderer is worse than no hole at all: cars
 * sail over invisible ground and the track code lies about what it describes.
 */

import { describe, expect, it } from 'vitest';
import { generateTrack3DFromSpec } from '../src/sim3d/track3d';
import { buildRoadGeometry } from '../src/render3d/road';


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


describe('how gaps look and lie', () => {
  const gappy = { seed: 'sliver', tiles: 300, hills: 1, ramps: 0, gaps: 0.25, bank: 1, width: 1, debris: 0 };

  it('never leaves a single tile of road standing between two holes', () => {
    // A 1.5m island between gaps is barely enough road to land on, and from
    // the camera it reads as a floating shard of broken geometry. Checked
    // across seeds at the heaviest gap setting the daily can produce and past.
    for (const seed of ['sliver', 'alpha', 'bravo', 'charlie', 'delta']) {
      const track = generateTrack3DFromSpec({ ...gappy, seed });
      const tiles = track.profile.tiles;
      for (let i = 1; i + 1 < tiles.length; i++) {
        const island = tiles[i]!.solid && !tiles[i - 1]!.solid && !tiles[i + 1]!.solid;
        expect(island, `tile ${i} of seed ${seed} is a one-tile island`).toBe(false);
      }
    }
  });

  it('caps the road at every cut, so a hole shows thickness rather than nothing', () => {
    const track = generateTrack3DFromSpec(gappy);
    const tiles = track.profile.tiles;
    const geometry = buildRoadGeometry(track);

    // Every solid segment costs 6 faces (top and two skirts, 2 triangles
    // each); every place the ribbon stops or starts costs one 2-triangle cap.
    // The road ends count as cuts too: the start line and the final edge were
    // exactly as hollow as a gap before this.
    const solidSegments = tiles.filter((t) => t.solid).length;
    let cuts = 0;
    for (let i = 0; i <= tiles.length; i++) {
      const before = i > 0 && tiles[i - 1]!.solid;
      const after = i < tiles.length && tiles[i]!.solid;
      if (before !== after) cuts++;
    }
    expect(cuts).toBeGreaterThan(2);

    const triangles = (geometry.getIndex()?.count ?? 0) / 3;
    expect(triangles).toBe(solidSegments * 6 + cuts * 2);
  });
});
