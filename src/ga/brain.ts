/**
 * The driver: a tiny neural network that decides how hard each wheel turns.
 *
 * The original BoxCar2D and rednuht's version evolved bodies only. Every wheel
 * spun at one fixed speed forever, so a car was a shape and nothing else, and
 * the whole search was "what silhouette survives being dragged over a hill".
 *
 * Here every car also carries a small network, and its weights are genes like
 * any other. It reads how the car is sitting and moving, and sets the speed of
 * each wheel. So a car can learn to ease off before a crest, or dig in on a
 * climb, instead of flooring it into everything.
 *
 * Kept deliberately small. It is 47 numbers, it runs 20 times per physics step,
 * and you can watch every weight of it on screen without squinting.
 */

import type { Rng } from '../core/rng';
import { mutateValue, type MutationParams } from './mutation';

/** What the car can feel. Everything arrives roughly inside [-1, 1]. */
export const BRAIN_INPUTS = 6;

/** The middle layer, where combinations of senses turn into intentions. */
export const BRAIN_HIDDEN = 5;

/** One output per wheel. In 3D the two wheels of a pair share an output. */
export const BRAIN_OUTPUTS = 2;

/** Both layers get a bias, which is why each fan-in is one wider than it looks. */
export const BRAIN_WEIGHT_COUNT =
  (BRAIN_INPUTS + 1) * BRAIN_HIDDEN + (BRAIN_HIDDEN + 1) * BRAIN_OUTPUTS;

/** Every activation in order: inputs, then hidden, then outputs. */
export const BRAIN_NODE_COUNT = BRAIN_INPUTS + BRAIN_HIDDEN + BRAIN_OUTPUTS;

/** Weights are drawn from and mutated within [-WEIGHT_LIMIT, +WEIGHT_LIMIT]. */
const WEIGHT_LIMIT = 1.5;
const WEIGHT_RANGE = WEIGHT_LIMIT * 2;

/**
 * Names for the visualisation, in activation order. Short enough to fit beside
 * a node on a phone.
 */
export const INPUT_LABELS = ['pitch', 'roll', 'speed', 'drop', 'spin', 'slope'] as const;
export const OUTPUT_LABELS = ['wheel A', 'wheel B'] as const;

export interface Brain {
  /**
   * Flat weight list: the hidden layer's fan-in first, then the output layer's.
   * Flat because it makes crossover and mutation one loop each.
   */
  weights: number[];
}

/** What a car knows about itself on this step. */
export interface Sensors {
  /** Nose up is positive. */
  pitch: number;
  /** Leaning right is positive. Always zero in the flat mode. */
  roll: number;
  /** Speed along the course. */
  speed: number;
  /** Falling is negative. */
  drop: number;
  /** How fast the body is tumbling. */
  spin: number;
  /** How steeply the ground ahead rises. */
  slope: number;
}

export function emptySensors(): Sensors {
  return { pitch: 0, roll: 0, speed: 0, drop: 0, spin: 0, slope: 0 };
}

export function randomBrain(rng: Rng): Brain {
  const weights = new Array<number>(BRAIN_WEIGHT_COUNT);
  for (let i = 0; i < BRAIN_WEIGHT_COUNT; i++) {
    weights[i] = rng() * WEIGHT_RANGE - WEIGHT_LIMIT;
  }
  return { weights };
}

export function cloneBrain(brain: Brain): Brain {
  return { weights: brain.weights.slice() };
}

/**
 * Uniform crossover, one weight at a time.
 *
 * The body uses two-point crossover because its genes are ordered and adjacent
 * ones belong together. Network weights have no such neighbourhood, so cutting
 * the list in two places would be arbitrary.
 */
export function crossoverBrain(rng: Rng, a: Brain, b: Brain): Brain {
  const weights = new Array<number>(BRAIN_WEIGHT_COUNT);
  for (let i = 0; i < BRAIN_WEIGHT_COUNT; i++) {
    weights[i] = (rng() < 0.5 ? a : b).weights[i] ?? 0;
  }
  return { weights };
}

export function mutateBrain(rng: Rng, brain: Brain, params: MutationParams): Brain {
  for (let i = 0; i < BRAIN_WEIGHT_COUNT; i++) {
    if (rng() >= params.rate) continue;
    brain.weights[i] = mutateValue(
      rng,
      brain.weights[i] ?? 0,
      -WEIGHT_LIMIT,
      WEIGHT_RANGE,
      params.size,
    );
  }
  return brain;
}

/**
 * A brain that has been repaired or grown, so an older saved car still runs.
 *
 * Cars stored before the network existed have no weights at all, and there is
 * no sensible way to invent a driver for them, so they get a random one.
 */
export function ensureBrain(rng: Rng, brain: Brain | undefined | null): Brain {
  if (!brain || !Array.isArray(brain.weights)) return randomBrain(rng);
  if (brain.weights.length === BRAIN_WEIGHT_COUNT) return brain;
  const fixed = randomBrain(rng);
  for (let i = 0; i < Math.min(brain.weights.length, BRAIN_WEIGHT_COUNT); i++) {
    const w = brain.weights[i];
    if (typeof w === 'number' && Number.isFinite(w)) fixed.weights[i] = w;
  }
  return fixed;
}

function tanh(x: number): number {
  // Saturate early rather than call Math.tanh on huge values every step.
  if (x > 8) return 1;
  if (x < -8) return -1;
  const e = Math.exp(2 * x);
  return (e - 1) / (e + 1);
}

/**
 * Somewhere to run a brain without allocating.
 *
 * One of these lives on each car, holds the activations from the last step, and
 * is handed straight to the visualisation.
 */
export class BrainRuntime {
  /** Inputs, then hidden, then outputs, in that order. */
  readonly activations = new Float32Array(BRAIN_NODE_COUNT);

  /** Run one forward pass and leave the result in `activations`. */
  evaluate(brain: Brain, sensors: Sensors): void {
    const a = this.activations;
    const w = brain.weights;

    a[0] = clamp1(sensors.pitch);
    a[1] = clamp1(sensors.roll);
    a[2] = clamp1(sensors.speed);
    a[3] = clamp1(sensors.drop);
    a[4] = clamp1(sensors.spin);
    a[5] = clamp1(sensors.slope);

    let k = 0;
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < BRAIN_INPUTS; i++) sum += (a[i] ?? 0) * (w[k++] ?? 0);
      sum += w[k++] ?? 0;
      a[BRAIN_INPUTS + h] = tanh(sum);
    }

    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < BRAIN_HIDDEN; h++) sum += (a[BRAIN_INPUTS + h] ?? 0) * (w[k++] ?? 0);
      sum += w[k++] ?? 0;
      a[BRAIN_INPUTS + BRAIN_HIDDEN + o] = tanh(sum);
    }
  }

  /** Output for one wheel, in [-1, 1]. */
  output(index: number): number {
    return this.activations[BRAIN_INPUTS + BRAIN_HIDDEN + index] ?? 0;
  }
}

/**
 * Turn an output into a wheel speed multiplier.
 *
 * The floor sits just below zero rather than at full reverse. A network wired
 * at random should still produce a car that drives, or the first generation is
 * twenty motionless boxes and there is nothing for selection to work with. What
 * it can do is stall a wheel, overdrive it to half again, or back off a touch
 * to get a run at something.
 */
export const MOTOR_BASE = 0.7;
export const MOTOR_GAIN = 0.8;

export function motorMultiplier(output: number): number {
  return MOTOR_BASE + MOTOR_GAIN * output;
}

function clamp1(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Where each weight sits, so the visualisation can draw the edges without
 * re-deriving the layout. Index into `Brain.weights`.
 */
export function weightIndex(layer: 0 | 1, from: number, to: number): number {
  if (layer === 0) return to * (BRAIN_INPUTS + 1) + from;
  return (BRAIN_INPUTS + 1) * BRAIN_HIDDEN + to * (BRAIN_HIDDEN + 1) + from;
}
