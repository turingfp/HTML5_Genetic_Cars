/**
 * Track overview: the whole course, how much of it has been explored, where
 * the cars are, and what the main view is looking at.
 *
 * The original did this with twenty absolutely-positioned divs whose `left`
 * was rewritten on every physics step. This is one canvas, redrawn at frame
 * rate.
 */

import type { WorldSnapshot } from '../sim/simulation';
import type { TrackDef } from '../sim/track';

export class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private profile: Path2D | null = null;
  private profileSeed = '';
  private scaleX = 1;
  private scaleY = 1;
  private offsetY = 0;

  /** Furthest point any car has reached, which reveals the track. */
  exploredX = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.profile = null;
    }
  }

  private buildProfile(track: TrackDef): void {
    const { width, height } = this.canvas;
    const spanX = Math.max(track.endX - track.surface[0]!.x, 1);
    const spanY = Math.max(track.maxY - track.minY, 1);
    const pad = height * 0.12;

    this.scaleX = width / spanX;
    this.scaleY = (height - pad * 2) / spanY;
    this.offsetY = height - pad;

    const path = new Path2D();
    const x0 = track.surface[0]!.x;
    const toX = (x: number) => (x - x0) * this.scaleX;
    const toY = (y: number) => this.offsetY - (y - track.minY) * this.scaleY;

    path.moveTo(toX(x0), height);
    for (const p of track.surface) path.lineTo(toX(p.x), toY(p.y));
    path.lineTo(toX(track.endX), height);
    path.closePath();

    this.profile = path;
    this.profileSeed = track.seed;
  }

  draw(track: TrackDef, snapshot: WorldSnapshot | null, cameraX: number): void {
    this.resize();
    if (!this.profile || this.profileSeed !== track.seed) this.buildProfile(track);

    const { ctx, canvas } = this;
    const { width, height } = canvas;
    const x0 = track.surface[0]!.x;
    const toX = (x: number) => (x - x0) * this.scaleX;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, width, height);

    if (snapshot) this.exploredX = Math.max(this.exploredX, snapshot.bestX);

    // Unexplored track stays dim; the part cars have reached lights up.
    ctx.fillStyle = 'rgba(51, 65, 85, 0.5)';
    ctx.fill(this.profile!);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, toX(this.exploredX), height);
    ctx.clip();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.32)';
    ctx.fill(this.profile!);
    ctx.restore();

    if (snapshot) {
      for (let i = 0; i < snapshot.cars.length; i++) {
        const car = snapshot.cars[i]!;
        if (!car.alive) continue;
        const x = toX(car.chassis.x);
        ctx.fillStyle =
          i === snapshot.leaderIndex ? '#fde047' : car.isElite ? '#93c5fd' : '#fca5a5';
        ctx.fillRect(x - 1, 0, 2.5, height);
      }
    }

    // Viewport indicator.
    const viewLeft = toX(cameraX) - 12;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(viewLeft, 1, 24, height - 2);
    ctx.setLineDash([]);
  }
}
