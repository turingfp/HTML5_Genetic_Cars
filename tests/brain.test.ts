/**
 * The driver network.
 *
 * The two things worth pinning down are that the weights survive breeding
 * intact, and that `weightIndex` agrees with the order `evaluate` reads them
 * in. The second one is invisible until the visualisation draws an edge from
 * the wrong node, which looks plausible and is completely wrong.
 */

import { describe, expect, it } from 'vitest';

import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_NODE_COUNT,
  BRAIN_OUTPUTS,
  BRAIN_WEIGHT_COUNT,
  BrainRuntime,
  cloneBrain,
  crossoverBrain,
  emptySensors,
  ensureBrain,
  motorMultiplier,
  mutateBrain,
  randomBrain,
  weightIndex,
  type Brain,
} from '../src/ga/brain';
import { rngFromSeed } from '../src/core/rng';
import { randomCar } from '../src/ga/genome';
import { Simulation } from '../src/sim/simulation';

const LIMIT = 1.5;

function zeroBrain(): Brain {
  return { weights: new Array<number>(BRAIN_WEIGHT_COUNT).fill(0) };
}

describe('brain', () => {
  it('is the size the layers say it is', () => {
    const brain = randomBrain(rngFromSeed('size'));
    expect(brain.weights).toHaveLength(BRAIN_WEIGHT_COUNT);
    expect(BRAIN_WEIGHT_COUNT).toBe(
      (BRAIN_INPUTS + 1) * BRAIN_HIDDEN + (BRAIN_HIDDEN + 1) * BRAIN_OUTPUTS,
    );
    expect(BRAIN_NODE_COUNT).toBe(BRAIN_INPUTS + BRAIN_HIDDEN + BRAIN_OUTPUTS);
    for (const w of brain.weights) expect(Math.abs(w)).toBeLessThanOrEqual(LIMIT);
  });

  it('takes every weight from one parent or the other', () => {
    const rng = rngFromSeed('cross');
    const a: Brain = { weights: new Array<number>(BRAIN_WEIGHT_COUNT).fill(1) };
    const b: Brain = { weights: new Array<number>(BRAIN_WEIGHT_COUNT).fill(-1) };
    const child = crossoverBrain(rng, a, b);
    expect(child.weights).toHaveLength(BRAIN_WEIGHT_COUNT);
    for (const w of child.weights) expect(Math.abs(w)).toBe(1);
    // With 47 coin flips, drawing entirely from one parent would be a 1-in-10^14
    // event, so a child that looks like a clone means crossover is not running.
    expect(new Set(child.weights).size).toBe(2);
  });

  it('stays inside the weight limit however long it mutates', () => {
    const rng = rngFromSeed('mutate');
    const brain = randomBrain(rng);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      mutateBrain(rng, brain, { rate: 0.5, size: rng() });
      for (const w of brain.weights) worst = Math.max(worst, Math.abs(w));
    }
    expect(worst).toBeLessThanOrEqual(LIMIT + 1e-9);
  });

  it('clones deeply, so a parent is not disturbed by its child', () => {
    const brain = randomBrain(rngFromSeed('clone'));
    const copy = cloneBrain(brain);
    copy.weights[0] = 99;
    expect(brain.weights[0]).not.toBe(99);
  });

  it('lays weights out where weightIndex says they are', () => {
    // One weight at a time, with a one-hot input: whatever lights up is where
    // that weight actually lives.
    for (let input = 0; input < BRAIN_INPUTS; input++) {
      for (let hidden = 0; hidden < BRAIN_HIDDEN; hidden++) {
        const brain = zeroBrain();
        brain.weights[weightIndex(0, input, hidden)] = 1;

        const sensors = emptySensors();
        const keys = ['pitch', 'roll', 'speed', 'drop', 'spin', 'slope'] as const;
        sensors[keys[input]!] = 1;

        const runtime = new BrainRuntime();
        runtime.evaluate(brain, sensors);
        for (let h = 0; h < BRAIN_HIDDEN; h++) {
          const value = runtime.activations[BRAIN_INPUTS + h]!;
          if (h === hidden) expect(value).toBeGreaterThan(0.7);
          else expect(value).toBe(0);
        }
      }
    }

    // The second layer, driven by a hidden node forced high through its bias.
    for (let hidden = 0; hidden < BRAIN_HIDDEN; hidden++) {
      for (let output = 0; output < BRAIN_OUTPUTS; output++) {
        const brain = zeroBrain();
        brain.weights[weightIndex(0, BRAIN_INPUTS, hidden)] = 4; // that node's bias
        brain.weights[weightIndex(1, hidden, output)] = 4;

        const runtime = new BrainRuntime();
        runtime.evaluate(brain, emptySensors());
        for (let o = 0; o < BRAIN_OUTPUTS; o++) {
          if (o === output) expect(runtime.output(o)).toBeGreaterThan(0.9);
          else expect(runtime.output(o)).toBe(0);
        }
      }
    }
  });

  it('never asks a wheel for more than the motor can give', () => {
    for (const output of [-1, -0.5, 0, 0.5, 1]) {
      const m = motorMultiplier(output);
      expect(m).toBeGreaterThanOrEqual(-0.2);
      expect(m).toBeLessThanOrEqual(1.5);
    }
    // A network sitting at rest still drives forward, or the first generation
    // would be twenty motionless boxes and selection would have nothing to work
    // with.
    expect(motorMultiplier(0)).toBeGreaterThan(0.5);
  });

  it('rebuilds a driver for a car saved before the network existed', () => {
    const rng = rngFromSeed('legacy');
    expect(ensureBrain(rng, null).weights).toHaveLength(BRAIN_WEIGHT_COUNT);
    expect(ensureBrain(rng, undefined).weights).toHaveLength(BRAIN_WEIGHT_COUNT);

    // A short list keeps the weights it does have.
    const short: Brain = { weights: [0.25, -0.25] };
    const grown = ensureBrain(rng, short);
    expect(grown.weights).toHaveLength(BRAIN_WEIGHT_COUNT);
    expect(grown.weights[0]).toBe(0.25);
    expect(grown.weights[1]).toBe(-0.25);
  });

  it('rides along with the body through breeding', () => {
    const rng = rngFromSeed('genome');
    const car = randomCar(rng);
    expect(car.brain.weights).toHaveLength(BRAIN_WEIGHT_COUNT);
  });
});

describe('drivers in the world', () => {
  it('gives different cars different wheel speeds', () => {
    // The point of the network is that two cars in the same place behave
    // differently. If every car's activations matched, the driver would be
    // decoration.
    const sim = new Simulation({ trackSeed: 'drive', runSeed: 'drive' });
    for (let i = 0; i < 90; i++) sim.step();

    const signatures = new Set(
      sim.cars
        .filter((car) => car.alive)
        .map((car) => Array.from(car.brain.activations.slice(-2), (v) => v.toFixed(4)).join(',')),
    );
    expect(signatures.size).toBeGreaterThan(1);
  });

  it('reacts to the ground rather than repeating one number', () => {
    const sim = new Simulation({ trackSeed: 'react', runSeed: 'react' });
    const car = sim.cars[0]!;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      sim.step();
      if (!car.alive) break;
      seen.add(car.brain.output(0).toFixed(3));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});
