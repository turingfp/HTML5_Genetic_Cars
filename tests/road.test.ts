/**
 * The 3D road ribbon.
 *
 * Drawing the road as separate slabs showed every joint, and a first attempt at
 * stitching shared vertices between the surface and its side walls, which lit
 * them wrongly and left the walls looking like loose teeth. These check the
 * geometry is a continuous, correctly sized, non-degenerate surface.
 */

import { describe, expect, it } from 'vitest';

import { ROAD_HALF_WIDTH, TRACK_TILE_COUNT } from '../src/config';
import { buildRoadGeometry } from '../src/render3d/road';
import { generateTrack3D, roadCrossSections } from '../src/sim3d/track3d';

function positionsOf(seed: string) {
  const track = generateTrack3D(seed);
  const geometry = buildRoadGeometry(track);
  return {
    track,
    position: geometry.getAttribute('position'),
    normal: geometry.getAttribute('normal'),
    index: geometry.getIndex()!,
  };
}

/** How well a triangle's own facing agrees with the normal stored on it. */
function faceDot(
  position: { getX(i: number): number; getY(i: number): number; getZ(i: number): number },
  normal: { getX(i: number): number; getY(i: number): number; getZ(i: number): number },
  a: number,
  b: number,
  c: number,
): number {
  const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
  const ux = position.getX(b) - ax, uy = position.getY(b) - ay, uz = position.getZ(b) - az;
  const vx = position.getX(c) - ax, vy = position.getY(c) - ay, vz = position.getZ(c) - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return nx * normal.getX(a) + ny * normal.getY(a) + nz * normal.getZ(a);
}

describe('road geometry', () => {
  it('covers every segment with a surface of the right width', () => {
    const { track, position } = positionsOf('ribbon');
    expect(track.joints).toHaveLength(TRACK_TILE_COUNT + 1);
    // One cross-section per joint (one more than there are tiles), three
    // strips of two vertices each.
    expect(position.count).toBe((TRACK_TILE_COUNT + 1) * 6);

    // The top strip's paired vertices should span the full road width.
    const sections = TRACK_TILE_COUNT + 1;
    for (let i = 0; i < sections; i++) {
      const a = i * 2;
      const width = Math.hypot(
        position.getX(a + 1) - position.getX(a),
        position.getY(a + 1) - position.getY(a),
        position.getZ(a + 1) - position.getZ(a),
      );
      // Positions are stored as float32, so this is as tight as it gets.
      expect(width).toBeCloseTo(ROAD_HALF_WIDTH * 2, 4);
    }
  });

  it('has no degenerate triangles', () => {
    const { position, index } = positionsOf('degenerate');
    let smallest = Infinity;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const ax = position.getX(a), ay = position.getY(a), az = position.getZ(a);
      const bx = position.getX(b) - ax, by = position.getY(b) - ay, bz = position.getZ(b) - az;
      const cx = position.getX(c) - ax, cy = position.getY(c) - ay, cz = position.getZ(c) - az;
      // Half the magnitude of the cross product is the triangle's area.
      const area =
        0.5 *
        Math.hypot(by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx);
      smallest = Math.min(smallest, area);
    }
    expect(smallest).toBeGreaterThan(1e-6);
  });

  it('gives every vertex a unit-length normal', () => {
    const { normal } = positionsOf('normals');
    for (let i = 0; i < normal.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 5);
    }
  });

  it('never flips the surface upside down', () => {
    const { normal } = positionsOf('facing');
    const sections = TRACK_TILE_COUNT + 1;
    // Steep tiles pitch up to 1.4 rad, so a surface normal can lean a long way
    // over; what matters is that it always points out of the road, never into
    // it, or the whole face would light as though seen from below.
    for (let i = 0; i < sections * 2; i++) {
      expect(normal.getY(i)).toBeGreaterThan(0);
    }
    // The walls hang below the edges, so their normals stay near horizontal.
    for (let i = sections * 2; i < sections * 6; i++) {
      expect(Math.abs(normal.getY(i))).toBeLessThan(0.75);
    }
  });

  it('winds every face to agree with its normal on gentle terrain', () => {
    // Travel runs along +x and the road's width along +z, so the obvious
    // winding produces faces that point at the ground: the surface renders
    // black, or vanishes entirely under backface culling.
    //
    // Checked over the opening stretch, where tilt is still small. Far along
    // the course two neighbouring tiles can differ by most of a half turn and
    // the quad joining them genuinely folds, so no winding is correct there,
    // which is why the road is drawn double-sided.
    const { position, normal, index } = positionsOf('winding');
    const sections = TRACK_TILE_COUNT + 1;
    const gentle = 40;
    const inGentleRegion = (v: number) => {
      const section = v % (sections * 2) >= 0 ? Math.floor((v % (sections * 2)) / 2) : 0;
      return section < gentle;
    };

    let checked = 0;
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (!inGentleRegion(a) || !inGentleRegion(b) || !inGentleRegion(c)) continue;
      checked++;
      expect(faceDot(position, normal, a, b, c)).toBeGreaterThan(0);
    }
    // All three strips over the opening stretch.
    expect(checked).toBeGreaterThan(gentle * 5);
  });

  it('banks gradually enough to drive', () => {
    // Independent random bank at every joint twisted the road violently every
    // 1.5 metres. It now wanders, so neighbours stay close.
    const track = generateTrack3D('camber');
    for (let j = 1; j < track.joints.length; j++) {
      expect(Math.abs(track.joints[j]! - track.joints[j - 1]!)).toBeLessThanOrEqual(0.061);
    }
    // But it still banks meaningfully by the end of the course.
    expect(Math.max(...track.joints.map(Math.abs))).toBeGreaterThan(0.1);
  });

  it('places the surface where the colliders are', () => {
    // The drawn ribbon and the physics slabs are built from one set of
    // cross-sections. When they were derived separately, with the colliders
    // taking a per-tile average of the joint banks, the physical surface sat up to
    // 1.7 metres from the visible one at the road edges.
    for (const seed of ['ridge', 'alpha', 'showcase']) {
      const track = generateTrack3D(seed);
      const sections = roadCrossSections(track);
      expect(sections).toHaveLength(TRACK_TILE_COUNT + 1);

      const { position } = positionsOf(seed);
      for (let j = 0; j < sections.length; j++) {
        const left = j * 2;
        expect(position.getX(left)).toBeCloseTo(sections[j]!.left[0], 4);
        expect(position.getY(left)).toBeCloseTo(sections[j]!.left[1], 4);
        expect(position.getZ(left)).toBeCloseTo(sections[j]!.left[2], 4);
        expect(position.getX(left + 1)).toBeCloseTo(sections[j]!.right[0], 4);
        expect(position.getY(left + 1)).toBeCloseTo(sections[j]!.right[1], 4);
        expect(position.getZ(left + 1)).toBeCloseTo(sections[j]!.right[2], 4);
      }
    }
  });

  it('joins consecutive cross-sections without gaps', () => {
    const { position } = positionsOf('gaps');
    const sections = TRACK_TILE_COUNT + 1;
    // Within a segment the surface advances by a tile; between segments the
    // leading edge of one meets the trailing edge of the next.
    for (let i = 1; i < sections; i++) {
      const prev = (i - 1) * 2;
      const cur = i * 2;
      const step = Math.hypot(
        position.getX(cur) - position.getX(prev),
        position.getY(cur) - position.getY(prev),
        position.getZ(cur) - position.getZ(prev),
      );
      // Never a jump: the largest step is one tile plus a little banking twist.
      expect(step).toBeLessThan(4);
    }
  });
});
