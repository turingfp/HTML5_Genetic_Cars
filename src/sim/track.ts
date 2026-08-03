/**
 * Terrain generation.
 *
 * The track is a chain of tilted rectangles whose tilt grows with distance, so
 * the ground gets progressively nastier. Generating it as plain data (rather
 * than reading it back out of the physics world, as the original did) lets the
 * renderer and minimap draw terrain without touching the engine.
 */

import {
  CAR_SPAWN_X,
  MAX_TILE_TILT,
  TILE_HEIGHT,
  TILE_TILT_GAIN,
  TILE_WIDTH,
  TRACK_START_X,
  TRACK_START_Y,
  TRACK_TILE_COUNT,
} from '../config';
import { rngFromSeed } from '../core/rng';
import type { Vec2 } from '../ga/genome';
import { defaultSpec, normaliseSpec, type TrackSpec } from '../track/spec';

export interface TrackTile {
  /** Four corners in world space, counter-clockwise. */
  vertices: [Vec2, Vec2, Vec2, Vec2];
  /**
   * False for a hole in the road.
   *
   * A gap tile keeps its geometry, so the surface polyline stays a function of
   * x and every lookup that walks it still works. It just has no collider and
   * is not drawn, so there is nothing there to drive on.
   */
  solid: boolean;
  /** True for a launch ramp, so the renderer can mark it. */
  ramp: boolean;
}

export interface TrackDef {
  seed: string;
  /** The design this was generated from. */
  spec: TrackSpec;
  tiles: TrackTile[];
  /** Surface points along the top of the track, for drawing and the minimap. */
  surface: Vec2[];
  minY: number;
  maxY: number;
  /** World x where the track ends. */
  endX: number;
  /** Drivable length, from the spawn to the end. What medals measure against. */
  length: number;
}

/** Corner offsets of an untilted tile, counter-clockwise from bottom-left. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [TILE_WIDTH, 0],
  [TILE_WIDTH, -TILE_HEIGHT],
  [0, -TILE_HEIGHT],
];

/**
 * How many tiles at the start are always plain and solid.
 *
 * Cars spawn here. A gap or a ramp in the first few metres decides the run
 * before any of the driving does, which makes the track a coin toss rather
 * than a test.
 */
const SAFE_RUN_UP = 8;

/** A ramp's upward kick, on top of whatever tilt the terrain already had. */
const RAMP_TILT = 0.55;

export function generateTrack(seed: string, tileCount = TRACK_TILE_COUNT): TrackDef {
  return generateTrackFromSpec({ ...defaultSpec(seed), tiles: tileCount });
}

export function generateTrackFromSpec(input: TrackSpec): TrackDef {
  const spec = normaliseSpec(input);
  const rng = rngFromSeed(spec.seed);
  // Ramps and gaps draw from their own stream, so turning them on does not
  // reshuffle the hills. Sliding one knob should change one thing.
  const features = rngFromSeed(`${spec.seed}:features`);
  const tileCount = spec.tiles;
  const tiles: TrackTile[] = [];
  const surface: Vec2[] = [];

  let x = TRACK_START_X;
  let y = TRACK_START_Y;
  let minY = y;
  let maxY = y;
  let previousWasGap = false;

  for (let k = 0; k < tileCount; k++) {
    // Tilt is uniform in [-1.5, 1.5), scaled by how far along the track we are,
    // then clamped so the track can never fold back over itself.
    const raw = (rng() * 3 - 1.5) * TILE_TILT_GAIN * spec.hills * (k / tileCount);

    const openGround = k >= SAFE_RUN_UP;
    const rampRoll = features();
    const gapRoll = features();
    const ramp = openGround && rampRoll < spec.ramps;
    // Never two gaps in a row: one is a jump, two is a wall with extra steps.
    // A ramp and a gap on the same tile would also be a ramp into nothing.
    const solid: boolean = !(openGround && !ramp && !previousWasGap && gapRoll < spec.gaps);
    previousWasGap = !solid;

    const angle = Math.max(-MAX_TILE_TILT, Math.min(MAX_TILE_TILT, ramp ? raw + RAMP_TILT : raw));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners = CORNERS.map(([cx, cy]) => ({
      x: x + cx * cos - cy * sin,
      y: y + cx * sin + cy * cos,
    })) as [Vec2, Vec2, Vec2, Vec2];

    tiles.push({ vertices: corners, solid, ramp });
    if (k === 0) surface.push({ x: corners[0].x, y: corners[0].y });
    surface.push({ x: corners[1].x, y: corners[1].y });

    // A steep enough tilt can swing any corner to the extreme, so check all four.
    for (const c of corners) {
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }

    // The next tile starts where this one's top-right corner landed.
    x = corners[1].x;
    y = corners[1].y;
  }

  return {
    seed: spec.seed,
    spec,
    tiles,
    surface,
    minY,
    maxY,
    endX: x,
    // Measured from the spawn rather than the first tile, so "half way" means
    // half of what a car actually has to drive.
    length: Math.max(1, x - CAR_SPAWN_X),
  };
}

/**
 * How steeply the ground rises just ahead of `x`, as rise over run.
 *
 * This is the one thing a car can see rather than feel, and it is what lets a
 * driver do something before it hits a slope instead of after. Clamped, because
 * a near-vertical tile would otherwise swamp every other input.
 */
export function slopeAhead(track: TrackDef, x: number, lookahead: number): number {
  const points = track.surface;
  const here = surfaceIndexAt(track, x);
  const there = surfaceIndexAt(track, x + lookahead);
  const a = points[Math.min(here, points.length - 1)]!;
  const b = points[Math.min(there, points.length - 1)]!;
  const run = b.x - a.x;
  if (run <= 1e-6) return 0;
  const slope = (b.y - a.y) / run;
  return slope < -1 ? -1 : slope > 1 ? 1 : slope;
}

/**
 * Three distances a car looks ahead, in metres: about a car length, about a
 * braking distance, and far enough to see a hill before it starts climbing it.
 */
export const LOOKAHEADS = [1.5, 4, 9] as const;

export interface SlopeProbes {
  near: number;
  mid: number;
  far: number;
}

/** Fill a caller-owned probe set, so stepping allocates nothing. */
export function slopeProbes(track: TrackDef, x: number, out: SlopeProbes): void {
  out.near = slopeAhead(track, x, LOOKAHEADS[0]);
  out.mid = slopeAhead(track, x, LOOKAHEADS[1]);
  out.far = slopeAhead(track, x, LOOKAHEADS[2]);
}

/**
 * Index of the first surface point at or after `x`, via binary search.
 * Used to draw only the visible slice of terrain.
 */
export function surfaceIndexAt(track: TrackDef, x: number): number {
  const points = track.surface;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.x < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
