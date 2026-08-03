/**
 * A/B harness for changes to the search.
 *
 * Every claim in the README's results tables came from this. It exists because
 * the interesting changes here are not obviously good: a bigger network turned
 * out to be worse, giving the driver reverse helped in 2D and hurt in 3D, and
 * exponential rank selection turned out to be the gentlest of the three
 * selection methods rather than the greediest. None of that is guessable.
 *
 * Not part of `npm test`: a full sweep runs the physics for tens of minutes.
 * Run it with `npm run bench`, and edit CONFIGS to whatever you are comparing.
 *
 * Read `mean` before `best`. `best` is the furthest any single car got across
 * the whole run, so one lucky generation moves it; `mean` is the average of
 * each generation's leader, which only improves if the whole search improved.
 */

import { it } from 'vitest';

import type { GAParams } from '../src/ga/evolution';
import { Simulation } from '../src/sim/simulation';

/** Six courses, so no result rests on one shape of hill. */
const SEEDS = ['alpha', 'showcase', 'ridge', 'moon-buggy', 'ice-rink', 'camber'];

/** Two populations per course, since a single run is very noisy. */
const RUNS = ['a', 'b'];

const GENERATIONS = 30;

/** Edit this to whatever you are comparing. The first row is the shipped default. */
const CONFIGS: [string, Partial<GAParams>][] = [
  ['default               ', {}],
  ['pressure 0.6 + 2 fresh', { diversityPressure: 0.6, immigrants: 2 }],
  ['tournament            ', { selection: 'tournament' }],
  ['asexual               ', { crossoverMode: 'none' }],
];

interface Result {
  best: number;
  mean: number;
  families: number;
}

function run(trackSeed: string, runSeed: string, over: Partial<GAParams>): Result {
  const sim = new Simulation({ trackSeed, runSeed, params: over });
  const bests: number[] = [];
  const families: number[] = [];
  sim.onGenerationEnd = (scores) => {
    bests.push(Math.max(...scores.map((s) => s.distance)));
    families.push(new Set(scores.map((s) => s.lineage)).size);
  };

  // A guard rather than a while(true): a change that stops cars dying would
  // otherwise hang the whole sweep with no clue as to which config did it.
  let guard = 0;
  while (bests.length < GENERATIONS && guard++ < 4_000_000) sim.step();

  return {
    best: Math.max(...bests),
    mean: bests.reduce((a, b) => a + b, 0) / bests.length,
    // Averaged over the last ten generations, once any collapse has happened.
    families: families.slice(-10).reduce((a, b) => a + b, 0) / 10,
  };
}

it('compares configurations', () => {
  for (const [name, over] of CONFIGS) {
    const started = performance.now();
    const rows = SEEDS.flatMap((seed) => RUNS.map((r) => run(seed, `run-${seed}-${r}`, over)));
    const avg = (k: keyof Result) => rows.reduce((a, x) => a + x[k], 0) / rows.length;
    console.log(
      `${name} best ${avg('best').toFixed(1).padStart(6)}  ` +
        `mean ${avg('mean').toFixed(1).padStart(6)}  ` +
        `families ${avg('families').toFixed(1).padStart(4)}  ` +
        `(${((performance.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
}, 3_600_000);
