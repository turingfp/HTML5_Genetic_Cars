/**
 * Motion trails: the path each car has taken this generation.
 *
 * Watching twenty cars at once, the trails are what make the population
 * legible — you see the pack fan out, where the fast ones diverge from the
 * pile, and exactly where a car went over the edge.
 */

import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Group } from 'three';

/** Points kept per car; at one sample every few frames this is a few seconds. */
const TRAIL_POINTS = 220;

/** Sample every N physics frames, so trails span time rather than draw calls. */
const SAMPLE_EVERY = 3;

interface Trail {
  line: Line;
  geometry: BufferGeometry;
  positions: Float32Array;
  count: number;
  material: LineBasicMaterial;
}

export class Trails {
  readonly group = new Group();
  private trails: Trail[] = [];
  private frame = 0;

  constructor() {
    this.group.frustumCulled = false;
  }

  /** Match the number of trails to the population. */
  private ensure(count: number): void {
    while (this.trails.length < count) {
      const positions = new Float32Array(TRAIL_POINTS * 3);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      geometry.setDrawRange(0, 0);
      const material = new LineBasicMaterial({ transparent: true, opacity: 0.55 });
      const line = new Line(geometry, material);
      line.frustumCulled = false;
      this.group.add(line);
      this.trails.push({ line, geometry, positions, count: 0, material });
    }
    for (let i = count; i < this.trails.length; i++) this.trails[i]!.line.visible = false;
  }

  /**
   * Append the current position of each living car. Called once per drawn
   * frame; sampling keeps the buffers spanning a useful stretch of time.
   */
  update(
    cars: { alive: boolean; position: { x: number; y: number; z: number }; color: number }[],
  ): void {
    this.ensure(cars.length);
    this.frame++;
    const sample = this.frame % SAMPLE_EVERY === 0;

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const trail = this.trails[i]!;
      trail.line.visible = trail.count > 1;
      trail.material.color.setHex(car.color);

      if (!car.alive || !sample) continue;

      if (trail.count < TRAIL_POINTS) {
        const o = trail.count * 3;
        trail.positions[o] = car.position.x;
        trail.positions[o + 1] = car.position.y;
        trail.positions[o + 2] = car.position.z;
        trail.count++;
      } else {
        // Full: shuffle back one point and append. Copying 220 points for a
        // handful of cars is far cheaper than reallocating.
        trail.positions.copyWithin(0, 3);
        const o = (TRAIL_POINTS - 1) * 3;
        trail.positions[o] = car.position.x;
        trail.positions[o + 1] = car.position.y;
        trail.positions[o + 2] = car.position.z;
      }

      trail.geometry.setDrawRange(0, trail.count);
      trail.geometry.attributes.position!.needsUpdate = true;
      // No bounding sphere needed: these lines opt out of frustum culling, and
      // recomputing one per car per frame is pure waste.
    }
  }

  /** Wipe every trail, at the start of a generation. */
  reset(): void {
    this.frame = 0;
    for (const trail of this.trails) {
      trail.count = 0;
      trail.geometry.setDrawRange(0, 0);
      trail.line.visible = false;
    }
  }

  dispose(): void {
    for (const trail of this.trails) {
      trail.geometry.dispose();
      trail.material.dispose();
    }
    this.trails = [];
  }
}
