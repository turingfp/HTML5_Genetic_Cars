/**
 * The built-in tracks have to actually be drivable, and each has to be its own
 * problem. A campaign of seven variations on the same course is no campaign.
 */

import { describe, expect, it } from 'vitest';

import { generateTrackFromSpec } from '../src/sim/track';
import { CAMPAIGN } from '../src/track/campaign';
import { decodeSpec, encodeSpec, normaliseSpec } from '../src/track/spec';

describe('the campaign', () => {
  it('has tracks with names and briefs', () => {
    expect(CAMPAIGN.length).toBeGreaterThanOrEqual(5);
    for (const track of CAMPAIGN) {
      expect(track.name.length).toBeGreaterThan(0);
      expect(track.brief.length).toBeGreaterThan(0);
    }
  });

  it('names each track once', () => {
    expect(new Set(CAMPAIGN.map((t) => t.name)).size).toBe(CAMPAIGN.length);
  });

  it('is made of ordinary specs, so any of them can be shared', () => {
    for (const track of CAMPAIGN) {
      expect(normaliseSpec(track.spec)).toEqual(track.spec);
      expect(decodeSpec(encodeSpec(track.spec))).toEqual(track.spec);
    }
  });

  it('builds terrain that advances, for every one of them', () => {
    for (const track of CAMPAIGN) {
      const built = generateTrackFromSpec(track.spec);
      expect(built.tiles).toHaveLength(track.spec.tiles);
      expect(built.length).toBeGreaterThan(0);
      for (let i = 1; i < built.surface.length; i++) {
        expect(built.surface[i]!.x).toBeGreaterThan(built.surface[i - 1]!.x);
      }
    }
  });

  it('gives every track a run-up that is actually drivable', () => {
    for (const track of CAMPAIGN) {
      const built = generateTrackFromSpec(track.spec);
      for (let i = 0; i < 8; i++) expect(built.tiles[i]!.solid).toBe(true);
    }
  });

  it('asks a different question with each one', () => {
    // Every track has to be the extreme of something, or it is a duplicate of
    // whichever one it sits next to.
    const codes = new Set(CAMPAIGN.map((t) => encodeSpec(t.spec)));
    expect(codes.size).toBe(CAMPAIGN.length);

    const knobs = ['tiles', 'hills', 'ramps', 'gaps', 'bank', 'width'] as const;
    for (const knob of knobs) {
      const values = CAMPAIGN.map((t) => t.spec[knob]);
      expect(Math.max(...values)).toBeGreaterThan(Math.min(...values));
    }
  });

  it('opens with something gentle', () => {
    const first = CAMPAIGN[0]!;
    expect(first.spec.gaps).toBe(0);
    expect(first.spec.ramps).toBe(0);
    expect(first.spec.hills).toBeLessThan(0.6);
  });
});

describe('the campaign in the 3D engine', () => {
  it('runs every built-in track without the cars all dying at the gate', async () => {
    const { Simulation3D } = await import('../src/sim3d/simulation3d');

    for (const track of CAMPAIGN) {
      const sim = await Simulation3D.create({ trackSeed: track.spec.seed, runSeed: 'campaign' });
      sim.setTrackSpec(track.spec);

      // Sampled as it runs, and kept as a peak: a generation rollover resets
      // bestX, so reading it at the end measures whatever the *next* twenty
      // cars have managed rather than the best of the run.
      let furthest = 0;
      for (let i = 0; i < 900; i++) {
        sim.step();
        furthest = Math.max(furthest, sim.bestX);
      }

      expect(sim.track.profile.tiles).toHaveLength(track.spec.tiles);
      // Something got somewhere. A track where the whole field slides off the
      // start line is not a track, it is a bug in the numbers above it.
      expect(furthest, `${track.name} went nowhere`).toBeGreaterThan(5);
      sim.dispose();
    }
  }, 240_000);
});
