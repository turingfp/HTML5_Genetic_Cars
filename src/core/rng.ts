/**
 * Seedable pseudo-random numbers.
 *
 * The original monkey-patched `Math.random` via seedrandom, which made every
 * consumer implicitly global and the GA accidentally seeded. Here a generator
 * is an ordinary function that gets passed to whoever needs it.
 */

/** Same contract as `Math.random`: a float in [0, 1). */
export type Rng = () => number;

/** FNV-1a, used to turn a human-typed seed string into a 32-bit state. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, and good enough for terrain and evolution. */
export function mulberry32(state: number): Rng {
  let a = state >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a generator from a seed string. */
export function rngFromSeed(seed: string): Rng {
  return mulberry32(hashSeed(seed));
}

/** A short, pronounceable, URL-safe seed for sharing runs. */
export function randomSeed(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
