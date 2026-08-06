/**
 * The room's bookkeeping, with Trystero replaced by a fake.
 *
 * The real transport needs public relays, which no test should depend on and
 * plenty of networks block anyway. What is worth testing is everything on this
 * side of the socket: who is in the room, what happens when they go quiet, and
 * that a hostile message cannot get a car into anybody's population.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { randomCar } from '../src/ga/genome';
import { rngFromSeed } from '../src/core/rng';
import { packCar } from '../src/net/wire';

/** One fake Trystero action: whatever the room sends, plus a way to inject. */
interface FakeAction {
  sent: unknown[];
  deliver: (data: unknown, peerId: string) => void;
}

const actions = new Map<string, FakeAction>();
let fakeRoom: {
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
  left: boolean;
  makeAction: (namespace: string) => unknown;
  leave: () => void;
};
let relayState = 1;

vi.mock('trystero', () => ({
  // The object handed back *is* the one the room installs its handlers on, so
  // the test can fire onPeerJoin and onPeerLeave the way the real transport
  // would.
  joinRoom: () => {
    fakeRoom = {
      onPeerJoin: null,
      onPeerLeave: null,
      left: false,
      makeAction: (namespace: string) => {
        const action = {
          sent: [] as unknown[],
          onMessage: null as ((data: unknown, ctx: { peerId: string }) => void) | null,
          send: (data: unknown) => {
            action.sent.push(data);
            return Promise.resolve();
          },
        };
        actions.set(namespace, {
          sent: action.sent,
          deliver: (data, peerId) => action.onMessage?.(data, { peerId }),
        });
        return action;
      },
      leave: () => {
        fakeRoom.left = true;
      },
    };
    return fakeRoom;
  },
  getRelaySockets: () => ({ 'wss://fake': { readyState: relayState } }),
}));

const { Room, suggestName } = await import('../src/net/room');

const TRACK_LENGTH = 100;

async function join(events: Partial<Parameters<typeof Room.join>[3]> = {}) {
  actions.clear();
  const room = await Room.join(
    't1code',
    { name: 'me', mode: '3d' },
    TRACK_LENGTH,
    { onChange: () => undefined, ...events } as Parameters<typeof Room.join>[3],
  );
  return room;
}

const hello = () => actions.get('hi')!;
const score = () => actions.get('score')!;
const champ = () => actions.get('champ')!;

const goodCar = () => packCar(randomCar(rngFromSeed('champion')));

beforeEach(() => {
  relayState = 1;
  vi.useRealTimers();
});

describe('joining', () => {
  it('announces itself on arrival', async () => {
    const room = await join();
    expect(hello().sent).toEqual([{ name: 'me', mode: '3d' }]);
    await room.leave();
  });

  it('starts with nobody in it', async () => {
    const room = await join();
    expect(room.peers()).toEqual([]);
    await room.leave();
  });
});

describe('who is here', () => {
  it('records a peer from their hello', async () => {
    const changes = vi.fn();
    const room = await join({ onChange: changes });
    hello().deliver({ name: 'Ada', mode: '2d' }, 'p1');

    expect(room.peers()).toHaveLength(1);
    expect(room.peers()[0]!.name).toBe('Ada');
    expect(room.peers()[0]!.mode).toBe('2d');
    expect(changes).toHaveBeenCalled();
    await room.leave();
  });

  it('ignores a malformed hello entirely', async () => {
    const room = await join();
    hello().deliver({ name: 'Ada', mode: 'sideways' }, 'p1');
    hello().deliver(null, 'p2');
    hello().deliver('hello', 'p3');
    expect(room.peers()).toEqual([]);
    await room.leave();
  });

  it('ranks peers by how far they have got', async () => {
    const room = await join();
    for (const [id, best] of [
      ['p1', 10],
      ['p2', 90],
      ['p3', 50],
    ] as const) {
      score().deliver({ generation: 1, best, evaluations: 20, mode: '3d' }, id);
    }
    expect(room.peers().map((p) => p.id)).toEqual(['p2', 'p3', 'p1']);
    await room.leave();
  });

  it('awards medals against the track length', async () => {
    const room = await join();
    score().deliver({ generation: 1, best: 75, evaluations: 1, mode: '3d' }, 'p1');
    score().deliver({ generation: 1, best: 5, evaluations: 1, mode: '3d' }, 'p2');
    const byId = new Map(room.peers().map((p) => [p.id, p.medal]));
    expect(byId.get('p1')).toBe('gold');
    expect(byId.get('p2')).toBeNull();
    await room.leave();
  });

  it('recomputes medals when the course changes length', async () => {
    const room = await join();
    score().deliver({ generation: 1, best: 75, evaluations: 1, mode: '3d' }, 'p1');
    expect(room.peers()[0]!.medal).toBe('gold');
    // The same 75 metres is only 7% of a course ten times as long, so it is
    // worth nothing there. Medals describe the track, not the distance.
    room.setTrackLength(1000);
    expect(room.peers()[0]!.medal).toBeNull();
    await room.leave();
  });

  it('drops a peer that says goodbye', async () => {
    const room = await join();
    hello().deliver({ name: 'Ada', mode: '3d' }, 'p1');
    expect(room.peers()).toHaveLength(1);
    fakeRoom.onPeerLeave?.('p1');
    expect(room.peers()).toEqual([]);
    await room.leave();
  });

  it('greets a newcomer directly rather than shouting again', async () => {
    const room = await join();
    hello().sent.length = 0;
    fakeRoom.onPeerJoin?.('p9');
    expect(hello().sent).toEqual([{ name: 'me', mode: '3d' }]);
    expect(room.peers()).toHaveLength(1);
    await room.leave();
  });

  it('adds up what the whole room has evaluated', async () => {
    const room = await join();
    score().deliver({ generation: 3, best: 10, evaluations: 60, mode: '3d' }, 'p1');
    score().deliver({ generation: 3, best: 10, evaluations: 40, mode: '3d' }, 'p2');
    expect(room.totalEvaluations(100)).toBe(200);
    await room.leave();
  });
});

describe('champions', () => {
  it('accepts one and offers it as a migrant', async () => {
    const room = await join();
    champ().deliver({ car: goodCar(), score: 50, generation: 4, mode: '3d' }, 'p1');
    const migrant = room.takeMigrant('3d', () => 0.5);
    expect(migrant).not.toBeNull();
    expect(migrant!.score).toBe(50);
    await room.leave();
  });

  it('never hands a champion to the wrong mode', async () => {
    const room = await join();
    champ().deliver({ car: goodCar(), score: 50, generation: 4, mode: '3d' }, 'p1');
    expect(room.takeMigrant('2d', () => 0.5)).toBeNull();
    expect(room.takeMigrant('3d', () => 0.5)).not.toBeNull();
    await room.leave();
  });

  it('has nothing to offer when nobody has sent one', async () => {
    const room = await join();
    hello().deliver({ name: 'Ada', mode: '3d' }, 'p1');
    expect(room.takeMigrant('3d', () => 0.5)).toBeNull();
    await room.leave();
  });

  it('keeps only the latest champion per peer, however many they send', async () => {
    const room = await join();
    for (let i = 0; i < 500; i++) {
      champ().deliver({ car: goodCar(), score: i, generation: i, mode: '3d' }, 'flooder');
    }
    expect(room.peers()).toHaveLength(1);
    expect(room.takeMigrant('3d', () => 0.5)!.score).toBe(499);
    await room.leave();
  });

  it('drops a champion message that is not one', async () => {
    const room = await join();
    champ().deliver({ score: 10, generation: 1, mode: '3d' }, 'p1');
    champ().deliver({ car: goodCar(), score: NaN, generation: 1, mode: '3d' }, 'p2');
    champ().deliver(null, 'p3');
    expect(room.takeMigrant('3d', () => 0.5)).toBeNull();
    await room.leave();
  });

  it('favours the peers who are doing well', async () => {
    const room = await join();
    champ().deliver({ car: goodCar(), score: 1, generation: 1, mode: '3d' }, 'weak');
    champ().deliver({ car: goodCar(), score: 99, generation: 1, mode: '3d' }, 'strong');
    // Draws are weighted by score, so almost every ticket lands on the strong
    // one. Sampling rather than asserting a single draw, because which offer a
    // given ticket hits depends on map order.
    let strong = 0;
    for (let i = 0; i < 200; i++) {
      const pick = room.takeMigrant('3d', () => i / 200);
      if (pick?.score === 99) strong++;
    }
    expect(strong).toBeGreaterThan(150);
    await room.leave();
  });

  it('notifies when one arrives', async () => {
    const onChampion = vi.fn();
    const room = await join({ onChampion });
    champ().deliver({ car: goodCar(), score: 5, generation: 1, mode: '3d' }, 'p1');
    expect(onChampion).toHaveBeenCalledTimes(1);
    await room.leave();
  });
});

describe('going quiet', () => {
  it('sweeps out a peer that has not been heard from', async () => {
    vi.useFakeTimers();
    const room = await join();
    hello().deliver({ name: 'Ada', mode: '3d' }, 'p1');
    expect(room.peers()).toHaveLength(1);

    // Past the timeout, and far enough for a sweep to have run.
    vi.advanceTimersByTime(120_000);
    expect(room.peers()).toEqual([]);
    await room.leave();
    vi.useRealTimers();
  });

  it('keeps a peer that is still talking', async () => {
    vi.useFakeTimers();
    const room = await join();
    hello().deliver({ name: 'Ada', mode: '3d' }, 'p1');
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(30_000);
      score().deliver({ generation: i, best: i, evaluations: i, mode: '3d' }, 'p1');
    }
    expect(room.peers()).toHaveLength(1);
    await room.leave();
    vi.useRealTimers();
  });
});

describe('leaving', () => {
  it('forgets everyone and stops sending', async () => {
    const room = await join();
    hello().deliver({ name: 'Ada', mode: '3d' }, 'p1');
    await room.leave();

    expect(room.peers()).toEqual([]);
    const before = score().sent.length;
    room.report(1, 2, 3);
    expect(score().sent.length).toBe(before);
  });

  it('survives a transport that throws on the way out', async () => {
    const room = await join();
    fakeRoom.left = false;
    await expect(room.leave()).resolves.toBeUndefined();
  });
});

describe('relay trouble', () => {
  it('says so when no relay ever opens', async () => {
    vi.useFakeTimers();
    relayState = 3; // CLOSED
    const onTrouble = vi.fn();
    const room = await join({ onTrouble });

    vi.advanceTimersByTime(20_000);
    expect(onTrouble).toHaveBeenCalledTimes(1);
    expect(String(onTrouble.mock.calls[0]![0])).toMatch(/blocking/i);
    await room.leave();
    vi.useRealTimers();
  });

  it('stays quiet when a relay is up', async () => {
    vi.useFakeTimers();
    relayState = 1; // OPEN
    const onTrouble = vi.fn();
    const room = await join({ onTrouble });

    vi.advanceTimersByTime(20_000);
    expect(onTrouble).not.toHaveBeenCalled();
    await room.leave();
    vi.useRealTimers();
  });
});

describe('names', () => {
  it('suggests something readable', () => {
    for (const pick of [() => 0, () => 0.5, () => 0.999]) {
      expect(suggestName(pick)).toMatch(/^[a-z]+ [a-z]+$/);
    }
  });
});
