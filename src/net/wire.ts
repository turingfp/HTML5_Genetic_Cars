/**
 * Turning cars into something safe to accept from a stranger.
 *
 * A genome that arrives over the network goes straight into a physics engine
 * and a WebGL scene. Nothing here trusts what it is given: every field is
 * checked, every number has to be finite and in range, and anything that fails
 * is dropped rather than repaired. A peer who sends a car with ten thousand
 * wheels, a NaN spoke or a chassis a kilometre wide should cost you nothing.
 *
 * The checks are deliberately the same ranges the mutation operator clamps to,
 * so an imported car is exactly as legal as a locally bred one.
 */

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_DENSITY_MIN,
  CHASSIS_DENSITY_RANGE,
  CHASSIS_HALF_WIDTH_MIN,
  CHASSIS_HALF_WIDTH_RANGE,
  CHASSIS_VERTEX_COUNT,
  MAX_WHEEL_COUNT,
  MIN_WHEEL_COUNT,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_GAP_MIN,
  WHEEL_GAP_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../config';
import { BRAIN_WEIGHT_COUNT } from '../ga/brain';
import { rebuildVertices, type CarDef, type Spoke, type WheelDef } from '../ga/genome';
import type { Car3DDef } from '../ga/genome3d';

/** Widest a network weight may be. Mutation clamps here too. */
const WEIGHT_LIMIT = 1.5;

/** A car as it travels: no derived fields, no typed arrays, just numbers. */
export interface WireCar {
  /** Spoke angles and lengths, interleaved. */
  s: number[];
  /** Wheel radius, density and mount vertex, interleaved. */
  w: number[];
  /** Chassis density. */
  d: number;
  /** Network weights. */
  b: number[];
  /** Chassis half-width, for 3D cars. */
  hw?: number;
  /** Wheel outboard offset, for 3D cars. */
  wg?: number;
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function numbers(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  for (const n of value) if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return value as number[];
}

export function packCar(def: CarDef): WireCar {
  const s: number[] = [];
  for (const spoke of def.spokes) s.push(spoke.angle, spoke.length);
  const w: number[] = [];
  for (const wheel of def.wheels) w.push(wheel.radius, wheel.density, wheel.vertex);
  return { s, w, d: def.chassisDensity, b: def.brain.weights.slice() };
}

export function packCar3D(def: Car3DDef): WireCar {
  return { ...packCar(def.base), hw: def.halfWidth, wg: def.wheelGap };
}

/**
 * Rebuild a car from the wire, or null if what arrived is not one.
 *
 * Returning null rather than throwing because a bad message from one peer is
 * an ordinary event in a room of strangers, not an error in this program.
 */
export function unpackCar(raw: unknown): CarDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const wire = raw as Partial<WireCar>;

  const spokeNumbers = numbers(wire.s, CHASSIS_VERTEX_COUNT * 2);
  if (!spokeNumbers) return null;
  const spokes: Spoke[] = [];
  for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
    const angle = spokeNumbers[i * 2]!;
    const length = spokeNumbers[i * 2 + 1]!;
    if (!inRange(angle, -1, 1)) return null;
    if (!inRange(length, CHASSIS_AXIS_MIN, CHASSIS_AXIS_MIN + CHASSIS_AXIS_RANGE)) return null;
    spokes.push({ angle, length });
  }

  if (!Array.isArray(wire.w) || wire.w.length % 3 !== 0) return null;
  const wheelCount = wire.w.length / 3;
  if (wheelCount < MIN_WHEEL_COUNT || wheelCount > MAX_WHEEL_COUNT) return null;
  const wheelNumbers = numbers(wire.w, wheelCount * 3);
  if (!wheelNumbers) return null;

  const wheels: WheelDef[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < wheelCount; i++) {
    const radius = wheelNumbers[i * 3]!;
    const density = wheelNumbers[i * 3 + 1]!;
    const vertex = wheelNumbers[i * 3 + 2]!;
    if (!inRange(radius, WHEEL_RADIUS_MIN, WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE)) return null;
    if (!inRange(density, WHEEL_DENSITY_MIN, WHEEL_DENSITY_MIN + WHEEL_DENSITY_RANGE)) return null;
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= CHASSIS_VERTEX_COUNT) return null;
    // Two wheels on one corner is not something the local breeder can produce,
    // and the joint builder assumes it cannot happen.
    if (taken.has(vertex)) return null;
    taken.add(vertex);
    wheels.push({ radius, density, vertex });
  }

  if (!inRange(wire.d, CHASSIS_DENSITY_MIN, CHASSIS_DENSITY_MIN + CHASSIS_DENSITY_RANGE)) {
    return null;
  }

  const weights = numbers(wire.b, BRAIN_WEIGHT_COUNT);
  if (!weights) return null;
  for (const weight of weights) if (!inRange(weight, -WEIGHT_LIMIT, WEIGHT_LIMIT)) return null;

  const def: CarDef = {
    wheels,
    spokes,
    vertices: spokes.map(() => ({ x: 0, y: 0 })),
    chassisDensity: wire.d,
    brain: { weights },
  };
  rebuildVertices(def);
  return def;
}

/**
 * Check a car that came out of storage rather than off the network.
 *
 * Saved records are untrusted input too, which was not obvious until a hall of
 * fame written by an older version of the genome reached the thumbnail
 * renderer and took the whole application down before it drew a frame. A
 * stored car is exactly as suspect as a stranger's: it may predate a gene, or
 * have been edited by hand, or come from another tab running a different
 * build. So it goes through the same validator, by way of the wire form.
 */
export function readStoredCar(raw: unknown): CarDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const stored = raw as Partial<CarDef>;

  // Rebuilt field by field rather than packed, because packing a malformed
  // record is itself what throws.
  const spokes: number[] = [];
  if (!Array.isArray(stored.spokes)) return null;
  for (const spoke of stored.spokes) {
    if (!spoke || typeof spoke !== 'object') return null;
    spokes.push((spoke as Spoke).angle, (spoke as Spoke).length);
  }

  const wheels: number[] = [];
  if (!Array.isArray(stored.wheels)) return null;
  for (const wheel of stored.wheels) {
    if (!wheel || typeof wheel !== 'object') return null;
    const w = wheel as WheelDef;
    wheels.push(w.radius, w.density, w.vertex);
  }

  return unpackCar({
    s: spokes,
    w: wheels,
    d: stored.chassisDensity as number,
    b: (stored.brain as { weights?: number[] } | undefined)?.weights as number[],
  });
}

export function unpackCar3D(raw: unknown): Car3DDef | null {
  const base = unpackCar(raw);
  if (!base) return null;
  const wire = raw as Partial<WireCar>;
  const halfWidth = wire.hw;
  const wheelGap = wire.wg;
  if (!inRange(halfWidth, CHASSIS_HALF_WIDTH_MIN, CHASSIS_HALF_WIDTH_MIN + CHASSIS_HALF_WIDTH_RANGE))
    return null;
  if (!inRange(wheelGap, WHEEL_GAP_MIN, WHEEL_GAP_MIN + WHEEL_GAP_RANGE)) return null;
  return { base, halfWidth, wheelGap };
}

/* ── Messages ────────────────────────────────────────────────────────────── */

/** Who someone is, sent once on arrival and whenever it changes. */
export interface HelloMessage {
  name: string;
  /** Which mode they are running, so scores are compared like for like. */
  mode: '2d' | '3d';
}

/** How a peer's run is going. Sent at the end of each of their generations. */
export interface ScoreMessage {
  generation: number;
  /** Furthest any of their cars has reached, in metres. */
  best: number;
  /** Their whole run's total, so the room can add up what it has done. */
  evaluations: number;
  mode: '2d' | '3d';
}

/** A peer's best car, offered for anyone to breed from. */
export interface ChampionMessage {
  car: WireCar;
  score: number;
  generation: number;
  mode: '2d' | '3d';
}

/** Longest peer name accepted, and what a rejected one becomes. */
const MAX_NAME = 18;

export function cleanName(name: unknown): string {
  if (typeof name !== 'string') return 'anon';
  // Control characters and direction overrides do not belong in a name that
  // gets drawn next to a score.
  const stripped = name.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').trim();
  return stripped.slice(0, MAX_NAME) || 'anon';
}

function isMode(value: unknown): value is '2d' | '3d' {
  return value === '2d' || value === '3d';
}

export function readHello(raw: unknown): HelloMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Partial<HelloMessage>;
  if (!isMode(message.mode)) return null;
  return { name: cleanName(message.name), mode: message.mode };
}

export function readScore(raw: unknown): ScoreMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Partial<ScoreMessage>;
  if (!isMode(message.mode)) return null;
  // Loose upper bounds: these only have to stop a peer from claiming a score
  // that would break the leaderboard's scaling or the room's totals.
  if (!inRange(message.generation, 0, 1e7)) return null;
  if (!inRange(message.best, -1e6, 1e6)) return null;
  if (!inRange(message.evaluations, 0, 1e9)) return null;
  return {
    generation: Math.floor(message.generation),
    best: message.best,
    evaluations: Math.floor(message.evaluations),
    mode: message.mode,
  };
}

export function readChampion(raw: unknown): ChampionMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const message = raw as Partial<ChampionMessage>;
  if (!isMode(message.mode)) return null;
  if (!inRange(message.score, -1e6, 1e6)) return null;
  if (!inRange(message.generation, 0, 1e7)) return null;
  // The car itself is checked when it is unpacked, by whichever mode wants it.
  if (!message.car || typeof message.car !== 'object') return null;
  return {
    car: message.car as WireCar,
    score: message.score,
    generation: Math.floor(message.generation),
    mode: message.mode,
  };
}
