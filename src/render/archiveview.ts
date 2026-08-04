/**
 * The archive, drawn: morphology space as a map that lights up.
 *
 * One square per niche. Dark squares are body shapes no working car has ever
 * had; coloured ones hold the best car of that shape found this session, hue
 * running cold to hot with score. This is the picture MAP-Elites is named
 * for: not a leaderboard, an illumination of the whole design space, and
 * watching it is watching the search decide which shapes are even worth
 * having.
 *
 * The map is an instrument, not a poster. Hovering a lit cell draws that
 * niche's actual elite, silhouette and wheels, beside the cursor; clicking
 * sends it back into the race. The grid without the hover was tried first and
 * failed the only test that matters, "what am I looking at": a coloured
 * square says a good car of some shape exists, the thumbnail shows you the
 * car.
 */

import { ARCHIVE_GRID, type ArchiveCell } from '../ga/archive';
import type { CarDef } from '../ga/genome';
import { drawThumbnail, ELITE_STYLE } from './carPath';

const REDRAW_INTERVAL_MS = 400;

/** How many generations an improvement stays visibly ringed. */
const FRESH_FOR = 3;

/** Space kept for the axis labels, in CSS pixels. */
const GUTTER = 16;

export interface ArchiveViewSource<T> {
  cells: (ArchiveCell<T> | null)[];
  bestScore: number;
}

export class ArchiveView<T> {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastDrawn = -Infinity;

  /** Called with the occupant when a lit cell is clicked. */
  onPick: ((def: T) => void) | null = null;

  /** Reduce a genome to the flat silhouette the preview can draw. */
  toSilhouette: ((def: T) => CarDef) | null = null;

  private source: ArchiveViewSource<T> | null = null;
  private generation = 0;

  /** The hover preview: a small card that follows the cursor between cells. */
  private readonly preview: HTMLDivElement;
  private readonly previewCanvas: HTMLCanvasElement;
  private readonly previewText: HTMLSpanElement;
  private previewFor: ArchiveCell<T> | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;

    this.preview = document.createElement('div');
    this.preview.className = 'archive-preview';
    this.preview.hidden = true;
    this.previewCanvas = document.createElement('canvas');
    this.previewText = document.createElement('span');
    this.preview.append(this.previewCanvas, this.previewText);
    // Attached beside the canvas so absolute positioning is relative to the
    // panel, which is the nearest positioned ancestor.
    canvas.parentElement?.append(this.preview);

    canvas.addEventListener('click', (event) => {
      const cell = this.cellAt(event);
      if (cell) this.onPick?.(cell.def);
    });
    canvas.addEventListener('pointermove', (event) => this.hover(event));
    canvas.addEventListener('pointerleave', () => {
      this.preview.hidden = true;
      this.previewFor = null;
    });
  }

  invalidate(): void {
    this.lastDrawn = -Infinity;
  }

  /** The grid's drawable region, in CSS pixels: everything but the gutters. */
  private plot(rect: DOMRect): { x: number; y: number; w: number; h: number } {
    return { x: GUTTER, y: 0, w: rect.width - GUTTER, h: rect.height - GUTTER };
  }

  private cellAt(event: MouseEvent): ArchiveCell<T> | null {
    if (!this.source) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const plot = this.plot(rect);
    const px = event.clientX - rect.left - plot.x;
    const py = event.clientY - rect.top - plot.y;
    const col = Math.floor((px / plot.w) * ARCHIVE_GRID);
    const row = Math.floor((py / plot.h) * ARCHIVE_GRID);
    if (col < 0 || col >= ARCHIVE_GRID || row < 0 || row >= ARCHIVE_GRID) return null;
    // Rows are drawn upwards: big bodies at the top, y flipped like any chart.
    const flipped = ARCHIVE_GRID - 1 - row;
    return this.source.cells[flipped * ARCHIVE_GRID + col] ?? null;
  }

  private hover(event: MouseEvent): void {
    const cell = this.cellAt(event);
    this.canvas.style.cursor = cell ? 'pointer' : 'default';
    if (!cell || !this.toSilhouette) {
      this.preview.hidden = true;
      this.previewFor = null;
      return;
    }

    // Redraw the card only when the cursor crosses into a different cell;
    // pointermove fires far too often to draw a thumbnail every time.
    if (this.previewFor !== cell) {
      this.previewFor = cell;
      const size = 72;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.previewCanvas.width = size * dpr;
      this.previewCanvas.height = size * dpr;
      this.previewCanvas.style.width = `${size}px`;
      this.previewCanvas.style.height = `${size}px`;
      const pctx = this.previewCanvas.getContext('2d');
      if (pctx) {
        pctx.scale(dpr, dpr);
        drawThumbnail(pctx, this.toSilhouette(cell.def), size, ELITE_STYLE);
      }
      this.previewText.textContent = `${cell.score.toFixed(1)} · gen ${cell.generation + 1} · click to race`;
    }

    // Beside the cursor, flipped to the left near the right edge so the card
    // never leaves the panel.
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const flip = x > rect.width * 0.55;
    this.preview.style.left = flip ? `${x - 104}px` : `${x + 14}px`;
    this.preview.style.top = `${Math.max(0, y - 40)}px`;
    this.preview.hidden = false;
  }

  draw(source: ArchiveViewSource<T>, generation: number): void {
    this.source = source;
    this.generation = generation;
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

    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    const plot = this.plot(rect);
    const px = plot.x * dpr;
    const pw = plot.w * dpr;
    const ph = plot.h * dpr;
    const cw = pw / ARCHIVE_GRID;
    const ch = ph / ARCHIVE_GRID;
    const best = Math.max(1e-6, source.bestScore);

    for (let row = 0; row < ARCHIVE_GRID; row++) {
      for (let col = 0; col < ARCHIVE_GRID; col++) {
        const cell = source.cells[row * ARCHIVE_GRID + col];
        const x = px + col * cw;
        const y = (ARCHIVE_GRID - 1 - row) * ch;
        if (!cell) {
          ctx.fillStyle = 'rgba(148, 163, 184, 0.07)';
          ctx.fillRect(x + 0.5 * dpr, y + 0.5 * dpr, cw - dpr, ch - dpr);
          continue;
        }
        // Cold blue for weak niches through to warm yellow for the champion's,
        // scaled to the archive's own best so the map stays readable while
        // scores grow.
        const value = Math.max(0, Math.min(1, cell.score / best));
        const hue = 215 - value * 165;
        const light = 30 + value * 30;
        ctx.fillStyle = `hsl(${hue}, 85%, ${light}%)`;
        ctx.fillRect(x + 0.5 * dpr, y + 0.5 * dpr, cw - dpr, ch - dpr);

        if (this.generation - cell.generation < FRESH_FOR) {
          // A ring on recent finds, so a session's progress reads at a glance:
          // early on the whole map rings, later only the frontier does.
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.lineWidth = dpr;
          ctx.strokeRect(x + 1.5 * dpr, y + 1.5 * dpr, cw - 3 * dpr, ch - 3 * dpr);
        }
      }
    }

    // The axes, labelled in the gutters. Without these the map is a texture;
    // with them it is a chart of body designs.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = `${10 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('wheel size →', px + pw / 2, ph + (GUTTER / 2) * dpr);
    ctx.save();
    ctx.translate((GUTTER / 2) * dpr, ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('body size →', 0, 0);
    ctx.restore();
  }
}
