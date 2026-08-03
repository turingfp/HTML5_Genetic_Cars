/**
 * The 3D road.
 *
 * Built from the same 2D profile the flat mode uses, so a seed produces the
 * same hills either way, plus a camber that grows with distance. The banking is
 * what makes 3D its own problem: a narrow car that wins on flat ground will tip
 * over on a slope.
 *
 * `roadCrossSections` is the single source of truth for where the road is:
 * both the colliders and the drawn ribbon are built from it.
 */

import { MAX_ROAD_BANK, ROAD_BANK_GAIN, ROAD_HALF_WIDTH } from '../config';
import { rngFromSeed } from '../core/rng';
import { generateTrackFromSpec, type TrackDef } from '../sim/track';
import { defaultSpec, normaliseSpec, type TrackSpec } from '../track/spec';

/** How far the camber may change from one joint to the next. */
const BANK_STEP = 0.06;

export type Vec3Tuple = [number, number, number];

export interface Track3D {
  seed: string;
  /** The design this road was generated from. */
  spec: TrackSpec;
  /** The shared 2D profile: hills, surface polyline, bounds. */
  profile: TrackDef;
  /**
   * Bank angle at each joint between tiles, one more entry than there are
   * tiles.
   *
   * Banking is defined at the joints rather than per tile so that neighbouring
   * tiles agree on the roll where they meet. Giving each tile its own constant
   * bank left the road twisting instantly at every joint, which opened real
   * gaps along the edges and made the surface impossible to draw as one piece.
   */
  joints: number[];
  halfWidth: number;
}

export function generateTrack3D(seed: string): Track3D {
  return generateTrack3DFromSpec(defaultSpec(seed));
}

export function generateTrack3DFromSpec(input: TrackSpec): Track3D {
  const spec = normaliseSpec(input);
  const profile = generateTrackFromSpec(spec);
  const seed = spec.seed;
  // A separate stream, so banking does not disturb the shared hill profile.
  const rng = rngFromSeed(`${seed}:bank`);
  const count = profile.tiles.length;

  // Bank wanders rather than being drawn independently at each joint. Fresh
  // random values 1.5 metres apart made the road twist violently back and
  // forth, which is neither drivable nor anything like a road; a walk inside a
  // widening envelope gives a camber that builds and releases over a stretch.
  const joints: number[] = [];
  let bank = 0;
  for (let j = 0; j <= count; j++) {
    const envelope = ROAD_BANK_GAIN * spec.bank * (j / count);
    bank += (rng() * 2 - 1) * BANK_STEP;
    bank = Math.max(-envelope, Math.min(envelope, bank));
    joints.push(Math.max(-MAX_ROAD_BANK, Math.min(MAX_ROAD_BANK, bank)));
  }

  return { seed, spec, profile, joints, halfWidth: ROAD_HALF_WIDTH * spec.width };
}

/** Rotate a local offset by a quaternion: v + 2w(qv × v) + 2qv × (qv × v). */
function rotateByQuat(
  q: { x: number; y: number; z: number; w: number },
  x: number,
  y: number,
  z: number,
): Vec3Tuple {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return [
    x + q.w * tx + (q.y * tz - q.z * ty),
    y + q.w * ty + (q.z * tx - q.x * tz),
    z + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Orientation of the road surface: roll about the direction of travel first,
 * then pitch up the hill.
 */
export function roadOrientation(pitch: number, bank: number): Quaternion {
  const hp = pitch / 2;
  const hb = bank / 2;
  // qz (pitch about z) * qx (bank about x).
  const zc = Math.cos(hp);
  const zs = Math.sin(hp);
  const xc = Math.cos(hb);
  const xs = Math.sin(hb);
  return { w: zc * xc, x: zc * xs, y: zs * xs, z: zs * xc };
}

/** Slope of one tile, from the shared 2D profile. */
function tilePitch(track: Track3D, index: number): number {
  const tiles = track.profile.tiles;
  const [a, b] = tiles[Math.max(0, Math.min(tiles.length - 1, index))]!.vertices;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Orientation of the road surface at a joint between tiles. */
export function jointRotation(track: Track3D, joint: number): Quaternion {
  // Average the pitch either side so the surface does not kink at the joint.
  const pitch = (tilePitch(track, joint - 1) + tilePitch(track, joint)) / 2;
  return roadOrientation(pitch, track.joints[joint]!);
}

/** One slice across the road surface, at a joint between two tiles. */
export interface RoadCrossSection {
  left: Vec3Tuple;
  right: Vec3Tuple;
  /** Road surface normal. */
  up: Vec3Tuple;
  /** Unit vector from the left edge toward the right edge. */
  across: Vec3Tuple;
}

/**
 * The road surface, sampled once per joint.
 *
 * The colliders and the drawn ribbon were derived separately at first, with the
 * colliders using a per-tile average of the joint banks. That left the physical
 * surface up to 1.7 metres from the visible one at the road edges, so cars
 * struck invisible seams and sank into the drawn road. Deriving both from here
 * means they cannot drift apart.
 */
export function roadCrossSections(track: Track3D): RoadCrossSection[] {
  const half = track.halfWidth;
  const surface = track.profile.surface;
  const sections: RoadCrossSection[] = [];

  for (let j = 0; j < surface.length; j++) {
    const q = jointRotation(track, j);
    const c = surface[j]!;
    const offset = rotateByQuat(q, 0, 0, half);
    const left: Vec3Tuple = [c.x - offset[0], c.y - offset[1], -offset[2]];
    const right: Vec3Tuple = [c.x + offset[0], c.y + offset[1], offset[2]];
    sections.push({
      left,
      right,
      up: normalize(rotateByQuat(q, 0, 1, 0)),
      across: normalize([right[0] - left[0], right[1] - left[1], right[2] - left[2]]),
    });
  }
  return sections;
}
