import { describe, expect, it } from 'vitest';

import { rngFromSeed } from '../src/core/rng';
import { generateTrackFromSpec } from '../src/sim/track';
import {
  cleanSeed,
  decodeSpec,
  defaultSpec,
  describeSpec,
  encodeSpec,
  medalFor,
  normaliseSpec,
  randomSpec,
  sameSpec,
  SPEC_RANGES,
  stepCount,
  type SpecKnob,
  type TrackSpec,
} from '../src/track/spec';

const KNOBS = Object.keys(SPEC_RANGES) as SpecKnob[];

describe('track codes', () => {
  it('round-trips the default spec', () => {
    const spec = defaultSpec('classic');
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec);
  });

  it('round-trips a thousand random specs exactly', () => {
    const rng = rngFromSeed('codes');
    for (let i = 0; i < 1000; i++) {
      const spec = randomSpec(rng, `s${i.toString(36)}`);
      const decoded = decodeSpec(encodeSpec(spec));
      expect(decoded).not.toBeNull();
      // The code is the identity of a track, so it has to be stable under a
      // round trip: encode, decode, encode again, same string.
      expect(encodeSpec(decoded!)).toBe(encodeSpec(spec));
      expect(decoded!.seed).toBe(spec.seed);
    }
  });

  it('loses nothing at all: a decoded knob equals the one encoded', () => {
    const rng = rngFromSeed('fidelity');
    for (let i = 0; i < 300; i++) {
      const spec = randomSpec(rng, 'fid');
      const decoded = decodeSpec(encodeSpec(spec))!;
      // Exact, not close. Anything less means the person you sent the code to
      // drives terrain you have never seen.
      for (const knob of KNOBS) expect(decoded[knob]).toBe(spec[knob]);
    }
  });

  it('holds every position of every slider', () => {
    // Off-by-one in the two-byte length field would only show up at the ends.
    for (const knob of KNOBS) {
      for (const index of [0, 1, stepCount(knob) - 1, stepCount(knob)]) {
        const value = SPEC_RANGES[knob].min + index * SPEC_RANGES[knob].step;
        const spec = normaliseSpec({ seed: 'ends', [knob]: value });
        expect(decodeSpec(encodeSpec(spec))![knob]).toBe(spec[knob]);
      }
    }
  });

  it('produces codes short enough to paste', () => {
    const rng = rngFromSeed('length');
    for (let i = 0; i < 100; i++) {
      expect(encodeSpec(randomSpec(rng, 'abcdef')).length).toBeLessThanOrEqual(24);
    }
  });

  it('refuses anything that is not a code', () => {
    for (const bad of ['', 'hello', 't2AAAAAAAA', 't1', 't1$$$$', 'AAAAAAAA']) {
      expect(decodeSpec(bad)).toBeNull();
    }
  });

  it('survives a code with trailing whitespace', () => {
    const code = encodeSpec(defaultSpec('spaced'));
    expect(decodeSpec(`  ${code}\n`)).toEqual(decodeSpec(code));
  });
});

describe('spec validation', () => {
  it('clamps every knob into range', () => {
    const wild: TrackSpec = {
      seed: 'wild',
      tiles: 99999,
      hills: -50,
      ramps: 12,
      gaps: -1,
      bank: 900,
      width: 0,
      debris: 99,
    };
    const spec = normaliseSpec(wild);
    for (const knob of KNOBS) {
      expect(spec[knob]).toBeGreaterThanOrEqual(SPEC_RANGES[knob].min);
      expect(spec[knob]).toBeLessThanOrEqual(SPEC_RANGES[knob].max);
    }
  });

  it('fills in missing knobs from the classic course', () => {
    expect(normaliseSpec({ seed: 'partial', hills: 2 })).toEqual({
      ...defaultSpec('partial'),
      hills: 2,
    });
  });

  it('ignores non-finite knobs rather than propagating them', () => {
    const spec = normaliseSpec({ seed: 'nan', hills: NaN, gaps: Infinity });
    expect(Number.isFinite(spec.hills)).toBe(true);
    expect(Number.isFinite(spec.gaps)).toBe(true);
  });

  it('strips seeds down to what survives a URL', () => {
    expect(cleanSeed(' Hello World! ')).toBe('helloworld');
    expect(cleanSeed('')).toBe('classic');
    expect(cleanSeed('!!!')).toBe('classic');
    expect(cleanSeed('a'.repeat(50)).length).toBeLessThanOrEqual(12);
  });
});

describe('generated terrain', () => {
  it('is reproducible from a spec', () => {
    const rng = rngFromSeed('repro');
    for (let i = 0; i < 20; i++) {
      const spec = randomSpec(rng, `r${i}`);
      const a = generateTrackFromSpec(spec);
      const b = generateTrackFromSpec(spec);
      expect(a.surface).toEqual(b.surface);
      expect(a.tiles.map((t) => t.solid)).toEqual(b.tiles.map((t) => t.solid));
    }
  });

  it('gives whoever pastes the code exactly the track you were driving', () => {
    const rng = rngFromSeed('viacode');
    for (let i = 0; i < 20; i++) {
      const mine = randomSpec(rng, `c${i}`);
      // What they receive is the code; what I see is my own spec object.
      const theirs = decodeSpec(encodeSpec(mine))!;
      const here = generateTrackFromSpec(mine);
      const there = generateTrackFromSpec(theirs);
      expect(there.surface).toEqual(here.surface);
      expect(there.tiles.map((t) => t.solid)).toEqual(here.tiles.map((t) => t.solid));
      expect(there.tiles.map((t) => t.ramp)).toEqual(here.tiles.map((t) => t.ramp));
      expect(there.length).toBe(here.length);
    }
  });

  it('always advances in x, whatever the knobs say', () => {
    const rng = rngFromSeed('monotonic');
    for (let i = 0; i < 40; i++) {
      const track = generateTrackFromSpec(randomSpec(rng, `m${i}`));
      for (let k = 1; k < track.surface.length; k++) {
        expect(track.surface[k]!.x).toBeGreaterThan(track.surface[k - 1]!.x);
      }
    }
  });

  it('honours the tile count', () => {
    for (const tiles of [60, 137, 600]) {
      expect(generateTrackFromSpec({ ...defaultSpec('count'), tiles }).tiles).toHaveLength(tiles);
    }
  });

  it('leaves the spawn area alone and never puts two gaps together', () => {
    const rng = rngFromSeed('gaps');
    for (let i = 0; i < 40; i++) {
      const spec = { ...randomSpec(rng, `g${i}`), gaps: 0.25, ramps: 0.3 };
      const track = generateTrackFromSpec(spec);
      for (let k = 0; k < 8; k++) {
        expect(track.tiles[k]!.solid).toBe(true);
        expect(track.tiles[k]!.ramp).toBe(false);
      }
      for (let k = 1; k < track.tiles.length; k++) {
        expect(track.tiles[k]!.solid || track.tiles[k - 1]!.solid).toBe(true);
      }
      // A ramp you cannot land on is not a ramp.
      for (const tile of track.tiles) expect(tile.ramp && !tile.solid).toBe(false);
    }
  });

  it('turns gaps on only when asked', () => {
    const solidCount = (spec: TrackSpec) =>
      generateTrackFromSpec(spec).tiles.filter((t) => !t.solid).length;
    const base = { ...defaultSpec('holes'), tiles: 400 };
    expect(solidCount(base)).toBe(0);
    expect(solidCount({ ...base, gaps: 0.2 })).toBeGreaterThan(20);
  });

  it('changes only the hills when the hills knob moves', () => {
    const base = { ...defaultSpec('isolated'), tiles: 300, gaps: 0.15, ramps: 0.1 };
    const flat = generateTrackFromSpec({ ...base, hills: 0.2 });
    const steep = generateTrackFromSpec({ ...base, hills: 1.6 });

    // Where the gaps and ramps fall is unchanged: the features draw from their
    // own random stream, so one slider moves one thing.
    expect(steep.tiles.map((t) => t.solid)).toEqual(flat.tiles.map((t) => t.solid));
    expect(steep.tiles.map((t) => t.ramp)).toEqual(flat.tiles.map((t) => t.ramp));

    // Steeper means steeper tiles. Not a taller course: past a point the tilt
    // clamp turns the terrain into a sawtooth, which is savage to drive but
    // does not climb any higher.
    const meanTilt = (t: ReturnType<typeof generateTrackFromSpec>) => {
      let total = 0;
      for (const tile of t.tiles) {
        const [a, b] = tile.vertices;
        total += Math.abs(Math.atan2(b.y - a.y, b.x - a.x));
      }
      return total / t.tiles.length;
    };
    expect(meanTilt(steep)).toBeGreaterThan(meanTilt(flat) * 2);
  });

  it('measures its length from the spawn point', () => {
    const track = generateTrackFromSpec(defaultSpec('len'));
    expect(track.length).toBeGreaterThan(0);
    expect(track.length).toBeCloseTo(track.endX, 5);
  });
});

describe('medals', () => {
  it('awards in order and needs the whole course for the author medal', () => {
    expect(medalFor(0, 100)).toBeNull();
    expect(medalFor(19, 100)).toBeNull();
    expect(medalFor(20, 100)).toBe('bronze');
    expect(medalFor(45, 100)).toBe('silver');
    expect(medalFor(70, 100)).toBe('gold');
    expect(medalFor(97, 100)).toBe('gold');
    expect(medalFor(98, 100)).toBe('author');
    expect(medalFor(500, 100)).toBe('author');
  });

  it('does not divide by a zero-length course', () => {
    expect(medalFor(10, 0)).toBeNull();
    expect(medalFor(10, -5)).toBeNull();
  });
});

describe('descriptions', () => {
  it('names what makes a track distinctive', () => {
    expect(describeSpec(defaultSpec('x'))).toContain('200 tiles');
    const nasty = normaliseSpec({ seed: 'n', hills: 2, gaps: 0.2, ramps: 0.2, width: 0.4 });
    expect(describeSpec(nasty)).toContain('gappy');
    expect(describeSpec(nasty)).toContain('narrow');
  });
});

describe('spec identity', () => {
  it('treats specs that encode the same as the same', () => {
    const a = defaultSpec('same');
    expect(sameSpec(a, { ...a })).toBe(true);
    expect(sameSpec(a, { ...a, seed: 'other' })).toBe(false);
    expect(sameSpec(a, { ...a, gaps: 0.2 })).toBe(false);
  });
});
