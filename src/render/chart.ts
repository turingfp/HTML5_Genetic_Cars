/**
 * Fitness over time: best, elite average, and population average per
 * generation, with the archive's QD-score alongside on its own scale.
 *
 * The original plotted raw scores directly as pixel coordinates on a 200px
 * canvas, so once cars scored above 200, which happens within a few dozen
 * generations, the interesting part of the graph was off-screen. This scales
 * to the data.
 *
 * The QD line is the point of the pairing. Best-so-far moves in steps with
 * long flats between them; measured over four seeds it sat at 86.8m from
 * generation 13 to 16 while the archive score rose 15%. Drawn together, a
 * plateau in the yellow line with the teal line still climbing says the
 * search is working even when the headline number is stuck.
 */

export interface GenerationStats {
  generation: number;
  best: number;
  eliteAverage: number;
  average: number;
  /** The archive's QD-score as this generation ended. Its own scale. */
  qd?: number;
}

/** Teal, matching nothing else on the chart: it is not a fitness line. */
const QD_COLOR = '#5eead4';

const SERIES = [
  { key: 'best', color: '#fde047', label: 'best' },
  { key: 'eliteAverage', color: '#93c5fd', label: 'top half' },
  { key: 'average', color: '#fca5a5', label: 'average' },
] as const;

/** Round up to a clean axis maximum such as 150, 400, 1000. */
function niceCeil(value: number): number {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const step = [1, 1.5, 2, 3, 4, 5, 8, 10].find((s) => normalized <= s) ?? 10;
  return step * magnitude;
}

export class Chart {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  draw(history: GenerationStats[]): void {
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
    ctx.fillStyle = '#0b1120';
    ctx.fillRect(0, 0, w, h);

    const padLeft = 42 * dpr;
    const padRight = 8 * dpr;
    const padTop = 10 * dpr;
    const padBottom = 20 * dpr;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;

    if (history.length === 0) {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
      ctx.font = `${12 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('waiting for the first generation', w / 2, h / 2);
      return;
    }

    const maxValue = niceCeil(Math.max(...history.map((g) => g.best), 1));
    const lastGen = Math.max(history[history.length - 1]!.generation, 1);

    const toX = (gen: number) => padLeft + (gen / lastGen) * plotW;
    const toY = (value: number) => padTop + plotH - (value / maxValue) * plotH;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.65)';
    ctx.lineWidth = dpr;
    ctx.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i++) {
      const value = (maxValue * i) / 4;
      const y = toY(value);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(w - padRight, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(value)), padLeft - 6 * dpr, y);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`gen ${lastGen}`, w - padRight - 20 * dpr, h - padBottom + 5 * dpr);
    ctx.fillText('0', padLeft, h - padBottom + 5 * dpr);

    for (const series of SERIES) {
      ctx.beginPath();
      history.forEach((entry, i) => {
        const x = toX(entry.generation);
        const y = toY(entry[series.key]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 1.75 * dpr;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // The QD-score, dashed and on its own scale. Its unit is a sum over 144
    // cells, so plotting it against the fitness axis would either flatten the
    // fitness lines or leave itself invisible; what matters is its shape
    // against theirs, still rising while best is flat.
    const qdMax = niceCeil(Math.max(...history.map((g) => g.qd ?? 0), 1));
    const hasQd = history.some((g) => (g.qd ?? 0) > 0);
    if (hasQd) {
      ctx.beginPath();
      ctx.setLineDash([5 * dpr, 4 * dpr]);
      history.forEach((entry, i) => {
        const x = toX(entry.generation);
        const y = padTop + plotH - ((entry.qd ?? 0) / qdMax) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = QD_COLOR;
      ctx.lineWidth = 1.75 * dpr;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Legend, top-left of the plot.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let legendX = padLeft + 6 * dpr;
    const entries: { color: string; label: string }[] = [...SERIES];
    if (hasQd) entries.push({ color: QD_COLOR, label: 'QD' });
    for (const series of entries) {
      ctx.fillStyle = series.color;
      ctx.fillRect(legendX, padTop + 4 * dpr, 8 * dpr, 2.5 * dpr);
      ctx.fillStyle = 'rgba(203, 213, 225, 0.75)';
      ctx.fillText(series.label, legendX + 12 * dpr, padTop + 5 * dpr);
      legendX += ctx.measureText(series.label).width + 30 * dpr;
    }
  }
}
