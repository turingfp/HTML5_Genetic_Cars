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
 * Kept deliberately small: 94 numbers, run 20 times per physics step, and you
 * can watch every weight of it on screen without squinting.
 *
 * A note on sizing, because bigger looked obviously better and was not. An
 * earlier pass ran this at 8 hidden units, and measured over twelve runs it was
 * worse than five: the population is 20 cars, and a search space that wide is
 * simply not explorable in the generations anyone will sit through. What the
 * driver is allowed to do turned out to matter far more than how much of it
 * there is. See the README for the numbers.
 */

import { MAX_WHEEL_COUNT } from '../config';
import type { Rng } from '../core/rng';
import type { MutationParams } from './mutation';

/** What the car can feel. Everything arrives roughly inside [-1, 1]. */
export const BRAIN_INPUTS = 10;

/** The middle layer, where combinations of senses turn into intentions. */
export const BRAIN_HIDDEN = 5;

/**
 * One output per wheel slot. A car with fewer wheels simply leaves the spare
 * outputs unread, which costs a handful of weights and keeps every genome the
 * same length, so crossover between a two wheeler and a four wheeler needs no
 * special case. In 3D both wheels of a mirrored pair take the same one, and
 * the difference between the sides comes from the steering output below.
 */
export const BRAIN_WHEEL_OUTPUTS = MAX_WHEEL_COUNT;

export const BRAIN_OUTPUTS = MAX_WHEEL_COUNT;

/**
 * Each hidden unit also sees what every hidden unit did on the previous step,
 * which is the whole of the network's memory.
 *
 * Without it the driver is a pure reflex: it cannot tell "rocking against a
 * rock for the last second" from "about to crest a rise", because both look
 * identical in a single frame. One step of feedback is enough to carry that.
 */
export const BRAIN_RECURRENT = BRAIN_HIDDEN;

/** Both layers get a bias, which is why each fan-in is one wider than it looks. */
export const BRAIN_WEIGHT_COUNT =
  (BRAIN_INPUTS + BRAIN_RECURRENT + 1) * BRAIN_HIDDEN + (BRAIN_HIDDEN + 1) * BRAIN_OUTPUTS;

/** Every activation in order: inputs, then hidden, then outputs. */
export const BRAIN_NODE_COUNT = BRAIN_INPUTS + BRAIN_HIDDEN + BRAIN_OUTPUTS;

/** Weights are drawn from and mutated within [-WEIGHT_LIMIT, +WEIGHT_LIMIT]. */
const WEIGHT_LIMIT = 1.5;
const WEIGHT_RANGE = WEIGHT_LIMIT * 2;

/**
 * Names for the visualisation, in activation order. Short enough to fit beside
 * a node on a phone.
 */
export const INPUT_LABELS = [
  'pitch',
  'roll',
  'speed',
  'drop',
  'spin',
  'near',
  'mid',
  'far',
  'edge',
  'slide',
] as const;
export const OUTPUT_LABELS = ['wheel A', 'wheel B', 'wheel C', 'wheel D'] as const;

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
  /**
   * How steeply the ground rises at three distances ahead.
   *
   * One sample was the immediate gradient and nothing else, so a driver could
   * only ever react to what it was already on. Three gives it the shape of what
   * is coming: a wall at `far` and flat ground at `near` is a run-up, and the
   * same wall at `near` is a problem now.
   */
  near: number;
  mid: number;
  far: number;
  /**
   * Where the car sits across the road: 0 down the middle, ±1 at the edge.
   *
   * Without this the driver could not tell the centre of the road from the
   * lip of it, which is most of why more than half of all deaths were cars
   * driving off the side. Always zero in the flat mode, which has no sides.
   */
  edge: number;
  /** How fast it is sliding towards an edge. Falling off is a rate, not a place. */
  slide: number;
}

export function emptySensors(): Sensors {
  return {
    pitch: 0,
    roll: 0,
    speed: 0,
    drop: 0,
    spin: 0,
    near: 0,
    mid: 0,
    far: 0,
    edge: 0,
    slide: 0,
  };
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

/**
 * How wide a mutation step is, relative to the whole weight range, at mutation
 * size 100%.
 *
 * The body genes are mutated by resampling inside a window, and at size 100%
 * that window is the entire range: a mutated gene is simply re-rolled. That is
 * fine for "how long is this strut", where any value is as good a guess as any
 * other. It is wrong for a network weight, where a working driver is a
 * particular combination and re-rolling one of them at random destroys it. So
 * weights creep instead: a Gaussian nudge around the value they already have.
 */
const MUTATION_SIGMA = 0.22;

/** A standard normal from a uniform source, via Box-Muller. */
function gaussian(rng: Rng): number {
  let u = rng();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function mutateBrain(rng: Rng, brain: Brain, params: MutationParams): Brain {
  const sigma = WEIGHT_RANGE * MUTATION_SIGMA * params.size;
  for (let i = 0; i < BRAIN_WEIGHT_COUNT; i++) {
    if (rng() >= params.rate) continue;
    const next = (brain.weights[i] ?? 0) + gaussian(rng) * sigma;
    brain.weights[i] = next < -WEIGHT_LIMIT ? -WEIGHT_LIMIT : next > WEIGHT_LIMIT ? WEIGHT_LIMIT : next;
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

  /** What the hidden layer did last step. This is the memory. */
  readonly memory = new Float32Array(BRAIN_RECURRENT);

  /** Run one forward pass and leave the result in `activations`. */
  evaluate(brain: Brain, sensors: Sensors): void {
    const a = this.activations;
    const m = this.memory;
    const w = brain.weights;

    a[0] = clamp1(sensors.pitch);
    a[1] = clamp1(sensors.roll);
    a[2] = clamp1(sensors.speed);
    a[3] = clamp1(sensors.drop);
    a[4] = clamp1(sensors.spin);
    a[5] = clamp1(sensors.near);
    a[6] = clamp1(sensors.mid);
    a[7] = clamp1(sensors.far);
    a[8] = clamp1(sensors.edge);
    a[9] = clamp1(sensors.slide);

    let k = 0;
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = 0;
      for (let i = 0; i < BRAIN_INPUTS; i++) sum += (a[i] ?? 0) * (w[k++] ?? 0);
      for (let r = 0; r < BRAIN_RECURRENT; r++) sum += (m[r] ?? 0) * (w[k++] ?? 0);
      sum += w[k++] ?? 0;
      a[BRAIN_INPUTS + h] = tanh(sum);
    }

    for (let o = 0; o < BRAIN_OUTPUTS; o++) {
      let sum = 0;
      for (let h = 0; h < BRAIN_HIDDEN; h++) sum += (a[BRAIN_INPUTS + h] ?? 0) * (w[k++] ?? 0);
      sum += w[k++] ?? 0;
      a[BRAIN_INPUTS + BRAIN_HIDDEN + o] = tanh(sum);
    }

    // Carried into the next step. Written after the whole layer is computed, so
    // every hidden unit sees the same previous state rather than a mix of old
    // and new depending on its index.
    for (let h = 0; h < BRAIN_HIDDEN; h++) m[h] = a[BRAIN_INPUTS + h] ?? 0;
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
 *
 * Full reverse was tried and measured. In the flat mode it is a clear win, and
 * a car that can back off and take another go at an obstacle gets about 5%
 * further. In 3D it loses more than that, because reversing near a banked edge
 * is how a car falls off, and falling off is instant death where grinding to a
 * halt is merely slow. 3D is the mode this opens in, so the floor stays here.
 */
export const MOTOR_BASE = 0.7;
export const MOTOR_GAIN = 0.8;

/**
 * Steering was tried and measured, and it made the cars worse.
 *
 * A skid steer output that leaned power across the pairs, so a driver could
 * actually turn away from an edge. Over six seeds and twenty generations each:
 * at full authority the best car went 83.9m against 86.8m for no steering at
 * all, at half authority 89.9m, and with the channel present but inert 96.2m.
 * Monotonic, and the wrong way round. The authority to steer is the authority
 * to spin out, and a car that can whip itself sideways finds an edge faster
 * than one that can only go straight. What the driver needed was not a
 * steering wheel but somewhere to look: the same run with the edge sensors and
 * no steering is the 96.2m. So the sensors stayed and this went.
 */

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
 *
 * Layer 0 is the fan-in of a hidden unit, and it is wider than the input layer:
 * inputs first, then the recurrent slots, then the bias. Layer 1 is an output's
 * fan-in. `recurrentIndex` names the memory slots inside layer 0.
 */
export function weightIndex(layer: 0 | 1, from: number, to: number): number {
  const hiddenFanIn = BRAIN_INPUTS + BRAIN_RECURRENT + 1;
  if (layer === 0) return to * hiddenFanIn + from;
  return hiddenFanIn * BRAIN_HIDDEN + to * (BRAIN_HIDDEN + 1) + from;
}

/** Weight carrying hidden unit `from`'s last value into hidden unit `to`. */
export function recurrentIndex(from: number, to: number): number {
  return weightIndex(0, BRAIN_INPUTS + from, to);
}
