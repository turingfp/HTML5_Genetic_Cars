import { describe, expect, it } from 'vitest';

import {
  MAX_TILE_TILT,
  TILE_WIDTH,
  TRACK_START_X,
  TRACK_START_Y,
  TRACK_TILE_COUNT,
} from '../src/config';
import { generateTrack, surfaceIndexAt } from '../src/sim/track';

describe('generateTrack', () => {
  it('is reproducible for a seed and different across seeds', () => {
    expect(generateTrack('alpha')).toEqual(generateTrack('alpha'));
    expect(generateTrack('alpha').tiles).not.toEqual(generateTrack('beta').tiles);
  });

  it('chains tiles end to end without gaps', () => {
    const track = generateTrack('chain');
    expect(track.tiles).toHaveLength(TRACK_TILE_COUNT);
    expect(track.tiles[0]!.vertices[0]).toEqual({ x: TRACK_START_X, y: TRACK_START_Y });

    for (let i = 1; i < track.tiles.length; i++) {
      const prevTopRight = track.tiles[i - 1]!.vertices[1]!;
      const thisTopLeft = track.tiles[i]!.vertices[0]!;
      expect(thisTopLeft.x).toBeCloseTo(prevTopRight.x, 10);
      expect(thisTopLeft.y).toBeCloseTo(prevTopRight.y, 10);
    }
  });

  it('keeps every tile the right size', () => {
    const track = generateTrack('size');
    for (const tile of track.tiles) {
      const [a, b] = tile.vertices;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(TILE_WIDTH, 10);
    }
  });

  it('starts flat and gets steeper further along', () => {
    const track = generateTrack('steep');
    const slopeAt = (i: number) => {
      const [a, b] = track.tiles[i]!.vertices;
      return Math.abs(Math.atan2(b.y - a.y, b.x - a.x));
    };
    const early = Array.from({ length: 20 }, (_, i) => slopeAt(i)).reduce((a, b) => a + b) / 20;
    const late = Array.from({ length: 20 }, (_, i) => slopeAt(179 + i)).reduce((a, b) => a + b) / 20;
    expect(early).toBeLessThan(late);
  });

  it('always advances in x, so the surface stays a function of x', () => {
    // Unclamped, the tilt formula reaches 2.25 rad and tips tiles past vertical,
    // which folds the track back over itself and breaks every lookup by x.
    for (const seed of ['1ckq', 'fold', 'alpha', 'zzz', 'steep-9', 'q7', 'showcase']) {
      const track = generateTrack(seed);
      for (let i = 1; i < track.surface.length; i++) {
        expect(track.surface[i]!.x).toBeGreaterThan(track.surface[i - 1]!.x);
      }
    }
  });

  it('keeps tilt within the clamp even on the last tiles', () => {
    const track = generateTrack('extreme');
    for (const tile of track.tiles) {
      const [a, b] = tile.vertices;
      expect(Math.abs(Math.atan2(b.y - a.y, b.x - a.x))).toBeLessThanOrEqual(MAX_TILE_TILT + 1e-9);
    }
  });

  it('reports bounds that contain every tile', () => {
    const track = generateTrack('bounds');
    for (const tile of track.tiles) {
      for (const v of tile.vertices) {
        expect(v.y).toBeGreaterThanOrEqual(track.minY);
        expect(v.y).toBeLessThanOrEqual(track.maxY);
      }
    }
    expect(track.surface).toHaveLength(TRACK_TILE_COUNT + 1);
    expect(track.endX).toBeCloseTo(track.surface.at(-1)!.x, 10);
  });
});

describe('surfaceIndexAt', () => {
  it('finds the first surface point at or after x', () => {
    const track = generateTrack('search');
    for (const probe of [-100, -5, 0, 10, 50, track.endX, track.endX + 100]) {
      const i = surfaceIndexAt(track, probe);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(track.surface.length);
      if (i > 0) expect(track.surface[i - 1]!.x).toBeLessThan(probe);
    }
  });
});
