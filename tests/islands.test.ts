/**
 * Two populations, two rooms, one search.
 *
 * Everything else tests a piece: the wire format, the room's bookkeeping, the
 * GA's migrant slots. This tests the claim the whole thing is built on, which
 * is that a car bred in one population can end up driving in another one, and
 * that it arrives intact.
 *
 * The only fake is the socket. Two real `Room` instances are wired to each
 * other, and two real `Simulation` instances take migrants through the same
 * `migrantSource` seam the application uses. Public relays are not something a
 * test should need, and plenty of networks block them anyway.
 */

import { describe, expect, it, vi } from 'vitest';

import { carOps } from '../src/ga/evolution';
import type { CarDef } from '../src/ga/genome';
import { packCar, unpackCar } from '../src/net/wire';

/** A message bus that delivers between the rooms currently on it. */
interface Endpoint {
  id: string;
  actions: Map<string, { onMessage: ((data: unknown, ctx: { peerId: string }) => void) | null }>;
  onPeerJoin: ((id: string) => void) | null;
  onPeerLeave: ((id: string) => void) | null;
}

const bus: Endpoint[] = [];
let nextId = 0;

vi.mock('trystero', () => ({
  joinRoom: () => {
    const self: Endpoint = {
      id: `peer${nextId++}`,
      actions: new Map(),
      onPeerJoin: null,
      onPeerLeave: null,
    };
    const room = {
      ...self,
      makeAction: (namespace: string) => {
        const action = {
          onMessage: null as ((data: unknown, ctx: { peerId: string }) => void) | null,
          // Deliver to everyone else on the bus, or to one named peer, exactly
          // as the real transport does.
          send: (data: unknown, options?: { target?: string }) => {
            // Through JSON, because the transport serialises and a genome that
            // only survives by reference would pass a weaker test.
            const wire: unknown = JSON.parse(JSON.stringify(data));
            for (const other of bus) {
              if (other === room) continue;
              if (options?.target && other.id !== options.target) continue;
              other.actions.get(namespace)?.onMessage?.(wire, { peerId: room.id });
            }
            return Promise.resolve();
          },
        };
        room.actions.set(namespace, action);
        return action;
      },
      leave: () => {
        const at = bus.indexOf(room);
        if (at >= 0) bus.splice(at, 1);
        for (const other of bus) other.onPeerLeave?.(room.id);
      },
    };

    // Announce in both directions, but only once this room has finished
    // wiring its actions. A real transport cannot deliver a message to a room
    // that does not exist yet, and delivering one synchronously here made the
    // newcomer miss every greeting sent to it.
    for (const other of bus) {
      queueMicrotask(() => {
        other.onPeerJoin?.(room.id);
        room.onPeerJoin?.(other.id);
      });
    }
    bus.push(room);
    return room;
  },
  getRelaySockets: () => ({ fake: { readyState: 1 } }),
}));

const { Room } = await import('../src/net/room');
const { Simulation } = await import('../src/sim/simulation');

const CODE = 't1shared';

async function joinAll(names: string[]) {
  bus.length = 0;
  nextId = 0;
  const rooms = [];
  for (const name of names) {
    rooms.push(await Room.join(CODE, { name, mode: '2d' }, 300, { onChange: () => undefined }));
  }
  // onPeerJoin for the earlier members is queued as a microtask.
  await Promise.resolve();
  return rooms;
}

const identical = (a: CarDef, b: CarDef) => carOps.distance(a, b) === 0;

describe('two browsers on one track', () => {
  it('see each other', async () => {
    const [alice, bob] = await joinAll(['alice', 'bob']);
    expect(alice!.peers().map((p) => p.name)).toEqual(['bob']);
    expect(bob!.peers().map((p) => p.name)).toEqual(['alice']);
    await alice!.leave();
    await bob!.leave();
  });

  it('carries a champion from one population into the other, intact', async () => {
    const [alice, bob] = await joinAll(['alice', 'bob']);

    // Alice breeds a car and offers it. Bob has never seen this genome.
    const alicesCar = new Simulation({ trackSeed: 'shared', runSeed: 'alice' }).cars[0]!.def;
    alice!.offerChampion(packCar(alicesCar), 120, 3);

    const offer = bob!.takeMigrant('2d', () => 0.5);
    expect(offer).not.toBeNull();

    const arrived = unpackCar(offer!.car);
    expect(arrived).not.toBeNull();
    // The same car, not merely a plausible one: through JSON, through
    // validation, and out the other side unchanged.
    expect(identical(arrived!, alicesCar)).toBe(true);
    expect(arrived!.brain.weights).toEqual(alicesCar.brain.weights);

    await alice!.leave();
    await bob!.leave();
  });

  it('puts a migrant into the next generation of a real population', async () => {
    const [alice, bob] = await joinAll(['alice', 'bob']);

    const alicesCar = new Simulation({ trackSeed: 'shared', runSeed: 'alice' }).cars[0]!.def;
    alice!.offerChampion(packCar(alicesCar), 500, 1);

    const bobs = new Simulation({ trackSeed: 'shared', runSeed: 'bob' });
    bobs.params.migrants = 3;
    bobs.migrantSource = () => {
      const offer = bob!.takeMigrant('2d', () => 0.5);
      return offer ? unpackCar(offer.car) : null;
    };
    // Nothing of Alice's in Bob's world yet.
    expect(bobs.cars.some((car) => identical(car.def, alicesCar))).toBe(false);

    while (bobs.generation === 0) bobs.step();

    const immigrants = bobs.cars.filter((car) => identical(car.def, alicesCar));
    expect(immigrants).toHaveLength(3);
    // Foreign lines are numbered apart from the local ones, so the family
    // colours can tell them apart.
    const local = bobs.cars.filter((car) => !identical(car.def, alicesCar));
    for (const migrant of immigrants) {
      expect(local.some((car) => car.lineage === migrant.lineage)).toBe(false);
    }

    await alice!.leave();
    await bob!.leave();
  });

  it('never lets a hostile peer get a car into anyone else', async () => {
    const [attacker, victim] = await joinAll(['attacker', 'victim']);

    // A genome that would break the physics if it were ever built.
    const poison = packCar(new Simulation({ trackSeed: 'x', runSeed: 'x' }).cars[0]!.def);
    poison.b[0] = 1e9;
    attacker!.offerChampion(poison, 9999, 1);

    // The room takes the message, because only the car's shape is checked at
    // unpack time; the point is that nothing usable comes out of it.
    const offer = victim!.takeMigrant('2d', () => 0.5);
    expect(offer === null || unpackCar(offer.car) === null).toBe(true);

    await attacker!.leave();
    await victim!.leave();
  });

  it('keeps three populations in one room without crossing them up', async () => {
    const [a, b, c] = await joinAll(['a', 'b', 'c']);
    expect(a!.peers()).toHaveLength(2);
    expect(b!.peers()).toHaveLength(2);
    expect(c!.peers()).toHaveLength(2);

    const carA = new Simulation({ trackSeed: 's', runSeed: 'a' }).cars[0]!.def;
    const carB = new Simulation({ trackSeed: 's', runSeed: 'b' }).cars[0]!.def;
    a!.offerChampion(packCar(carA), 10, 1);
    b!.offerChampion(packCar(carB), 10, 1);

    // C can draw from either, and never from itself.
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const offer = c!.takeMigrant('2d', () => i / 50);
      const car = offer ? unpackCar(offer.car) : null;
      if (!car) continue;
      seen.add(identical(car, carA) ? 'a' : identical(car, carB) ? 'b' : 'other');
    }
    expect(seen).toEqual(new Set(['a', 'b']));

    await a!.leave();
    await b!.leave();
    await c!.leave();
  });

  it('stops offering a departed peer\'s cars', async () => {
    const [alice, bob] = await joinAll(['alice', 'bob']);
    const alicesCar = new Simulation({ trackSeed: 's', runSeed: 'alice' }).cars[0]!.def;
    alice!.offerChampion(packCar(alicesCar), 50, 1);
    expect(bob!.takeMigrant('2d', () => 0.5)).not.toBeNull();

    await alice!.leave();
    expect(bob!.peers()).toEqual([]);
    expect(bob!.takeMigrant('2d', () => 0.5)).toBeNull();

    await bob!.leave();
  });
});
