/**
 * Camera and canvas sizing.
 *
 * Handles device pixel ratio and element resizes, which the original ignored:
 * its canvases were a hardcoded 800x400 and looked soft on any modern display.
 */

import {
  CAMERA_SMOOTHING,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  PHYSICS_HZ,
  TARGET_VISIBLE_METRES,
} from '../config';

export class Camera {
  x = 0;
  y = 0;
  zoom = DEFAULT_ZOOM;

  /** CSS pixel size of the canvas. */
  width = 0;
  height = 0;

  private canvas: HTMLCanvasElement;
  private observer: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Match the backing store to the element's size and pixel density. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.width = width;
    this.height = height;
    const bw = Math.round(width * dpr);
    const bh = Math.round(height * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /** Ease toward a target, at a rate independent of frame rate. */
  follow(targetX: number, targetY: number, dt: number): void {
    // The original lerped by 0.05 every 60Hz frame; match that curve exactly
    // however often we actually draw.
    const factor = 1 - Math.pow(1 - CAMERA_SMOOTHING, dt * PHYSICS_HZ);
    this.x += (targetX - this.x) * factor;
    this.y += (targetY - this.y) * factor;
  }

  snapTo(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  }

  /** Zoom that frames a comfortable span of track for the current width. */
  fitZoom(): number {
    if (this.width === 0) return DEFAULT_ZOOM;
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.width / TARGET_VISIBLE_METRES));
  }

  /**
   * Apply the world transform: y-up, metres, with the camera a third of the
   * way across the viewport so there is room to see what is ahead.
   */
  applyTransform(ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(this.width * 0.33 - this.x * this.zoom, this.height * 0.55 + this.y * this.zoom);
    ctx.scale(this.zoom, -this.zoom);
  }

  /** Reset to plain CSS-pixel coordinates for overlays. */
  applyScreenTransform(ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** World-space rectangle currently visible, with a margin for culling. */
  visibleRange(margin = 2): { minX: number; maxX: number } {
    const halfLeft = (this.width * 0.33) / this.zoom;
    const halfRight = (this.width * 0.67) / this.zoom;
    return { minX: this.x - halfLeft - margin, maxX: this.x + halfRight + margin };
  }
}
