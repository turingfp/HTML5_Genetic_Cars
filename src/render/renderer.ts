/**
 * The main view: sky, terrain, cars, and the ghost of the best run so far.
 */

import type { CarDef } from '../ga/genome';
import { lineageColour } from '../ga/lineage';
import type { Pose } from '../replay/recorder';
import type { WorldSnapshot } from '../sim/simulation';
import { surfaceIndexAt, type TrackDef } from '../sim/track';
import { Camera } from './camera';
import {
  carArt,
  drawCar,
  ELITE_STYLE,
  GHOST_STYLE,
  LEADER_STYLE,
  NORMAL_STYLE,
  type CarStyle,
} from './carPath';

export interface GhostFrame {
  def: CarDef;
  chassis: Pose;
  wheels: readonly Pose[];
}

/** A style built from a family's hue, so a whole line reads as one colour. */
function lineageStyle(lineage: number): CarStyle {
  return {
    body: lineageColour(lineage, 70, 60, 0.45),
    stroke: lineageColour(lineage, 80, 72),
    spoke: lineageColour(lineage, 70, 70, 0.28),
    wheel: '#1e293b',
    wheelStroke: lineageColour(lineage, 80, 72),
    alpha: 1,
  };
}

export class Renderer {
  /** Colour cars by the family they descend from rather than by status. */
  colourByLineage = false;

  readonly camera: Camera;
  private ctx: CanvasRenderingContext2D;

  /** Distance markers every this many metres. */
  private static readonly MARKER_SPACING = 10;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.ctx = ctx;
    this.camera = new Camera(canvas);
  }

  dispose(): void {
    this.camera.dispose();
  }

  draw(track: TrackDef, snapshot: WorldSnapshot | null, ghost: GhostFrame | null): void {
    const { ctx, camera } = this;
    camera.applyScreenTransform(ctx);
    this.drawSky();

    camera.applyTransform(ctx);
    const range = camera.visibleRange();
    this.drawTerrain(track, range.minX, range.maxX);
    this.drawDistanceMarkers(track, range.minX, range.maxX);

    if (ghost) {
      drawCar(ctx, carArt(ghost.def), ghost.chassis, ghost.wheels, GHOST_STYLE, camera.zoom);
    }

    if (snapshot) this.drawCars(snapshot, range.minX, range.maxX);
  }

  private drawSky(): void {
    const { ctx, camera } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, camera.height);
    gradient.addColorStop(0, '#0b1120');
    gradient.addColorStop(0.55, '#15233c');
    gradient.addColorStop(1, '#1e3a5f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, camera.width, camera.height);
  }

  /**
   * Terrain is drawn straight from the track data over the visible span, so
   * there is no cross-frame drawing state to fall out of sync. The original
   * cached a "last drawn tile" index that it never reset, which made the
   * ground vanish at the start of each generation.
   */
  private drawTerrain(track: TrackDef, minX: number, maxX: number): void {
    const { ctx } = this;
    const points = track.surface;
    const start = Math.max(0, surfaceIndexAt(track, minX) - 1);
    const end = Math.min(points.length - 1, surfaceIndexAt(track, maxX) + 1);
    if (end <= start) return;

    const floor = track.minY - 40;

    ctx.beginPath();
    ctx.moveTo(points[start]!.x, floor);
    for (let i = start; i <= end; i++) {
      ctx.lineTo(points[i]!.x, points[i]!.y);
    }
    ctx.lineTo(points[end]!.x, floor);
    ctx.closePath();

    // Clearly darker than the sky's lower stop, so the horizon always reads.
    ctx.fillStyle = '#0c1526';
    ctx.fill();

    const surfaceLine = new Path2D();
    surfaceLine.moveTo(points[start]!.x, points[start]!.y);
    for (let i = start + 1; i <= end; i++) surfaceLine.lineTo(points[i]!.x, points[i]!.y);

    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // A lighter crust just under the surface separates ground from sky at any
    // camera position, which a world-space gradient cannot do reliably.
    ctx.lineWidth = 0.34;
    ctx.strokeStyle = '#33465f';
    ctx.stroke(surfaceLine);

    // A bright surface line makes the terrain profile readable at any zoom.
    ctx.lineWidth = 2.5 / this.camera.zoom;
    ctx.strokeStyle = '#7dd3fc';
    ctx.stroke(surfaceLine);
  }

  private drawDistanceMarkers(track: TrackDef, minX: number, maxX: number): void {
    const { ctx, camera } = this;
    const spacing = Renderer.MARKER_SPACING;
    const first = Math.ceil(minX / spacing) * spacing;
    const scale = 1 / camera.zoom;

    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.18)';

    for (let x = first; x <= maxX; x += spacing) {
      if (x <= 0) continue;
      const i = Math.min(surfaceIndexAt(track, x), track.surface.length - 1);
      const groundY = track.surface[i]!.y;
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.lineTo(x, groundY + 0.55);
      ctx.stroke();

      // Text has to be drawn in an unflipped frame or it renders upside down.
      ctx.save();
      ctx.translate(x, groundY + 0.95);
      ctx.scale(scale, -scale);
      ctx.fillStyle = 'rgba(148, 197, 252, 0.5)';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${x}m`, 0, 0);
      ctx.restore();
    }
  }

  private drawCars(snapshot: WorldSnapshot, minX: number, maxX: number): void {
    const { ctx, camera } = this;
    for (let i = 0; i < snapshot.cars.length; i++) {
      const car = snapshot.cars[i]!;
      if (!car.alive || !car.def) continue;
      if (car.chassis.x < minX || car.chassis.x > maxX) continue;

      // Draw the leader last so it stays on top of the pack.
      if (i === snapshot.leaderIndex) continue;
      const style: CarStyle = this.colourByLineage
        ? lineageStyle(car.lineage)
        : car.isElite
          ? ELITE_STYLE
          : NORMAL_STYLE;
      drawCar(ctx, carArt(car.def), car.chassis, car.wheels, style, camera.zoom);
    }

    const leader = snapshot.cars[snapshot.leaderIndex];
    if (leader?.alive && leader.def) {
      // The leader keeps its own colour even when families are on, since
      // losing track of who is winning costs more than the extra hue tells you.
      drawCar(ctx, carArt(leader.def), leader.chassis, leader.wheels, LEADER_STYLE, camera.zoom);
    }
  }
}
