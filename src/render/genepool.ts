/**
 * The whole population's weights, as one picture.
 *
 * One row per car, one column per weight, coloured by value. On generation one
 * it is noise. Leave it running and columns start to agree: that is selection
 * fixing a weight because every car that survived happens to share it. Bands
 * that stay noisy are weights nothing depends on.
 *
 * It is the clearest view of the search that exists here. The fitness chart
 * tells you it is working; this tells you where.
 */

import { BRAIN_WEIGHT_COUNT, type Brain } from '../ga/brain';

export interface GenePoolCar {
  brain: Brain | null;
  alive: boolean;
  isElite: boolean;
}

/** Weights live in [-1.5, 1.5]; map that onto the colour ramp. */
const LIMIT = 1.5;

/**
 * Weights only change when a generation turns over, so redrawing a thousand
 * cells every animation frame buys nothing. Twice a second is enough to keep
 * the alive and dead rows honest.
 */
const REDRAW_INTERVAL_MS = 500;

export class GenePool {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lastDrawn = -Infinity;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  /** Force the next `draw` through, however recently one happened. */
  invalidate(): void {
    this.lastDrawn = -Infinity;
  }

  draw(cars: GenePoolCar[]): void {
    const now = performance.now();
    if (now - this.lastDrawn < REDRAW_INTERVAL_MS) return;
    this.lastDrawn = now;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (cars.length === 0) return;

    const rowHeight = h / cars.length;
    const cellWidth = w / BRAIN_WEIGHT_COUNT;

    for (let row = 0; row < cars.length; row++) {
      const car = cars[row]!;
      const y = row * rowHeight;
      if (!car.brain) continue;

      // A dead car's row fades rather than vanishing, so the picture does not
      // thin out as a generation wears on.
      const alpha = car.alive ? 1 : 0.3;

      for (let col = 0; col < BRAIN_WEIGHT_COUNT; col++) {
        const value = clamp(car.brain.weights[col] ?? 0);
        ctx.fillStyle = ramp(value, alpha);
        // Overdraw by a hair, or sub-pixel columns leave seams.
        ctx.fillRect(col * cellWidth, y, cellWidth + 1, rowHeight + 1);
      }

      if (car.isElite) {
        ctx.fillStyle = 'rgba(0, 200, 83, 0.9)';
        ctx.fillRect(0, y, Math.max(1.5 * dpr, cellWidth * 0.3), rowHeight);
      }
    }
  }
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -LIMIT ? -LIMIT : v > LIMIT ? LIMIT : v;
}

/** Brake red for negative, bare track at zero, throttle green for positive. */
function ramp(value: number, alpha: number): string {
  const t = Math.abs(value) / LIMIT;
  if (value >= 0) {
    return `rgba(${Math.round(16 - 16 * t)}, ${Math.round(16 + 184 * t)}, ${Math.round(19 + 64 * t)}, ${alpha})`;
  }
  return `rgba(${Math.round(16 + 239 * t)}, ${Math.round(16 + 53 * t)}, ${Math.round(19 + 39 * t)}, ${alpha})`;
}
