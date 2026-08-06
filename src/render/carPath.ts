/**
 * Drawing a car from its genome.
 *
 * The chassis outline and wheels depend only on the genome, so the geometry is
 * built once per car and reused for the live view, the ghost, and leaderboard
 * thumbnails.
 */

import { CHASSIS_VERTEX_COUNT, WHEEL_DENSITY_MIN, WHEEL_DENSITY_RANGE } from '../config';
import type { CarDef } from '../ga/genome';
import type { Pose } from '../replay/recorder';

export interface CarArt {
  outline: Path2D;
  /** The triangle fan, drawn faintly so the chassis reads as constructed. */
  spokes: Path2D;
  wheelRadius: number[];
  /** 0 = lightest wheel, 1 = heaviest. One per wheel. */
  wheelWeight: number[];
  /** Bounding radius, used to frame thumbnails. */
  extent: number;
}

const artCache = new WeakMap<CarDef, CarArt>();

export function carArt(def: CarDef): CarArt {
  const cached = artCache.get(def);
  if (cached) return cached;

  const outline = new Path2D();
  const spokes = new Path2D();
  let extent = 0;

  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    const v = def.vertices[i]!;
    if (i === 0) outline.moveTo(v.x, v.y);
    else outline.lineTo(v.x, v.y);
    spokes.moveTo(0, 0);
    spokes.lineTo(v.x, v.y);
    extent = Math.max(extent, Math.hypot(v.x, v.y));
  }
  outline.closePath();

  const weight = (d: number) =>
    Math.max(0, Math.min(1, (d - WHEEL_DENSITY_MIN) / WHEEL_DENSITY_RANGE));

  const art: CarArt = {
    outline,
    spokes,
    wheelRadius: def.wheels.map((w) => w.radius),
    wheelWeight: def.wheels.map((w) => weight(w.density)),
    extent: extent + Math.max(0, ...def.wheels.map((w) => w.radius)),
  };
  artCache.set(def, art);
  return art;
}

export interface CarStyle {
  body: string;
  stroke: string;
  spoke: string;
  wheel: string;
  wheelStroke: string;
  alpha: number;
}

export const ELITE_STYLE: CarStyle = {
  body: 'rgba(96, 165, 250, 0.55)',
  stroke: '#93c5fd',
  spoke: 'rgba(147, 197, 253, 0.35)',
  wheel: '#1e293b',
  wheelStroke: '#93c5fd',
  alpha: 1,
};

export const NORMAL_STYLE: CarStyle = {
  body: 'rgba(248, 113, 113, 0.45)',
  stroke: '#fca5a5',
  spoke: 'rgba(252, 165, 165, 0.28)',
  wheel: '#1e293b',
  wheelStroke: '#fca5a5',
  alpha: 1,
};

export const LEADER_STYLE: CarStyle = {
  body: 'rgba(250, 204, 21, 0.5)',
  stroke: '#fde047',
  spoke: 'rgba(253, 224, 71, 0.35)',
  wheel: '#1e293b',
  wheelStroke: '#fde047',
  alpha: 1,
};

export const GHOST_STYLE: CarStyle = {
  body: 'rgba(148, 163, 184, 0.16)',
  stroke: 'rgba(203, 213, 225, 0.45)',
  spoke: 'rgba(203, 213, 225, 0.12)',
  wheel: 'rgba(30, 41, 59, 0.35)',
  wheelStroke: 'rgba(203, 213, 225, 0.4)',
  alpha: 1,
};

/**
 * Draw a car in world space. The context must already carry the world
 * transform; line widths are given in metres and scaled accordingly.
 */
export function drawCar(
  ctx: CanvasRenderingContext2D,
  art: CarArt,
  chassis: Pose,
  wheels: readonly Pose[],
  style: CarStyle,
  pixelsPerMetre: number,
): void {
  const hairline = 1.5 / pixelsPerMetre;
  ctx.globalAlpha = style.alpha;

  const wheelCount = Math.min(wheels.length, art.wheelRadius.length);
  for (let i = 0; i < wheelCount; i++) {
    const wheel = wheels[i]!;
    const radius = art.wheelRadius[i]!;
    ctx.save();
    ctx.translate(wheel.x, wheel.y);
    ctx.rotate(wheel.angle);

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    // Heavier wheels read as denser, darker discs.
    const shade = 30 + Math.round(art.wheelWeight[i]! * 45);
    ctx.fillStyle = `rgba(${shade}, ${shade + 6}, ${shade + 16}, 0.9)`;
    ctx.fill();
    ctx.lineWidth = hairline;
    ctx.strokeStyle = style.wheelStroke;
    ctx.stroke();

    // A pair of spokes so rotation is visible.
    ctx.beginPath();
    ctx.moveTo(-radius, 0);
    ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius);
    ctx.lineTo(0, radius);
    ctx.lineWidth = hairline * 0.7;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(chassis.x, chassis.y);
  ctx.rotate(chassis.angle);

  ctx.fillStyle = style.body;
  ctx.fill(art.outline);

  ctx.lineWidth = hairline * 0.6;
  ctx.strokeStyle = style.spoke;
  ctx.stroke(art.spokes);

  ctx.lineWidth = hairline;
  ctx.strokeStyle = style.stroke;
  ctx.lineJoin = 'round';
  ctx.stroke(art.outline);
  ctx.restore();

  ctx.globalAlpha = 1;
}

/** Render a car centred in a small square canvas, for the leaderboard. */
export function drawThumbnail(
  ctx: CanvasRenderingContext2D,
  def: CarDef,
  size: number,
  style: CarStyle,
): void {
  const art = carArt(def);
  const scale = (size * 0.42) / Math.max(art.extent, 0.001);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, -scale);

  const wheels: Pose[] = def.wheels.map((w) => ({
    ...def.vertices[w.vertex]!,
    angle: 0,
  }));
  drawCar(ctx, art, { x: 0, y: 0, angle: 0 }, wheels, style, scale);
  ctx.restore();
}
