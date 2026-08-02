/**
 * Terrain generation.
 *
 * The track is a chain of tilted rectangles whose tilt grows with distance, so
 * the ground gets progressively nastier. Generating it as plain data (rather
 * than reading it back out of the physics world, as the original did) lets the
 * renderer and minimap draw terrain without touching the engine.
 */

import {
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

export interface TrackTile {
  /** Four corners in world space, counter-clockwise. */
  vertices: [Vec2, Vec2, Vec2, Vec2];
}

export interface TrackDef {
  seed: string;
  tiles: TrackTile[];
  /** Surface points along the top of the track, for drawing and the minimap. */
  surface: Vec2[];
  minY: number;
  maxY: number;
  /** World x where the track ends. */
  endX: number;
}

/** Corner offsets of an untilted tile, counter-clockwise from bottom-left. */
const CORNERS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [TILE_WIDTH, 0],
  [TILE_WIDTH, -TILE_HEIGHT],
  [0, -TILE_HEIGHT],
];

export function generateTrack(seed: string, tileCount = TRACK_TILE_COUNT): TrackDef {
  const rng = rngFromSeed(seed);
  const tiles: TrackTile[] = [];
  const surface: Vec2[] = [];

  let x = TRACK_START_X;
  let y = TRACK_START_Y;
  let minY = y;
  let maxY = y;

  for (let k = 0; k < tileCount; k++) {
    // Tilt is uniform in [-1.5, 1.5), scaled by how far along the track we are,
    // then clamped so the track can never fold back over itself.
    const raw = (rng() * 3 - 1.5) * TILE_TILT_GAIN * (k / tileCount);
    const angle = Math.max(-MAX_TILE_TILT, Math.min(MAX_TILE_TILT, raw));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const corners = CORNERS.map(([cx, cy]) => ({
      x: x + cx * cos - cy * sin,
      y: y + cx * sin + cy * cos,
    })) as [Vec2, Vec2, Vec2, Vec2];

    tiles.push({ vertices: corners });
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

  return { seed, tiles, surface, minY, maxY, endX: x };
}

/**
 * How steeply the ground rises just ahead of `x`, as rise over run.
 *
 * This is the one thing a car can see rather than feel, and it is what lets a
 * driver do something before it hits a slope instead of after. Clamped, because
 * a near-vertical tile would otherwise swamp every other input.
 */
export function slopeAhead(track: TrackDef, x: number, lookahead = LOOKAHEAD): number {
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

/** How far ahead a car looks, in metres. About one car length. */
const LOOKAHEAD = 3;

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
