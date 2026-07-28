/**
 * Persisted settings and hall of fame.
 *
 * Everything here degrades quietly: private browsing modes and disabled
 * storage should cost you persistence, not the app.
 */

import type { GAParams } from '../ga/evolution';
import type { CarDef } from '../ga/genome';
import type { Speed } from '../config';

const SETTINGS_KEY = 'genetic-cars:settings:v1';

/**
 * Records are kept per mode. A flat car and a four-wheeled one are solving
 * different problems on different scales, so a single leaderboard would let a
 * 2D score stand as the 3D record and vice versa.
 */
const hallKey = (mode: string) => `genetic-cars:hall-of-fame:${mode}:v2`;

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

export function loadHallOfFame(mode: string): HallOfFameEntry[] {
  const entries = read<HallOfFameEntry[]>(hallKey(mode)) ?? [];
  return entries.filter((e) => e && e.def && Number.isFinite(e.score));
}

export function saveHallOfFame(mode: string, entries: HallOfFameEntry[]): void {
  write(hallKey(mode), entries);
}

/** The track seed from the URL, if the page was opened from a shared link. */
export function seedFromUrl(): string | null {
  try {
    return new URL(window.location.href).searchParams.get('seed');
  } catch {
    return null;
  }
}

/** Reflect the current seed in the address bar without reloading. */
export function syncSeedToUrl(seed: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('seed', seed);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Some embedding contexts forbid history writes; sharing just needs a copy.
  }
}
