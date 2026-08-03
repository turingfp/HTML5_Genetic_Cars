/**
 * The daily track.
 *
 * The whole promise is one sentence: two people who open this on the same day
 * get the same course, without either of them asking a server. Everything here
 * is that sentence, taken apart.
 */

import { describe, expect, it } from 'vitest';

import {
  dailySpec,
  dayStamp,
  encodeSpec,
  isDaily,
  normaliseSpec,
  untilNextDaily,
} from '../src/track/spec';

const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));

describe('the daily track', () => {
  it('is the same course all day, whatever the hour', () => {
    const day = at(2026, 8, 3, 0, 0);
    const code = encodeSpec(dailySpec(day));
    for (const hour of [0, 1, 6, 13, 22, 23]) {
      expect(encodeSpec(dailySpec(at(2026, 8, 3, hour, 59)))).toBe(code);
    }
  });

  it('is a different course every day, for a year of them', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 366; i++) {
      codes.add(encodeSpec(dailySpec(new Date(Date.UTC(2026, 0, 1 + i, 9)))));
    }
    // A collision here is not a cosmetic bug: it is two days that are secretly
    // the same track, and the seed was truncated into exactly that once.
    expect(codes.size).toBe(366);
  });

  it('survives a round trip through a code, like any other track', () => {
    const spec = dailySpec(at(2026, 8, 3));
    expect(normaliseSpec(spec)).toEqual(spec);
    expect(isDaily(spec, at(2026, 8, 3, 23))).toBe(true);
    expect(isDaily(spec, at(2026, 8, 4))).toBe(false);
  });

  it('rolls over at midnight UTC, not at whatever midnight is where you are', () => {
    const before = dailySpec(at(2026, 8, 3, 23, 59));
    const after = dailySpec(at(2026, 8, 4, 0, 1));
    expect(encodeSpec(before)).not.toBe(encodeSpec(after));
    expect(untilNextDaily(at(2026, 8, 3, 23, 0))).toBe(60 * 60 * 1000);
    expect(untilNextDaily(at(2026, 8, 3, 0, 0))).toBe(24 * 60 * 60 * 1000);
  });

  it('names the day it belongs to', () => {
    expect(dayStamp(at(2026, 8, 3, 5))).toBe('2026-08-03');
    expect(dayStamp(at(2026, 1, 1, 0))).toBe('2026-01-01');
  });

  it('generates a track worth driving rather than a wall', () => {
    // A daily nobody can move on is worse than no daily, and these come out of
    // the same biased generator the dice button uses for that reason.
    for (let i = 0; i < 120; i++) {
      const spec = dailySpec(new Date(Date.UTC(2026, 0, 1 + i * 3)));
      expect(spec.tiles).toBeGreaterThanOrEqual(120);
      expect(spec.gaps).toBeLessThanOrEqual(0.14);
      expect(spec.ramps).toBeLessThanOrEqual(0.22);
      expect(spec.width).toBeGreaterThanOrEqual(0.6);
    }
  });
});
