/**
 * A MAP-Elites archive: the best car ever found for every kind of body.
 *
 * The genetic algorithm answers one question, "what is the best car", and
 * pays for it by forgetting everything else it discovers on the way. This
 * answers a different one, from Mouret and Clune's illumination work: what is
 * the best car *of every shape*? Morphology space is cut into a grid, small
 * bodies to large along one axis and small wheels to large along the other,
 * and each cell keeps the single best car whose body falls in it, forever.
 *
 * Two properties fall out that pure selection cannot have. Nothing good is
 * ever lost: a weird stilt-walker that reaches 40m goes extinct in a
 * population within two generations of a 60m car appearing, but its cell in
 * the archive is not competing with that car, so it stays. And the map is the
 * search: breeding from uniformly random cells instead of from the current
 * winners means the search keeps working on shapes it has not perfected,
 * which is exactly the stepping-stone collecting that fitness pressure
 * destroys. Watching the grid light up is watching the whole design space be
 * explored rather than one hill be climbed.
 */

import { CHASSIS_AXIS_MIN, CHASSIS_AXIS_RANGE, WHEEL_RADIUS_MIN, WHEEL_RADIUS_RANGE, MAX_WHEEL_COUNT, MIN_WHEEL_COUNT, CHASSIS_VERTEX_COUNT } from '../config';
import type { Rng } from '../core/rng';
import type { CarDef } from './genome';
import type { Car3DDef } from './genome3d';

/**
 * Cells per axis. 12 gives 144 niches, which a population of twenty can
 * meaningfully fill over a session; a finer grid than the search can feed is
 * just an emptier picture.
 */
export const ARCHIVE_GRID = 12;

/** Where a car's body sits in morphology space, both axes in [0, 1]. */
export interface Descriptor {
  /** How big the body is: mean spoke length against its possible range. */
  body: number;
  /** How much wheel it carries: radii summed against the largest possible. */
  wheel: number;
}

/** One occupied niche. */
export interface ArchiveCell<T> {
  def: T;
  score: number;
  /** Which generation this elite was found in, for showing recency. */
  generation: number;
  descriptor: Descriptor;
}

/**
 * The body axes come from the genome rather than from behavior.
 *
 * Behavioral descriptors (speed, airtime) are the other classic choice, but
 * they move when the track does: the same car jumps on a rampy course and
 * never leaves the ground on a flat one, so a behavioral archive would be
 * scrambled by every track change. A body is the same body on any course,
 * which is what lets the archive survive the whole session.
 */
export function describeCar(def: CarDef): Descriptor {
  let spokeSum = 0;
  for (const spoke of def.spokes) spokeSum += spoke.length;
  const meanSpoke = spokeSum / CHASSIS_VERTEX_COUNT;
  const body = (meanSpoke - CHASSIS_AXIS_MIN) / CHASSIS_AXIS_RANGE;

  let radiusSum = 0;
  for (const wheel of def.wheels) radiusSum += wheel.radius;
  const most = MAX_WHEEL_COUNT * (WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE);
  const least = MIN_WHEEL_COUNT * WHEEL_RADIUS_MIN;
  const wheel = (radiusSum - least) / (most - least);

  return { body: clamp01(body), wheel: clamp01(wheel) };
}

/** A 3D car's body is its silhouette; width is not a niche worth an axis. */
export function describeCar3D(def: Car3DDef): Descriptor {
  return describeCar(def.base);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function cellIndex(d: Descriptor): number {
  const col = Math.min(ARCHIVE_GRID - 1, Math.floor(d.wheel * ARCHIVE_GRID));
  const row = Math.min(ARCHIVE_GRID - 1, Math.floor(d.body * ARCHIVE_GRID));
  return row * ARCHIVE_GRID + col;
}

export class EliteArchive<T> {
  /** Row-major, body along rows and wheels along columns. Null is unexplored. */
  readonly cells: (ArchiveCell<T> | null)[];
  private readonly describe: (def: T) => Descriptor;
  private readonly cloneDef: (def: T) => T;
  private filledCount = 0;

  constructor(describe: (def: T) => Descriptor, clone: (def: T) => T) {
    this.describe = describe;
    this.cloneDef = clone;
    this.cells = new Array<ArchiveCell<T> | null>(ARCHIVE_GRID * ARCHIVE_GRID).fill(null);
  }

  /**
   * Offer a finished run. It enters the archive only by beating the best car
   * of its own shape, which is the whole trick: it is never compared with the
   * best car overall.
   */
  offer(def: T, score: number, generation: number): boolean {
    if (!Number.isFinite(score)) return false;
    const descriptor = this.describe(def);
    const index = cellIndex(descriptor);
    const held = this.cells[index];
    if (held && held.score >= score) return false;
    if (!held) this.filledCount++;
    // Cloned on the way in, because the def belongs to a car the simulation
    // is about to destroy and breed from.
    this.cells[index] = { def: this.cloneDef(def), score, generation, descriptor };
    return true;
  }

  /** How much of morphology space has produced a working car at all. */
  get filled(): number {
    return this.filledCount;
  }

  get coverage(): number {
    return this.filledCount / this.cells.length;
  }

  /**
   * The QD-score: every cell's fitness summed.
   *
   * The standard scalar for quality-diversity searches, from Pugh et al. It
   * only rises, and it rises for both of the things this search values: a new
   * niche filled, or an old niche improved. Best-so-far can flatline for
   * fifty generations while the map is still visibly getting better; this
   * number is how that progress is usually reported.
   */
  get qdScore(): number {
    let sum = 0;
    for (const cell of this.cells) if (cell) sum += Math.max(0, cell.score);
    return sum;
  }

  get bestScore(): number {
    let best = -Infinity;
    for (const cell of this.cells) if (cell && cell.score > best) best = cell.score;
    return best;
  }

  /**
   * A parent, drawn uniformly from the filled cells.
   *
   * Uniform is the deliberate part, straight from the original algorithm. The
   * GA breeds from winners; this breeds from the map, so a half-explored shape
   * gets exactly as many chances as the champion's, and the stepping stones
   * keep getting stepped on.
   */
  pick(rng: Rng): T | null {
    if (this.filledCount === 0) return null;
    let target = Math.floor(rng() * this.filledCount);
    for (const cell of this.cells) {
      if (!cell) continue;
      if (target-- === 0) return cell.def;
    }
    return null;
  }

  /** The occupant of one cell, for the panel's click-to-race. */
  at(row: number, col: number): ArchiveCell<T> | null {
    if (row < 0 || row >= ARCHIVE_GRID || col < 0 || col >= ARCHIVE_GRID) return null;
    return this.cells[row * ARCHIVE_GRID + col] ?? null;
  }

  /** Forget everything, as a track change demands. Scores mean nothing across courses. */
  clear(): void {
    this.cells.fill(null);
    this.filledCount = 0;
  }
}
