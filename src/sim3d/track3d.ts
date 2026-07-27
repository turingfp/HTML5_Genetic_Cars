/**
 * The 3D road.
 *
 * Built from the same 2D profile the flat mode uses, so a seed produces the
 * same hills either way, plus a roll angle per segment that grows with
 * distance. The banking is what makes 3D its own problem: a narrow car that
 * wins on flat ground will tip over on a camber.
 */

import { MAX_ROAD_BANK, ROAD_BANK_GAIN, ROAD_HALF_WIDTH } from '../config';
import { rngFromSeed } from '../core/rng';
import { generateTrack, type TrackDef } from '../sim/track';

export interface RoadSegment {
  /** Centre of the segment box, in world space. */
  center: { x: number; y: number; z: number };
  /** Pitch about z, from the 2D profile. */
  pitch: number;
  /** Roll about the direction of travel. */
  bank: number;
}

export interface Track3D {
  seed: string;
  /** The shared 2D profile: hills, surface polyline, bounds. */
  profile: TrackDef;
  segments: RoadSegment[];
  halfWidth: number;
}

export function generateTrack3D(seed: string): Track3D {
  const profile = generateTrack(seed);
  // A separate stream, so banking does not disturb the shared hill profile.
  const rng = rngFromSeed(`${seed}:bank`);
  const count = profile.tiles.length;

  const segments = profile.tiles.map((tile, k) => {
    const [a, b, c, d] = tile.vertices;
    const raw = (rng() * 2 - 1) * ROAD_BANK_GAIN * (k / count);
    return {
      center: {
        x: (a.x + b.x + c.x + d.x) / 4,
        y: (a.y + b.y + c.y + d.y) / 4,
        z: 0,
      },
      pitch: Math.atan2(b.y - a.y, b.x - a.x),
      bank: Math.max(-MAX_ROAD_BANK, Math.min(MAX_ROAD_BANK, raw)),
    };
  });

  return { seed, profile, segments, halfWidth: ROAD_HALF_WIDTH };
}

/**
 * Orientation of a road segment as a quaternion: roll about the travel
 * direction first, then pitch up the hill.
 */
export function segmentRotation(segment: RoadSegment): {
  x: number;
  y: number;
  z: number;
  w: number;
} {
  const hp = segment.pitch / 2;
  const hb = segment.bank / 2;
  // qz (pitch about z) * qx (bank about x).
  const zc = Math.cos(hp);
  const zs = Math.sin(hp);
  const xc = Math.cos(hb);
  const xs = Math.sin(hb);
  return {
    w: zc * xc,
    x: zc * xs,
    y: zs * xs,
    z: zs * xc,
  };
}
