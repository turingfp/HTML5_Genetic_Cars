/**
 * A track as a thing you design, not a number you are given.
 *
 * The original had one track shape and a random seed. That makes every run a
 * lottery: you cannot ask "can a car built for hills also clear a gap", because
 * you cannot make a track that is all hills or all gaps. A spec is the set of
 * knobs that answers that, and it packs into a short code you can paste to
 * someone else, which is the part that makes it a game rather than a demo.
 *
 * Codes are versioned, so a track shared today keeps generating the same
 * terrain after the knobs change shape.
 */

import { rngFromSeed, type Rng } from '../core/rng';

/** A track design. Everything needed to reproduce the terrain exactly. */
export interface TrackSpec {
  /** Seeds the terrain noise. Lower-case base36. */
  seed: string;
  /** How long the course is, in tiles. */
  tiles: number;
  /** Multiplies how steeply the hills grow with distance. */
  hills: number;
  /** Chance per tile of a launch ramp: a hard upward kick. */
  ramps: number;
  /** Chance per tile of a hole in the road that has to be jumped. */
  gaps: number;
  /** Multiplies the 3D road's side to side camber. */
  bank: number;
  /** Multiplies the 3D road's width. Narrow roads punish wide cars. */
  width: number;
}

/** Inclusive range of each numeric knob, and what it is called in the UI. */
export const SPEC_RANGES = {
  tiles: { min: 60, max: 600, step: 1, label: 'Length' },
  hills: { min: 0, max: 2.5, step: 0.05, label: 'Hills' },
  ramps: { min: 0, max: 0.3, step: 0.005, label: 'Ramps' },
  gaps: { min: 0, max: 0.25, step: 0.005, label: 'Gaps' },
  bank: { min: 0, max: 2, step: 0.05, label: 'Camber' },
  width: { min: 0.35, max: 2, step: 0.05, label: 'Road width' },
} as const;

export type SpecKnob = keyof typeof SPEC_RANGES;

/** The knobs, in the order they are packed into a code. Never reorder these. */
const KNOB_ORDER: SpecKnob[] = ['tiles', 'hills', 'ramps', 'gaps', 'bank', 'width'];

/**
 * The classic course: the terrain the original generated, and still what you
 * get from a bare seed. Everything else is a deliberate departure from it.
 */
export function defaultSpec(seed: string): TrackSpec {
  return { seed, tiles: 200, hills: 1, ramps: 0, gaps: 0, bank: 1, width: 1 };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * How many steps from the minimum a value sits, clamped into range.
 *
 * Everything is kept on this grid, which is also exactly what a code stores.
 * That is what makes a shared track *the same* track: if a spec could hold a
 * value between two steps, encoding would round it and the person you sent it
 * to would get terrain you have never seen.
 */
export function stepIndex(knob: SpecKnob, value: number): number {
  const { min, max, step } = SPEC_RANGES[knob];
  const clamped = clamp(value, min, max);
  return Math.round((clamped - min) / step);
}

function fromStepIndex(knob: SpecKnob, index: number): number {
  const { min, max, step } = SPEC_RANGES[knob];
  const raw = min + clamp(index, 0, stepCount(knob)) * step;
  // Re-round: repeated addition of a step like 0.05 accumulates float error,
  // and two machines must agree on the value bit for bit.
  return clamp(Math.round(raw / step) * step, min, max);
}

/** The highest valid step index for a knob. */
export function stepCount(knob: SpecKnob): number {
  const { min, max, step } = SPEC_RANGES[knob];
  return Math.round((max - min) / step);
}

/** A spec with every knob on the grid and a usable seed, whatever came in. */
export function normaliseSpec(spec: Partial<TrackSpec> & { seed?: string }): TrackSpec {
  const base = defaultSpec(cleanSeed(spec.seed));
  for (const knob of KNOB_ORDER) {
    const value = spec[knob];
    if (typeof value === 'number' && Number.isFinite(value)) {
      base[knob] = fromStepIndex(knob, stepIndex(knob, value));
    }
  }
  return base;
}

/**
 * Seeds go into codes and URLs, so they are restricted to characters that
 * survive both. Anything else is dropped rather than rejected: a pasted seed
 * with a stray space should still work.
 */
export function cleanSeed(seed: string | undefined): string {
  const kept = (seed ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return kept.slice(0, MAX_SEED_LENGTH) || 'classic';
}

const MAX_SEED_LENGTH = 12;

/* ── Codes ───────────────────────────────────────────────────────────────── */

/**
 * Codes start with the format version. A code made by a later version is
 * refused rather than silently misread, because misreading one produces a
 * different track under the same name, which is the worst possible failure for
 * something whose whole purpose is that two people see the same thing.
 */
const CODE_VERSION = 't1';

/**
 * Bytes each knob takes in a code.
 *
 * A knob is stored as its step index, so a code holds exactly what the sliders
 * hold and decoding loses nothing. Length is the only one with more than 256
 * positions, so it gets a second byte.
 */
const KNOB_BYTES: Record<SpecKnob, number> = {
  tiles: 2,
  hills: 1,
  ramps: 1,
  gaps: 1,
  bank: 1,
  width: 1,
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toBase64Url(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const left = bytes.length - i;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    if (left > 1) out += B64[((b & 15) << 2) | (c >> 6)]!;
    if (left > 2) out += B64[c & 63]!;
  }
  return out;
}

function fromBase64Url(text: string): number[] | null {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const value = B64.indexOf(ch);
    if (value < 0) return null;
    acc = (acc << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}

/**
 * Pack a spec into something short enough to say out loud badly and paste
 * accurately. Six knob bytes, then the seed as plain characters.
 */
export function encodeSpec(spec: TrackSpec): string {
  const normalised = normaliseSpec(spec);
  const bytes: number[] = [];
  for (const knob of KNOB_ORDER) {
    const index = stepIndex(knob, normalised[knob]);
    if (KNOB_BYTES[knob] === 2) bytes.push((index >> 8) & 0xff);
    bytes.push(index & 0xff);
  }
  for (const ch of normalised.seed) bytes.push(ch.charCodeAt(0));
  return CODE_VERSION + toBase64Url(bytes);
}

/** Total bytes the knob section of a code occupies. */
const KNOB_SECTION = KNOB_ORDER.reduce((sum, knob) => sum + KNOB_BYTES[knob], 0);

/** Read a code back, or null if it is not one. */
export function decodeSpec(code: string): TrackSpec | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_VERSION)) return null;
  const bytes = fromBase64Url(trimmed.slice(CODE_VERSION.length));
  if (!bytes || bytes.length < KNOB_SECTION + 1) return null;

  const spec = defaultSpec('classic');
  let at = 0;
  for (const knob of KNOB_ORDER) {
    const index = KNOB_BYTES[knob] === 2 ? (bytes[at]! << 8) | bytes[at + 1]! : bytes[at]!;
    at += KNOB_BYTES[knob];
    spec[knob] = fromStepIndex(knob, index);
  }

  let seed = '';
  for (const byte of bytes.slice(at)) seed += String.fromCharCode(byte);
  spec.seed = cleanSeed(seed);
  return spec;
}

/** True when two specs describe the same terrain. */
export function sameSpec(a: TrackSpec, b: TrackSpec): boolean {
  return encodeSpec(a) === encodeSpec(b);
}

/* ── Medals ──────────────────────────────────────────────────────────────── */

/**
 * Medals, as fractions of the course.
 *
 * Distance rather than time, because a genetic algorithm has no lap: the
 * question a run answers is how far anything got. Fractions rather than fixed
 * metres, so a brutal track and a gentle one both mean the same thing by
 * "gold", and the author medal always means the population actually finished.
 */
export const MEDALS = [
  { name: 'author', at: 0.98, colour: '#c084fc' },
  { name: 'gold', at: 0.7, colour: '#fbbf24' },
  { name: 'silver', at: 0.45, colour: '#cbd5e1' },
  { name: 'bronze', at: 0.2, colour: '#d97706' },
] as const;

export type MedalName = (typeof MEDALS)[number]['name'];

/** The best medal earned by reaching `distance` along a course of `length`. */
export function medalFor(distance: number, length: number): MedalName | null {
  if (!(length > 0)) return null;
  const fraction = distance / length;
  for (const medal of MEDALS) if (fraction >= medal.at) return medal.name;
  return null;
}

/* ── Generated tracks ────────────────────────────────────────────────────── */

/** Knobs that would make a course that is interesting rather than uniform. */
export function randomSpec(rng: Rng, seed: string): TrackSpec {
  // Biased towards the low end of each knob: a track with every dial at
  // maximum is not hard, it is impossible, and nobody shares those.
  const soft = () => rng() * rng();
  return normaliseSpec({
    seed,
    tiles: 120 + Math.round(rng() * 260),
    hills: 0.5 + rng() * 1.3,
    ramps: soft() * 0.22,
    gaps: soft() * 0.14,
    bank: rng() * 1.6,
    width: 0.6 + rng() * 1.1,
  });
}

/* ── The daily ───────────────────────────────────────────────────────────── */

/**
 * The day a track belongs to, as `YYYY-MM-DD` in UTC.
 *
 * UTC rather than local time so that everyone gets the same track at the same
 * moment. A daily that rolls over at each person's midnight would split the
 * room in two for most of the day, which is the one thing a daily is for.
 */
export function dayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Today's course. The same one for everybody, every day, with no server.
 *
 * The date *is* the seed, so two browsers derive the same terrain without ever
 * talking to each other or to us. And because a room is keyed to a track code,
 * everyone who opens the daily and presses join lands in the same room, racing
 * the same ghosts. The matchmaking falls out of the generator.
 */
export function dailySpec(now: Date): TrackSpec {
  // The seed is the day *number* in base36, not the date written out. Seeds are
  // stripped to twelve alphanumerics so they survive a URL, and "daily20260803"
  // is thirteen: every day this month would have been truncated to the same
  // seed and generated the same hills.
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000);
  const seed = `d${day.toString(36)}`;
  return randomSpec(rngFromSeed(seed), seed);
}

/** Whether a spec is the daily for `now`, so the UI can say so. */
export function isDaily(spec: TrackSpec, now: Date): boolean {
  return sameSpec(spec, dailySpec(now));
}

/** Milliseconds until the next daily, for a countdown. */
export function untilNextDaily(now: Date): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, next - now.getTime());
}

/** A short human label, for leaderboards and the room list. */
export function describeSpec(spec: TrackSpec): string {
  const parts: string[] = [`${spec.tiles} tiles`];
  if (spec.hills >= 1.6) parts.push('steep');
  else if (spec.hills <= 0.4) parts.push('flat');
  if (spec.gaps >= 0.08) parts.push('gappy');
  if (spec.ramps >= 0.1) parts.push('rampy');
  if (spec.bank >= 1.4) parts.push('cambered');
  if (spec.width <= 0.6) parts.push('narrow');
  return parts.join(', ');
}
