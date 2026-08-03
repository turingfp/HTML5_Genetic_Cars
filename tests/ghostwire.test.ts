/**
 * Sharing a lap: the ghost as it goes over the wire and comes back.
 *
 * Two real rooms wired to each other through a fake socket, because the part
 * worth testing is not that WebRTC works, it is that a run recorded here is the
 * same run there, and that a hostile one is nothing at all. Frames arrive as
 * raw bytes with the car riding alongside as metadata, so both halves have to
 * agree before anything reaches the scene.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rngFromSeed } from '../src/core/rng';
import { randomCar3D } from '../src/ga/genome3d';
import {
  GHOST_MAX_WIRE_FRAMES,
  packCar3D,
  readGhostFrames,
  readGhostMeta,
  type GhostMessage,
} from '../src/net/wire';
import { Room, type Peer } from '../src/net/room';
import { Ghost3D } from '../src/replay/ghost3d';
import { REPLAY3D_STRIDE, Replay3DRecorder } from '../src/replay/recorder3d';

interface FakeAction {
  onMessage: ((data: unknown, ctx: { peerId: string; metadata?: unknown }) => void) | null;
  send: (data: unknown, options?: { metadata?: unknown }) => Promise<void>;
}

/** Every fake room made in a test, so one can post into another. */
const rooms: { id: string; actions: Map<string, FakeAction> }[] = [];
let nextId = 0;

vi.mock('trystero', () => ({
  joinRoom: () => {
    const actions = new Map<string, FakeAction>();
    const entry = { id: `peer${nextId++}`, actions };
    rooms.push(entry);
    return {
      onPeerJoin: null,
      onPeerLeave: null,
      makeAction: (namespace: string) => {
        const action: FakeAction = {
          onMessage: null,
          // The real transport hands binary back as a bare ArrayBuffer
          // whatever went in, and everyone else on the wire gets it, so the
          // fake does both.
          send: (data, options) => {
            for (const other of rooms) {
              if (other === entry) continue;
              const target = other.actions.get(namespace);
              target?.onMessage?.(data, { peerId: entry.id, metadata: options?.metadata });
            }
            return Promise.resolve();
          },
        };
        actions.set(namespace, action);
        return action;
      },
      leave: () => undefined,
    };
  },
  getRelaySockets: () => ({ relay: { readyState: 1 } }),
}));

/** A recorded run, with poses that are plausible rather than merely finite. */
function recordRun(frames: number): Replay3DRecorder {
  const recorder = new Replay3DRecorder();
  for (let i = 0; i < frames * 2; i++) {
    const angle = i * 0.01;
    recorder.add(
      { x: i * 0.05, y: 1 + Math.sin(angle) * 0.1, z: 0 },
      { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) },
    );
  }
  return recorder;
}

function ghostWith(frames: number, score: number): Ghost3D {
  const ghost = new Ghost3D();
  ghost.consider(recordRun(frames), randomCar3D(rngFromSeed('car')), score, 3);
  return ghost;
}

/** The offer the app makes, kept here so the test packs it the same way. */
function offerFrom(ghost: Ghost3D): GhostMessage {
  const replay = ghost.share()!;
  return {
    meta: {
      car: packCar3D(replay.def),
      score: replay.score,
      generation: replay.generation,
      count: Math.min(replay.frameCount, GHOST_MAX_WIRE_FRAMES),
      mode: '3d',
    },
    frames: replay.frames,
  };
}

beforeEach(() => {
  rooms.length = 0;
  nextId = 0;
});

describe('sharing a ghost', () => {
  it('arrives on the other side as the same run', async () => {
    const mine = ghostWith(200, 120);
    const sender = await Room.join('t1', { name: 'me', mode: '3d' }, 100, {
      onChange: () => undefined,
    });
    sender.setGhostSource(() => offerFrom(mine));

    const received: { peer: Peer; ghost: GhostMessage }[] = [];
    await Room.join('t1', { name: 'them', mode: '3d' }, 100, {
      onChange: () => undefined,
      onGhost: (peer, ghost) => received.push({ peer, ghost }),
    });

    sender.sendGhost();

    expect(received).toHaveLength(1);
    const arrived = received[0]!.ghost;
    expect(arrived.meta.score).toBe(120);
    expect(arrived.meta.count).toBe(200);
    expect(arrived.frames.length).toBe(200 * REPLAY3D_STRIDE);
    expect([...arrived.frames]).toEqual([...mine.share()!.frames]);
  });

  it('does not broadcast the same lap over and over', async () => {
    // Only the clock, because the room's sweep timer is not what is under test.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const mine = ghostWith(60, 70);
      const sender = await Room.join('t3', { name: 'me', mode: '3d' }, 100, {
        onChange: () => undefined,
      });
      sender.setGhostSource(() => offerFrom(mine));

      let heard = 0;
      await Room.join('t3', { name: 'them', mode: '3d' }, 100, {
        onChange: () => undefined,
        onGhost: () => heard++,
      });

      sender.sendGhost();
      sender.sendGhost();
      sender.sendGhost();
      expect(heard).toBe(1);

      // A peer arriving still gets one immediately, limit or no limit.
      sender.sendGhost('newcomer');
      expect(heard).toBe(2);

      vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
      sender.sendGhost();
      expect(heard).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing when there is no run yet', async () => {
    const sender = await Room.join('t2', { name: 'me', mode: '3d' }, 100, {
      onChange: () => undefined,
    });
    sender.setGhostSource(() => null);

    let heard = 0;
    await Room.join('t2', { name: 'them', mode: '3d' }, 100, {
      onChange: () => undefined,
      onGhost: () => heard++,
    });

    sender.sendGhost();
    expect(heard).toBe(0);
  });

  it('does not pass on a ghost that came from someone else', () => {
    const ghost = new Ghost3D();
    ghost.adopt({
      def: randomCar3D(rngFromSeed('theirs')),
      frames: new Float32Array(REPLAY3D_STRIDE),
      frameCount: 1,
      score: 90,
      generation: 2,
      who: 'someone',
    });
    expect(ghost.available).toBe(true);
    expect(ghost.share()).toBeNull();
  });

  it('keeps the better lap whichever way round it arrives', () => {
    const ghost = ghostWith(50, 80);
    const theirs = ghostWith(50, 95).share()!;
    expect(ghost.adopt({ ...theirs, who: 'them' })).toBe(true);
    expect(ghost.score).toBe(95);
    expect(ghost.who).toBe('them');
    // And a slower one after it changes nothing.
    expect(ghost.adopt({ ...ghostWith(50, 60).share()!, who: 'other' })).toBe(false);
    expect(ghost.who).toBe('them');
  });
});

describe('a ghost from a stranger', () => {
  const good = () => offerFrom(ghostWith(20, 50));

  it('is refused when the buffer does not match the announced length', () => {
    const offer = good();
    expect(readGhostFrames(offer.frames.buffer, offer.meta.count + 1)).toBeNull();
    expect(readGhostFrames(offer.frames.buffer, 1)).toBeNull();
  });

  it('is refused for a frame that is not a number', () => {
    const offer = good();
    const frames = offer.frames.slice();
    frames[3 * REPLAY3D_STRIDE] = NaN;
    expect(readGhostFrames(frames.buffer, offer.meta.count)).toBeNull();
  });

  it('is refused for a rotation that would scale the car', () => {
    const offer = good();
    const frames = offer.frames.slice();
    // Still inside the per-component range, but no longer a unit quaternion,
    // which three.js would happily apply as a scale.
    frames[5 * REPLAY3D_STRIDE + 3] = 0.9;
    frames[5 * REPLAY3D_STRIDE + 4] = 0.9;
    expect(readGhostFrames(frames.buffer, offer.meta.count)).toBeNull();
  });

  it('is refused for a position out past anywhere the track goes', () => {
    const offer = good();
    const frames = offer.frames.slice();
    frames[2 * REPLAY3D_STRIDE] = 1e9;
    expect(readGhostFrames(frames.buffer, offer.meta.count)).toBeNull();
  });

  it('is refused when it is not binary at all', () => {
    expect(readGhostFrames('frames', 1)).toBeNull();
    expect(readGhostFrames(null, 1)).toBeNull();
    expect(readGhostFrames({ length: 7 }, 1)).toBeNull();
  });

  it('is refused for a frame count nobody could have driven', () => {
    const meta = good().meta;
    expect(readGhostMeta({ ...meta, count: GHOST_MAX_WIRE_FRAMES + 1 })).toBeNull();
    expect(readGhostMeta({ ...meta, count: 0 })).toBeNull();
    expect(readGhostMeta({ ...meta, count: 12.5 })).toBeNull();
    expect(readGhostMeta({ ...meta, count: 1e9 })).toBeNull();
  });

  it('is refused for a broken header', () => {
    const meta = good().meta;
    expect(readGhostMeta({ ...meta, mode: 'sideways' })).toBeNull();
    expect(readGhostMeta({ ...meta, score: NaN })).toBeNull();
    expect(readGhostMeta({ ...meta, car: null })).toBeNull();
    expect(readGhostMeta(null)).toBeNull();
    expect(readGhostMeta(meta)).not.toBeNull();
  });
});
