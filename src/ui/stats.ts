/**
 * The live readouts: headline numbers and the per-car health strip.
 *
 * The strip is a single canvas. The original kept twenty DOM elements and
 * rewrote their inline widths on every physics step, forcing a style recalc
 * 60 times a second.
 */

/**
 * The subset of a snapshot the readouts need, which both the flat and the 3D
 * simulations satisfy. Their snapshots differ only in how poses are shaped.
 */
export interface StatsCar {
  alive: boolean;
  isElite: boolean;
  health01: number;
  maxX: number;
  /** Which founding line this car descends from. */
  lineage: number;
}

export interface StatsView {
  generation: number;
  aliveCount: number;
  bestX: number;
  leaderIndex: number;
  cars: StatsCar[];
}

/** How many distinct family lines still have a car alive. */
export function countLiving(view: StatsView): number {
  const lines = new Set<number>();
  for (const car of view.cars) {
    if (car.alive) lines.add(car.lineage);
  }
  return lines.size;
}

export class HealthStrip {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rowHeight = 0;
  private count = 0;

  /** Index of the car the camera is following, or -1 for "the leader". */
  selected = -1;
  onSelect: ((index: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;

    canvas.addEventListener('click', (event) => {
      if (this.count === 0 || this.rowHeight === 0) return;
      const rect = canvas.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const index = Math.floor(y / (rect.height / this.count));
      if (index >= 0 && index < this.count) this.onSelect?.(index);
    });
    canvas.style.cursor = 'pointer';
  }

  draw(snapshot: StatsView | null): void {
    if (!snapshot) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const { ctx } = this;
    this.count = snapshot.cars.length;
    this.rowHeight = h / Math.max(this.count, 1);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const gap = Math.max(1, this.rowHeight * 0.2);
    const barHeight = this.rowHeight - gap;
    // Index on the left, health bar in the middle, distance on the right, so
    // the text never has to sit on top of a filled bar.
    const labelWidth = 20 * dpr;
    const distanceWidth = 44 * dpr;
    const barLeft = labelWidth;
    const barWidth = Math.max(10, w - labelWidth - distanceWidth);

    ctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < this.count; i++) {
      const car = snapshot.cars[i]!;
      const y = i * this.rowHeight;
      const midY = y + barHeight / 2;
      const isLeader = i === snapshot.leaderIndex;

      ctx.textAlign = 'right';
      ctx.fillStyle = this.selected === i
        ? '#fde047'
        : car.alive
          ? 'rgba(203,213,225,0.8)'
          : 'rgba(100,116,139,0.55)';
      ctx.fillText(String(i), labelWidth - 5 * dpr, midY);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
      ctx.fillRect(barLeft, y, barWidth, barHeight);

      if (car.alive) {
        const fill = Math.max(0, Math.min(1, car.health01));
        ctx.fillStyle = isLeader ? '#fde047' : car.isElite ? '#60a5fa' : '#f87171';
        ctx.fillRect(barLeft, y, barWidth * fill, barHeight);
      }

      ctx.textAlign = 'right';
      ctx.fillStyle = isLeader
        ? '#fde047'
        : car.alive
          ? 'rgba(203, 213, 225, 0.85)'
          : 'rgba(100, 116, 139, 0.55)';
      ctx.fillText(`${car.maxX.toFixed(1)}m`, w - 4 * dpr, midY);

      if (this.selected === i) {
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = dpr;
        ctx.strokeRect(barLeft + 0.5, y + 0.5, barWidth - 1, barHeight - 1);
      }
    }
  }
}

/** Text readouts that only touch the DOM when the displayed value changes. */
export class Readouts {
  private cache = new Map<string, string>();
  private elements = new Map<string, HTMLElement>();

  constructor(root: ParentNode) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-readout]')) {
      this.elements.set(el.dataset.readout!, el);
    }
  }

  set(name: string, value: string): void {
    if (this.cache.get(name) === value) return;
    this.cache.set(name, value);
    const el = this.elements.get(name);
    if (el) el.textContent = value;
  }
}
