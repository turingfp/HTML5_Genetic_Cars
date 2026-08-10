/**
 * The driver network, drawn live.
 *
 * Three columns of nodes with every weight between them. Nodes glow with what
 * they are firing right now, edges are coloured by the sign of their weight and
 * thickened by its size, and a signal only lights up an edge when both the
 * weight and the node feeding it are doing something.
 *
 * The point is to make the evolution legible. Watch one car through a hard
 * climb and you can see which senses it actually leans on: most of the edges
 * out of a sense it ignores fade to nothing over a few generations.
 */

import { INK_DIM, INK_FAINT, INK_STRONG, NEGATIVE_RGB, POSITIVE_RGB } from './palette';
import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_OUTPUTS,
  BRAIN_RECURRENT,
  INPUT_LABELS,
  OUTPUT_LABELS,
  motorMultiplier,
  recurrentIndex,
  weightIndex,
  type Brain,
} from '../ga/brain';

/** Everything the panel needs about one car. */
export interface BrainViewCar {
  brain: Brain | null;
  activations: Float32Array | null;
  /** What the hidden layer is carrying into the next step. */
  memory: Float32Array | null;
  alive: boolean;
}

const POSITIVE = POSITIVE_RGB;
const NEGATIVE = NEGATIVE_RGB;

export class BrainView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot provide a 2D canvas context.');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  draw(car: BrainViewCar | null): void {
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

    if (!car?.brain || !car.activations) {
      ctx.fillStyle = INK_FAINT;
      ctx.font = `${11 * dpr}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('no car selected', w / 2, h / 2);
      return;
    }

    const labelSpace = 42 * dpr;
    const padY = 14 * dpr;
    const left = labelSpace;
    const right = w - labelSpace;
    const columnGap = (right - left) / 2;
    const radius = Math.min(7 * dpr, (h - padY * 2) / (BRAIN_INPUTS * 2.6));

    const columnY = (count: number, i: number) => {
      if (count === 1) return h / 2;
      const usable = h - padY * 2;
      return padY + (usable * i) / (count - 1);
    };

    const a = car.activations;
    const weights = car.brain.weights;
    const dim = car.alive ? 1 : 0.35;

    // Edges first, so nodes sit on top of them.
    ctx.lineCap = 'round';
    for (let i = 0; i < BRAIN_INPUTS; i++) {
      for (let hIdx = 0; hIdx < BRAIN_HIDDEN; hIdx++) {
        this.edge(
          left,
          columnY(BRAIN_INPUTS, i),
          left + columnGap,
          columnY(BRAIN_HIDDEN, hIdx),
          weights[weightIndex(0, i, hIdx)] ?? 0,
          (a[i] ?? 0) * dim,
          dpr,
        );
      }
    }
    for (let hIdx = 0; hIdx < BRAIN_HIDDEN; hIdx++) {
      for (let o = 0; o < BRAIN_OUTPUTS; o++) {
        this.edge(
          left + columnGap,
          columnY(BRAIN_HIDDEN, hIdx),
          right,
          columnY(BRAIN_OUTPUTS, o),
          weights[weightIndex(1, hIdx, o)] ?? 0,
          (a[BRAIN_INPUTS + hIdx] ?? 0) * dim,
          dpr,
        );
      }
    }

    ctx.font = `${9.5 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textBaseline = 'middle';

    for (let i = 0; i < BRAIN_INPUTS; i++) {
      const y = columnY(BRAIN_INPUTS, i);
      this.node(left, y, radius, (a[i] ?? 0) * dim);
      ctx.textAlign = 'right';
      ctx.fillStyle = INK_DIM;
      ctx.fillText(INPUT_LABELS[i] ?? '', left - radius - 5 * dpr, y);
    }

    const memory = car.memory;
    for (let hIdx = 0; hIdx < BRAIN_HIDDEN; hIdx++) {
      const y = columnY(BRAIN_HIDDEN, hIdx);
      // The loop first, so the node sits on top of it.
      if (hIdx < BRAIN_RECURRENT) {
        let outgoing = 0;
        for (let to = 0; to < BRAIN_HIDDEN; to++) {
          outgoing += Math.abs(weights[recurrentIndex(hIdx, to)] ?? 0);
        }
        this.loop(
          left + columnGap,
          y,
          radius,
          Math.min(1, outgoing / (BRAIN_HIDDEN * 0.8)),
          (memory?.[hIdx] ?? 0) * dim,
          dpr,
        );
      }
      this.node(left + columnGap, y, radius, (a[BRAIN_INPUTS + hIdx] ?? 0) * dim);
    }

    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      const y = columnY(BRAIN_OUTPUTS, o);
      const value = a[BRAIN_INPUTS + BRAIN_HIDDEN + o] ?? 0;
      this.node(right, y, radius * 1.25, value * dim);
      ctx.textAlign = 'left';
      ctx.fillStyle = INK_DIM;
      ctx.fillText(OUTPUT_LABELS[o] ?? '', right + radius + 6 * dpr, y - 6 * dpr);
      // The number that actually reaches the motor, which is the only part of
      // this whole picture with a unit attached.
      ctx.fillStyle = car.alive ? INK_STRONG : INK_FAINT;
      ctx.fillText(`${(motorMultiplier(value) * 100).toFixed(0)}%`, right + radius + 6 * dpr, y + 6 * dpr);
    }
  }

  /**
   * A hidden unit's memory, drawn as a loop above it.
   *
   * These are the recurrent weights, and drawing all of them as lines from the
   * hidden column back to itself was an unreadable knot. One loop per unit says
   * the useful part: how strongly it feeds itself and its neighbours forward in
   * time, and what it is carrying right now.
   */
  private loop(
    x: number,
    y: number,
    radius: number,
    strength: number,
    carried: number,
    dpr: number,
  ): void {
    if (strength < 0.05) return;
    const { ctx } = this;
    const magnitude = Math.min(1, Math.abs(carried));
    const [r, g, b] = carried >= 0 ? POSITIVE : NEGATIVE;

    // Counter-clockwise from 0 to PI sweeps over the top of the circle. Going
    // the other way put the loop underneath, where the node covered it.
    ctx.beginPath();
    ctx.arc(x, y - radius * 1.15, radius * 0.78, 0, Math.PI, true);
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.18 + strength * 0.22 + magnitude * 0.55})`;
    ctx.lineWidth = (0.7 + strength * 1.6) * dpr;
    ctx.stroke();
  }

  private edge(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    weight: number,
    signal: number,
    dpr: number,
  ): void {
    const { ctx } = this;
    const strength = Math.min(1, Math.abs(weight) / 1.5);
    if (strength < 0.02) return;

    const [r, g, b] = weight >= 0 ? POSITIVE : NEGATIVE;
    // A weight that is never fed carries nothing, however big it is, so the
    // resting picture is the wiring and the live picture is the traffic.
    const flow = Math.min(1, Math.abs(signal) * strength);
    const alpha = 0.06 + strength * 0.16 + flow * 0.5;

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.lineWidth = (0.5 + strength * 1.6 + flow * 1.2) * dpr;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  private node(x: number, y: number, radius: number, value: number): void {
    const { ctx } = this;
    const magnitude = Math.min(1, Math.abs(value));
    const [r, g, b] = value >= 0 ? POSITIVE : NEGATIVE;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(250, 247, 238, 0.95)';
    ctx.fill();

    if (magnitude > 0.01) {
      ctx.beginPath();
      ctx.arc(x, y, radius * (0.3 + 0.7 * magnitude), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.25 + magnitude * 0.7})`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(33, 29, 22, ${0.3 + magnitude * 0.4})`;
    ctx.lineWidth = Math.max(1, radius * 0.12);
    ctx.stroke();
  }
}
