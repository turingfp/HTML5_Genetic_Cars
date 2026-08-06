/**
 * The 3D ghost: recording a run, keeping the best one, and replaying it in
 * step with the world.
 */

import { describe, expect, it } from 'vitest';

import { REPLAY_MAX_FRAMES } from '../src/config';
import { rngFromSeed } from '../src/core/rng';
import { randomCar3D } from '../src/ga/genome3d';
import { Ghost3D } from '../src/replay/ghost3d';
import {
  readReplay3DFrame,
  Replay3DRecorder,
  REPLAY3D_SAMPLE_EVERY,
  REPLAY3D_STRIDE,
} from '../src/replay/recorder3d';

const car = () => randomCar3D(rngFromSeed('ghost'));
const pos = (i: number) => ({ x: i, y: i * 2, z: i * 3 });
const rot = { x: 0, y: 0, z: 0, w: 1 };

/** Feed a recorder `steps` physics steps of a car moving along x. */
function record(steps: number): Replay3DRecorder {
  const r = new Replay3DRecorder();
  for (let i = 0; i < steps; i++) r.add(pos(i), rot);
  return r;
}

describe('recording', () => {
  it('samples rather than storing every step', () => {
    const r = record(100);
    expect(r.frameCount).toBe(Math.ceil(100 / REPLAY3D_SAMPLE_EVERY));
  });

  it('stores seven floats a frame, not a pose per body', () => {
    // The whole design: wheels hang off mounts fixed in the body's frame, so
    // the chassis pose puts them all back. A pose per body would be 63 floats.
    expect(REPLAY3D_STRIDE).toBe(7);
    const frames = record(1200).finish();
    expect(frames.length).toBe(600 * REPLAY3D_STRIDE);
    // A ninety second round at sixty hertz, for one car, in kilobytes.
    const kb = (frames.BYTES_PER_ELEMENT * frames.length) / 1024;
    expect(kb).toBeLessThan(20);
  });

  it('reads back exactly what went in', () => {
    const r = record(20);
    const replay = {
      def: car(),
      frames: r.finish(),
      frameCount: r.frameCount,
      score: 1,
      generation: 1,
      who: '',
    };
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 0 };
    expect(readReplay3DFrame(replay, 0, p, q)).toBe(true);
    expect(p).toEqual(pos(0));
    expect(readReplay3DFrame(replay, 3, p, q)).toBe(true);
    expect(p).toEqual(pos(3 * REPLAY3D_SAMPLE_EVERY));
    expect(q).toEqual(rot);
  });

  it('refuses a frame that is not there', () => {
    const r = record(10);
    const replay = {
      def: car(),
      frames: r.finish(),
      frameCount: r.frameCount,
      score: 1,
      generation: 1,
      who: '',
    };
    const p = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 0 };
    expect(readReplay3DFrame(replay, -1, p, q)).toBe(false);
    expect(readReplay3DFrame(replay, r.frameCount, p, q)).toBe(false);
  });

  it('stops growing rather than eating the tab', () => {
    const r = new Replay3DRecorder();
    for (let i = 0; i < REPLAY_MAX_FRAMES * REPLAY3D_SAMPLE_EVERY + 5000; i++) r.add(pos(i), rot);
    expect(r.frameCount).toBeLessThanOrEqual(REPLAY_MAX_FRAMES);
  });
});

describe('the ghost', () => {
  it('starts with nothing to show', () => {
    const g = new Ghost3D();
    expect(g.available).toBe(false);
    expect(g.current()).toBeNull();
  });

  it('takes a run, then only a better one', () => {
    const g = new Ghost3D();
    expect(g.consider(record(50), car(), 100, 1)).toBe(true);
    expect(g.score).toBe(100);
    expect(g.consider(record(50), car(), 90, 2)).toBe(false);
    expect(g.score).toBe(100);
    expect(g.consider(record(50), car(), 140, 3)).toBe(true);
    expect(g.score).toBe(140);
    expect(g.generation).toBe(3);
  });

  it('refuses a run that recorded nothing', () => {
    const g = new Ghost3D();
    expect(g.consider(new Replay3DRecorder(), car(), 500, 1)).toBe(false);
    expect(g.available).toBe(false);
  });

  it('advances in step with the physics, whatever the speed setting', () => {
    const g = new Ghost3D();
    g.consider(record(200), car(), 10, 1);
    const start = g.current()!.position.x;

    // Max mode takes many steps between drawn frames; the ghost has to keep
    // pace with simulated time, not with frames.
    g.advance(REPLAY3D_SAMPLE_EVERY * 10);
    expect(g.current()!.position.x).toBeGreaterThan(start);
    expect(g.current()!.position.x).toBe(pos(10 * REPLAY3D_SAMPLE_EVERY).x);
  });

  it('stops at the end rather than running off it', () => {
    const g = new Ghost3D();
    g.consider(record(40), car(), 10, 1);
    g.advance(100000);
    const frame = g.current();
    expect(frame).not.toBeNull();
    expect(Number.isFinite(frame!.position.x)).toBe(true);
  });

  it('goes back to the start line each generation', () => {
    const g = new Ghost3D();
    g.consider(record(200), car(), 10, 1);
    g.advance(120);
    const far = g.current()!.position.x;
    g.rewind();
    expect(g.current()!.position.x).toBeLessThan(far);
    expect(g.current()!.position.x).toBe(pos(0).x);
  });

  it('adopts a whole ghost from somewhere else, if it is better', () => {
    const g = new Ghost3D();
    g.consider(record(30), car(), 50, 1);
    const r = record(30);
    const theirs = {
      def: car(),
      frames: r.finish(),
      frameCount: r.frameCount,
      score: 200,
      generation: 7,
      who: 'ada',
    };
    expect(g.adopt(theirs)).toBe(true);
    expect(g.who).toBe('ada');
    expect(g.current()!.who).toBe('ada');
    // And not a worse one.
    expect(g.adopt({ ...theirs, score: 1, who: 'bob' })).toBe(false);
    expect(g.who).toBe('ada');
  });

  it('forgets everything when the track changes', () => {
    const g = new Ghost3D();
    g.consider(record(30), car(), 50, 1);
    g.clear();
    expect(g.available).toBe(false);
    expect(g.current()).toBeNull();
  });
});
