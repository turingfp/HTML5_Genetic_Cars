/**
 * The animation loop.
 *
 * One requestAnimationFrame drives both physics and drawing, on a fixed
 * timestep. The original used two independent setIntervals, which drifted
 * apart and got throttled to a crawl in background tabs.
 */

import { MAX_MODE_BUDGET_MS, MAX_STEPS_PER_FRAME, TIME_STEP, type Speed } from '../config';

export interface LoopCallbacks {
  /** Advance the simulation one fixed step. */
  step: () => void;
  /** Draw the current state. `alpha` is the fraction into the pending step. */
  draw: (alpha: number) => void;
}

export class Loop {
  private callbacks: LoopCallbacks;
  private accumulator = 0;
  private lastTime = 0;
  private handle: number | null = null;

  speed: Speed = 1;
  paused = false;

  /** Physics steps executed in the last second, for the perf readout. */
  stepsPerSecond = 0;
  private stepsThisSecond = 0;
  private secondMark = 0;

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.handle !== null) return;
    this.lastTime = performance.now();
    this.secondMark = this.lastTime;
    const frame = (now: number) => {
      this.handle = requestAnimationFrame(frame);
      this.tick(now);
    };
    this.handle = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.handle !== null) cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  /** Drop accumulated time, e.g. after returning to a hidden tab. */
  resetClock(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  private tick(now: number): void {
    // Clamp so a long stall (tab switch, breakpoint) cannot queue up minutes
    // of catch-up physics.
    const elapsed = Math.min((now - this.lastTime) / 1000, 0.25);
    this.lastTime = now;

    if (!this.paused) {
      if (this.speed === 'max') {
        // Run as many steps as fit in a slice of the frame, so the page stays
        // responsive while evolution races ahead.
        const deadline = now + MAX_MODE_BUDGET_MS;
        do {
          this.callbacks.step();
          this.stepsThisSecond++;
        } while (performance.now() < deadline);
        this.accumulator = 0;
      } else {
        this.accumulator += elapsed * this.speed;
        let steps = 0;
        while (this.accumulator >= TIME_STEP && steps < MAX_STEPS_PER_FRAME) {
          this.callbacks.step();
          this.stepsThisSecond++;
          this.accumulator -= TIME_STEP;
          steps++;
        }
        // If we hit the cap we are running behind; drop the debt rather than
        // spiralling.
        if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
      }
    }

    if (now - this.secondMark >= 1000) {
      this.stepsPerSecond = Math.round((this.stepsThisSecond * 1000) / (now - this.secondMark));
      this.stepsThisSecond = 0;
      this.secondMark = now;
    }

    const alpha = this.speed === 'max' || this.paused ? 1 : this.accumulator / TIME_STEP;
    this.callbacks.draw(alpha);
  }
}
