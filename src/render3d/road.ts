/**
 * The road as one continuous ribbon.
 *
 * The physics road is a chain of separate boxes, and drawing it that way showed
 * every joint: neighbouring slabs bank by different amounts, so their corners
 * do not meet and the surface reads as scattered planks. Here the same segments
 * are stitched into a single surface — each one contributes a cross-section at
 * its trailing and leading edge, and consecutive cross-sections are joined, so
 * a change in bank becomes a smooth twist instead of a step.
 *
 * The top surface and the two side walls are built as separate vertex sets.
 * Sharing vertices between them meant one normal had to serve a horizontal
 * face and a vertical one, which lit the road wrongly and made the walls read
 * as a row of loose teeth.
 */

import { BufferAttribute, BufferGeometry } from 'three';

import { roadCrossSections, type Track3D } from '../sim3d/track3d';

type Vec3 = [number, number, number];

/** How far the side walls hang below the road edge. */
const SKIRT = 1.4;

export function buildRoadGeometry(track: Track3D): BufferGeometry {
  const sections = roadCrossSections(track);
  const count = sections.length;

  // Three strips, each with its own vertices: top, left wall, right wall.
  // Two vertices per cross-section per strip.
  const vertexCount = count * 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  const TOP = 0;
  const LEFT = count * 2;
  const RIGHT = count * 4;

  let distance = 0;
  for (let i = 0; i < count; i++) {
    const s = sections[i]!;
    if (i > 0) {
      const p = sections[i - 1]!;
      distance += Math.hypot(s.left[0] - p.left[0], s.left[1] - p.left[1], s.left[2] - p.left[2]);
    }

    const put = (slot: number, p: Vec3, n: Vec3, u: number) => {
      positions.set(p, slot * 3);
      normals.set(n, slot * 3);
      uvs[slot * 2] = u;
      uvs[slot * 2 + 1] = distance;
    };

    // The walls hang along the surface normal, not straight down. On a tile
    // pitched near vertical a downward wall is almost parallel to the road
    // itself, so it collapses and folds over; following the normal keeps it
    // square to the surface everywhere.
    const leftBottom: Vec3 = [
      s.left[0] - s.up[0] * SKIRT,
      s.left[1] - s.up[1] * SKIRT,
      s.left[2] - s.up[2] * SKIRT,
    ];
    const rightBottom: Vec3 = [
      s.right[0] - s.up[0] * SKIRT,
      s.right[1] - s.up[1] * SKIRT,
      s.right[2] - s.up[2] * SKIRT,
    ];
    // Walls face away from the road, along the cross direction.
    const outLeft: Vec3 = [-s.across[0], -s.across[1], -s.across[2]];

    put(TOP + i * 2, s.left, s.up, 0);
    put(TOP + i * 2 + 1, s.right, s.up, 1);
    put(LEFT + i * 2, s.left, outLeft, 0);
    put(LEFT + i * 2 + 1, leftBottom, outLeft, 0);
    put(RIGHT + i * 2, s.right, s.across, 1);
    put(RIGHT + i * 2 + 1, rightBottom, s.across, 1);
  }

  // Winding matters: travel runs along +x and "across" runs along +z, and
  // forward × across points *down*, so the surface has to be wound the other
  // way round or every face ends up looking at the ground.
  const indices: number[] = [];
  for (let i = 0; i + 1 < count; i++) {
    const t = TOP + i * 2;
    const tn = TOP + (i + 1) * 2;
    indices.push(t, t + 1, tn, t + 1, tn + 1, tn);

    // The walls face opposite ways, so they wind opposite ways too.
    const l = LEFT + i * 2;
    const ln = LEFT + (i + 1) * 2;
    indices.push(l, ln, l + 1, l + 1, ln, ln + 1);

    const r = RIGHT + i * 2;
    const rn = RIGHT + (i + 1) * 2;
    indices.push(r, r + 1, rn, r + 1, rn + 1, rn);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
