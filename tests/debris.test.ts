/**
 * Loose crates.
 *
 * The claim is that these are real bodies rather than scenery, so the tests are
 * about the things scenery cannot do: settle under gravity, get moved by a car,
 * and be back where they started when the next generation begins.
 */

import { describe, expect, it } from 'vitest';

import { normaliseSpec } from '../src/track/spec';
import { crateSpots } from '../src/sim3d/debris';
import { generateTrack3DFromSpec } from '../src/sim3d/track3d';
import { Simulation3D } from '../src/sim3d/simulation3d';
import { surfaceIndexAt } from '../src/sim/track';

const withCrates = (seed: string, debris = 0.25) =>
  normaliseSpec({ seed, tiles: 140, hills: 0.8, bank: 0.6, width: 1.2, debris });

describe('where crates go', () => {
  it('are placed the same way for everyone on the same track', () => {
    const spec = withCrates('shared');
    const a = crateSpots(generateTrack3DFromSpec(spec));
    const b = crateSpots(generateTrack3DFromSpec(spec));
    expect(a.length).toBeGreaterThan(3);
    expect(a).toEqual(b);
  });

  it('never sit on a hole or in front of the start line', () => {
    const track = generateTrack3DFromSpec(withCrates('holes', 0.4));
    for (const spot of crateSpots(track)) {
      expect(spot.x).toBeGreaterThanOrEqual(10);
      // Wholly on the road, not perched over an edge.
      expect(Math.abs(spot.z)).toBeLessThan(track.halfWidth);
    }
  });

  it('scale with the knob, and vanish at zero', () => {
    const few = crateSpots(generateTrack3DFromSpec(withCrates('amount', 0.05)));
    const many = crateSpots(generateTrack3DFromSpec(withCrates('amount', 0.35)));
    expect(many.length).toBeGreaterThan(few.length);
    expect(crateSpots(generateTrack3DFromSpec(withCrates('amount', 0)))).toHaveLength(0);
  });
});

describe('crates in the world', () => {
  it('settle on the road instead of falling through it', async () => {
    const sim = await Simulation3D.create({ runSeed: 'settle' });
    sim.setTrackSpec(withCrates('settle'));
    expect(sim.crates.length).toBeGreaterThan(3);
    const before = sim.crates.map((c) => ({ ...c.getPosition() }));

    // A second and a half. Long enough to land, short enough that no car has
    // reached one and nothing has had time to creep: a longer window measures
    // crates sliding down a descending road and crates being knocked forty
    // metres by the pack, both of which are the point rather than the bug.
    for (let i = 0; i < 90; i++) sim.step();
    const surface = sim.track.profile.surface;

    // Resting on the road, not sitting near where it spawned: a crate on a
    // descending stretch slides a little and that is honest. What must not
    // happen is leaving the surface. A crate spawned *under* a banked road
    // gets ejected and falls for ever, which is what the first version of this
    // placement did by putting them at the centreline height and offsetting
    // them sideways: they reached eighty metres down.
    for (const crate of sim.crates) {
      const p = crate.getPosition();
      const road = surface[Math.min(surfaceIndexAt(sim.track.profile, p.x), surface.length - 1)]!;
      expect(p.y - road.y).toBeGreaterThan(-1);
      expect(p.y - road.y).toBeLessThan(2);
    }
    expect(before).toHaveLength(sim.crates.length);
  }, 60_000);

  it('get shoved about, which scenery does not', async () => {
    const sim = await Simulation3D.create({ runSeed: 'shove' });
    sim.setTrackSpec(withCrates('shove'));
    const before = sim.crates.map((c) => ({ ...c.getPosition() }));

    // Long enough for the pack to reach the first of them.
    for (let i = 0; i < 1800; i++) sim.step();

    const moved = sim.crates.filter((crate, i) => {
      const now = crate.getPosition();
      const was = before[i]!;
      return Math.hypot(now.x - was.x, now.y - was.y, now.z - was.z) > 0.25;
    });
    expect(moved.length).toBeGreaterThan(0);
  }, 120_000);

  it('are back in place for the next generation', async () => {
    const sim = await Simulation3D.create({ runSeed: 'reset' });
    sim.setTrackSpec(withCrates('reset'));
    const spots = crateSpots(sim.track);

    const start = sim.generation;
    let steps = 0;
    while (sim.generation === start && steps < 200_000) {
      sim.step();
      steps++;
    }
    expect(sim.generation).toBe(start + 1);

    // Every car in a generation should meet the same course, not whatever the
    // one before it left behind.
    expect(sim.crates.length).toBe(spots.length);
    for (let i = 0; i < sim.crates.length; i++) {
      const p = sim.crates[i]!.getPosition();
      // Three places, not more: the engine stores positions as float32, so
      // "back where it started" is exact to about a micrometre and no further.
      expect(p.x).toBeCloseTo(spots[i]!.x, 3);
      expect(p.z).toBeCloseTo(spots[i]!.z, 3);
    }
  }, 120_000);
});
