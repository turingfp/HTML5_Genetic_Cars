/**
 * Persisted settings and hall of fame.
 *
 * Everything here degrades quietly: private browsing modes and disabled
 * storage should cost you persistence, not the app.
 */

import type { GAParams } from '../ga/evolution';
import { readStoredCar } from '../net/wire';
import type { CarDef } from '../ga/genome';
import type { Speed } from '../config';

const SETTINGS_KEY = 'boxcar3d:settings:v1';

/**
 * Records are kept per mode. A flat car and a four-wheeled one are solving
 * different problems on different scales, so a single leaderboard would let a
 * 2D score stand as the 3D record and vice versa.
 */
const hallKey = (mode: string) => `boxcar3d:hall-of-fame:${mode}:v1`;

export interface Settings extends GAParams {
  speed: Speed;
  zoom: number;
}

export interface HallOfFameEntry {
  def: CarDef;
  score: number;
  distance: number;
  generation: number;
  trackSeed: string;
  recordedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable or full; the session still works, it just won't persist.
  }
}

export function loadSettings(): Partial<Settings> {
  return read<Partial<Settings>>(SETTINGS_KEY) ?? {};
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

/**
 * Saved records, with anything unusable dropped.
 *
 * Every car is rebuilt through the same validator the network uses. Checking
 * only that `def` was present was not enough: a hall of fame written before a
 * gene existed reached the thumbnail renderer, threw inside the application's
 * constructor, and took the page down before it drew a frame. A stored record
 * is untrusted input like any other.
 */
export function loadHallOfFame(mode: string): HallOfFameEntry[] {
  const entries = read<HallOfFameEntry[]>(hallKey(mode)) ?? [];
  if (!Array.isArray(entries)) return [];
  const kept: HallOfFameEntry[] = [];
  for (const entry of entries) {
    if (!entry || !Number.isFinite(entry.score)) continue;
    const def = readStoredCar(entry.def);
    if (!def) continue;
    kept.push({ ...entry, def });
  }
  return kept;
}

export function saveHallOfFame(mode: string, entries: HallOfFameEntry[]): void {
  write(hallKey(mode), entries);
}

/** The track seed from the URL, if the page was opened from a shared link. */
export function seedFromUrl(): string | null {
  return paramFromUrl('seed');
}

/**
 * The full track code from the URL.
 *
 * A link now carries the whole design rather than only its seed, so a shared
 * track arrives with its gaps and ramps intact. `seed` is still read, because
 * links made before codes existed should keep working.
 */
export function trackCodeFromUrl(): string | null {
  return paramFromUrl('track');
}

function paramFromUrl(name: string): string | null {
  try {
    return new URL(window.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

/** Reflect the current track in the address bar without reloading. */
export function syncSeedToUrl(seed: string, code?: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed);
    if (code) url.searchParams.set('track', code);
    else url.searchParams.delete('track');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Some embedding contexts forbid history writes; sharing just needs a copy.
  }
}
