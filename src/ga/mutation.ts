/**
 * The one mutation primitive, shared by the body genes and the network weights.
 *
 * It lives on its own so that `brain.ts` and `genome.ts` can both use it
 * without importing each other.
 */

import type { Rng } from '../core/rng';

export interface MutationParams {
  /** Probability that any single gene mutates. */
  rate: number;
  /** Mutation window width as a fraction of the gene's full range. */
  size: number;
}

/**
 * Nudge a value within a window of `range * size` centred on the old value,
 * clamped so the result stays inside [min, min + range).
 *
 * At size = 1 the window covers the whole range, which is why the default
 * "mutation size" of 100% behaves like a random re-roll.
 */
export function mutateValue(
  rng: Rng,
  old: number,
  min: number,
  range: number,
  size: number,
): number {
  const span = range * size;
  let base = old - 0.5 * span;
  if (base < min) base = min;
  if (base > min + (range - span)) base = min + (range - span);
  return base + span * rng();
}
