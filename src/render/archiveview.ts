/**
 * The archive, drawn: morphology space as a map that lights up.
 *
 * One square per niche. Dark squares are body shapes no working car has ever
 * had; coloured ones hold the best car of that shape found this session, hue
 * running cold to hot with score. This is the picture MAP-Elites is named
 * for: not a leaderboard, an illumination of the whole design space, and
 * watching it is watching the search decide which shapes are even worth
 * having. Click a lit square and its elite joins the next generation, so the
 * map is not just a record, it is a bench you can pull from.
 */

import { ARCHIVE_GRID, type ArchiveCell } from '../ga/archive';

const REDRAW_INTERVAL_MS = 400;

/** How many generations a fresh discovery stays visibly marked. */
const FRESH_FOR = 3;

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

  private source: ArchiveViewSource<T> | null = null;
  private generation = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;

    canvas.addEventListener('click', (event) => {
      const cell = this.cellAt(event);
      if (cell) this.onPick?.(cell.def);
    });
    canvas.addEventListener('pointermove', (event) => {
      const cell = this.cellAt(event);
      this.canvas.style.cursor = cell ? 'pointer' : 'default';
      this.canvas.title = cell
        ? `${cell.score.toFixed(1)} points, found in generation ${cell.generation + 1}. Click to race it.`
        : 'No car with this body shape has finished a run yet.';
    });
  }

  invalidate(): void {
    this.lastDrawn = -Infinity;
  }

  private cellAt(event: MouseEvent): ArchiveCell<T> | null {
    if (!this.source) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * ARCHIVE_GRID);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * ARCHIVE_GRID);
    if (col < 0 || col >= ARCHIVE_GRID || row < 0 || row >= ARCHIVE_GRID) return null;
    // Rows are drawn upwards: big bodies at the top, y flipped like any chart.
    const flipped = ARCHIVE_GRID - 1 - row;
    return this.source.cells[flipped * ARCHIVE_GRID + col] ?? null;
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
    const cw = w / ARCHIVE_GRID;
    const ch = h / ARCHIVE_GRID;
    const best = Math.max(1e-6, source.bestScore);

    for (let row = 0; row < ARCHIVE_GRID; row++) {
      for (let col = 0; col < ARCHIVE_GRID; col++) {
        const cell = source.cells[row * ARCHIVE_GRID + col];
        const x = col * cw;
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
  }
}
