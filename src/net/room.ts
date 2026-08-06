/**
 * Everyone on the same track, in the same room, breeding into each other.
 *
 * This is the island model from the distributed genetic algorithm literature,
 * except the islands are other people's browsers and the sea is WebRTC. Each
 * tab runs its own population in isolation, which is the whole point: isolated
 * populations explore different parts of the search space and get stuck in
 * different local optima. Every so often a champion crosses over, and a
 * lineage that one machine could never have found arrives fully formed from
 * someone else's.
 *
 * There is no server. Trystero does the introductions over public relays and
 * everything after that is peer to peer, so a room costs nothing to run and
 * nobody's cars pass through a machine we own.
 *
 * Joining is always something you ask for. It announces you to strangers on
 * public infrastructure, which is not a thing to do to someone because they
 * opened a page.
 */

import { REPLAY3D_STRIDE as GHOST_STRIDE } from '../replay/recorder3d';
import { medalFor, type MedalName } from '../track/spec';
import {
  cleanName,
  readChampion,
  readGhostFrames,
  readGhostMeta,
  readHello,
  readScore,
  type ChampionMessage,
  type GhostMessage,
  type GhostMeta,
  type HelloMessage,
  type ScoreMessage,
  type WireCar,
} from './wire';

/** Namespaces the room sends on. Trystero caps these at twelve bytes. */
const ACTIONS = { hello: 'hi', score: 'score', champion: 'champ', ghost: 'ghost' } as const;

/** Identifies this application to the relays, so rooms cannot collide. */
const APP_ID = 'boxcar3d-v1';

/**
 * How long a peer may go unheard from before it is dropped.
 *
 * Trystero reports a clean departure, but a closed laptop is not a clean
 * departure, and a leaderboard full of people who left an hour ago is worse
 * than one that is a minute out of date.
 */
const PEER_TIMEOUT_MS = 90_000;

/**
 * Shortest gap between broadcasting this tab's ghost.
 *
 * Long enough that a burst of quick early generations costs one send, short
 * enough that a genuinely better lap is racing on everyone else's screen while
 * it still feels like news.
 */
const GHOST_BROADCAST_INTERVAL_MS = 20_000;

/** How long to give the relays before deciding none of them will answer. */
const RELAY_CHECK_INTERVAL_MS = 4000;
const RELAY_CHECKS = 3;

/** What we know about someone else in the room. */
export interface Peer {
  id: string;
  name: string;
  mode: '2d' | '3d';
  generation: number;
  /** Furthest they have got, in metres. */
  best: number;
  /** Cars they have evaluated all run, which is their share of the work. */
  evaluations: number;
  medal: MedalName | null;
  /** Their best car, if they have offered it. */
  champion: ChampionMessage | null;
  lastSeen: number;
}

/** What this tab tells the room about itself. */
export interface SelfState {
  name: string;
  mode: '2d' | '3d';
}

export interface RoomEvents {
  /** Anything about the room changed: who is here, or how they are doing. */
  onChange: () => void;
  /** A champion arrived from `peer`. */
  onChampion?: (peer: Peer) => void;
  /** Someone's recorded run arrived, to race against. */
  onGhost?: (peer: Peer, ghost: GhostMessage) => void;
  /** The relays reported a problem. The room may still work through others. */
  onTrouble?: (reason: string) => void;
}

/**
 * The slice of Trystero this uses, typed here rather than imported.
 *
 * Importing its types at the top would pull the module into the main bundle,
 * which defeats the point of only fetching it when someone joins.
 */
interface MessageAction<T, M = never> {
  send: (
    data: T,
    options?: { target?: string | string[] | null; metadata?: M },
  ) => Promise<void>;
  onMessage: ((data: T, context: { peerId: string; metadata?: unknown }) => void) | null;
}

interface TrysteroRoom {
  makeAction: <T, M = never>(namespace: string) => MessageAction<T, M>;
  onPeerJoin: ((peerId: string) => void) | null;
  onPeerLeave: ((peerId: string) => void) | null;
  leave: () => Promise<void> | void;
}

/**
 * Send and forget.
 *
 * `send` rejects if a peer's channel has closed between the leaderboard being
 * drawn and the message going out, which happens routinely and means nothing:
 * that peer is gone and the sweep will notice.
 */
function fireAndForget<T, M>(
  action: MessageAction<T, M> | null,
  data: T,
  target?: string,
  metadata?: M,
): void {
  const options = target || metadata !== undefined ? { target, metadata } : undefined;
  void action?.send(data, options).catch(() => undefined);
}

/**
 * A room keyed to a track code.
 *
 * Same code, same room: the code *is* the matchmaking, so sharing a track and
 * meeting the people driving it are the same action.
 */
export class Room {
  private room: TrysteroRoom | null = null;
  private readonly known = new Map<string, Peer>();
  private events: RoomEvents;
  private self: SelfState;
  private trackLength: number;

  private hello: MessageAction<HelloMessage> | null = null;
  private score: MessageAction<ScoreMessage> | null = null;
  private champion: MessageAction<ChampionMessage> | null = null;
  private ghost: MessageAction<ArrayBufferLike, GhostMeta> | null = null;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  private ghostSource: (() => GhostMessage | null) | null = null;
  private lastGhostSent = 0;
  private ghostPending = false;

  /** The code this room belongs to, so a track change can be detected. */
  readonly code: string;

  private constructor(code: string, self: SelfState, trackLength: number, events: RoomEvents) {
    this.code = code;
    this.self = self;
    this.trackLength = trackLength;
    this.events = events;
  }

  /**
   * Join the room for a track code.
   *
   * Trystero is fetched here rather than imported at the top, so a tab that
   * never joins never downloads it and never touches a relay.
   */
  static async join(
    code: string,
    self: SelfState,
    trackLength: number,
    events: RoomEvents,
  ): Promise<Room> {
    const instance = new Room(code, self, trackLength, events);
    const trystero = (await import('trystero')) as unknown as {
      joinRoom: (
        config: { appId: string },
        roomId: string,
        callbacks?: { onJoinError?: (details: { error: string }) => void },
      ) => TrysteroRoom;
      getRelaySockets: () => Record<string, { readyState: number }>;
    };
    const { joinRoom } = trystero;

    const room = joinRoom({ appId: APP_ID }, `track-${code}`, {
      // Relays are public infrastructure and some networks block them
      // outright. Saying so beats sitting on "connected" in an empty room.
      onJoinError: (details) => instance.events.onTrouble?.(details.error),
    });
    instance.room = room;

    instance.hello = room.makeAction<HelloMessage>(ACTIONS.hello);
    instance.score = room.makeAction<ScoreMessage>(ACTIONS.score);
    instance.champion = room.makeAction<ChampionMessage>(ACTIONS.champion);
    instance.ghost = room.makeAction<ArrayBufferLike, GhostMeta>(ACTIONS.ghost);

    instance.hello.onMessage = (raw, ctx) => instance.receiveHello(raw, ctx.peerId);
    instance.score.onMessage = (raw, ctx) => instance.receiveScore(raw, ctx.peerId);
    instance.champion.onMessage = (raw, ctx) => instance.receiveChampion(raw, ctx.peerId);
    instance.ghost.onMessage = (raw, ctx) =>
      instance.receiveGhost(raw, ctx.peerId, ctx.metadata);

    room.onPeerJoin = (peerId) => {
      // Introduce ourselves to the newcomer specifically rather than shouting
      // at everyone again.
      instance.touch(peerId);
      fireAndForget(instance.hello, instance.self, peerId);
      // Hand the newcomer our ghost straight away. Arriving to an empty track
      // and arriving to someone's lap already running are different rooms.
      instance.sendGhost(peerId);
      instance.events.onChange();
    };
    room.onPeerLeave = (peerId) => {
      instance.known.delete(peerId);
      instance.events.onChange();
    };

    fireAndForget(instance.hello, self);
    instance.sweeper = globalThis.setInterval(() => instance.sweep(), 15_000);
    instance.watchRelays(trystero.getRelaySockets);
    return instance;
  }

  /**
   * Check that at least one relay actually opened.
   *
   * Trystero reports no error when every relay socket is refused: it has
   * joined a room, there is simply nobody in it and never will be. On a
   * network that blocks these hosts, and plenty do, that is indistinguishable
   * from being early. So look at the sockets and say which one it is.
   */
  private watchRelays(getRelaySockets: () => Record<string, { readyState: number }>): void {
    const check = (attempt: number) => {
      if (!this.room) return;
      let open = 0;
      try {
        for (const socket of Object.values(getRelaySockets() ?? {})) {
          if (socket?.readyState === 1) open++;
        }
      } catch {
        return;
      }
      if (open > 0) return;
      if (attempt < RELAY_CHECKS) {
        globalThis.setTimeout(() => check(attempt + 1), RELAY_CHECK_INTERVAL_MS);
        return;
      }
      this.events.onTrouble?.(
        'In the room, but no relay would take the connection. This network is probably blocking them.',
      );
    };
    globalThis.setTimeout(() => check(1), RELAY_CHECK_INTERVAL_MS);
  }

  /** Everyone currently here, best first. */
  peers(): Peer[] {
    return [...this.known.values()].sort((a, b) => b.best - a.best);
  }

  /** Cars evaluated by everyone here, this tab included. */
  totalEvaluations(mine: number): number {
    let total = mine;
    for (const peer of this.known.values()) total += peer.evaluations;
    return total;
  }

  /** Tell the room how this tab is doing. */
  report(generation: number, best: number, evaluations: number): void {
    fireAndForget(this.score, { generation, best, evaluations, mode: this.self.mode });
  }

  /** Offer this tab's best car to anyone who wants to breed from it. */
  offerChampion(car: WireCar, score: number, generation: number): void {
    fireAndForget(this.champion, { car, score, generation, mode: this.self.mode });
  }

  /**
   * Where to find this tab's ghost when there is someone to send it to.
   *
   * A callback rather than a stored copy, because the ghost changes every time
   * a generation beats the last one and the room should not be holding a stale
   * hundred kilobytes waiting for someone to join.
   */
  setGhostSource(source: (() => GhostMessage | null) | null): void {
    this.ghostSource = source;
  }

  /**
   * Send the current ghost to one peer, or to the whole room.
   *
   * Broadcasts are rate limited because a ghost is a hundred kilobytes and
   * early generations beat each other every few seconds: without this a room
   * of six spends its bandwidth on laps that are obsolete before they arrive.
   * A suppressed one is not dropped, it goes out on the next sweep. Sends
   * aimed at a single peer skip the limit, since those are someone arriving
   * and they only happen once each.
   */
  sendGhost(target?: string): void {
    if (!target) {
      const now = Date.now();
      if (now - this.lastGhostSent < GHOST_BROADCAST_INTERVAL_MS) {
        this.ghostPending = true;
        return;
      }
      this.lastGhostSent = now;
      this.ghostPending = false;
    }
    const offer = this.ghostSource?.();
    if (!offer || offer.meta.count === 0) return;
    // Trystero chunks this for us, and the copy is because a Float32Array's
    // buffer may be larger than the view when it came out of a recorder.
    const bytes = offer.frames.slice(0, offer.meta.count * GHOST_STRIDE).buffer;
    fireAndForget(this.ghost, bytes, target, offer.meta);
  }

  /** Say who we are again, after a rename or a mode switch. */
  setSelf(self: SelfState): void {
    this.self = self;
    fireAndForget(this.hello, self);
  }

  setTrackLength(length: number): void {
    this.trackLength = length;
    for (const peer of this.known.values()) peer.medal = medalFor(peer.best, length);
  }

  /**
   * A champion offered by someone else running the same mode, or null.
   *
   * Picks among peers by how well they are doing, so migration flows from
   * stronger islands to weaker ones, which is the direction that helps. `pick`
   * is the caller's random number source, so a run stays reproducible given
   * the same messages.
   */
  takeMigrant(mode: '2d' | '3d', pick: () => number): ChampionMessage | null {
    const offers = [...this.known.values()]
      .filter((peer) => peer.champion && peer.champion.mode === mode)
      .map((peer) => peer.champion!);
    if (offers.length === 0) return null;

    let total = 0;
    for (const offer of offers) total += Math.max(0.001, offer.score);
    let ticket = pick() * total;
    for (const offer of offers) {
      ticket -= Math.max(0.001, offer.score);
      if (ticket <= 0) return offer;
    }
    return offers[offers.length - 1] ?? null;
  }

  async leave(): Promise<void> {
    if (this.sweeper !== null) globalThis.clearInterval(this.sweeper);
    this.sweeper = null;
    this.known.clear();
    const room = this.room;
    this.room = null;
    this.hello = null;
    this.score = null;
    this.champion = null;
    this.ghost = null;
    this.ghostSource = null;
    try {
      await room?.leave();
    } catch {
      // Leaving is best effort: the relay drops us either way.
    }
  }

  /* ── Incoming ──────────────────────────────────────────────────────────── */

  private touch(peerId: string): Peer {
    const existing = this.known.get(peerId);
    if (existing) {
      existing.lastSeen = Date.now();
      return existing;
    }
    const peer: Peer = {
      id: peerId,
      name: cleanName(null),
      mode: '3d',
      generation: 0,
      best: 0,
      evaluations: 0,
      medal: null,
      champion: null,
      lastSeen: Date.now(),
    };
    this.known.set(peerId, peer);
    return peer;
  }

  private receiveHello(raw: unknown, peerId: string): void {
    const hello = readHello(raw);
    if (!hello) return;
    const peer = this.touch(peerId);
    peer.name = hello.name;
    peer.mode = hello.mode;
    this.events.onChange();
  }

  private receiveScore(raw: unknown, peerId: string): void {
    const score = readScore(raw);
    if (!score) return;
    const peer = this.touch(peerId);
    peer.generation = score.generation;
    peer.best = score.best;
    peer.evaluations = score.evaluations;
    peer.mode = score.mode;
    peer.medal = medalFor(score.best, this.trackLength);
    this.events.onChange();
  }

  private receiveChampion(raw: unknown, peerId: string): void {
    const champion = readChampion(raw);
    if (!champion) return;
    const peer = this.touch(peerId);
    // Only ever hold one champion per peer. A peer that floods the room with
    // cars should cost the same memory as one that sends a single car.
    peer.champion = champion;
    this.events.onChange();
    this.events.onChampion?.(peer);
  }

  private receiveGhost(raw: unknown, peerId: string, rawMeta: unknown): void {
    const meta = readGhostMeta(rawMeta);
    if (!meta) return;
    const frames = readGhostFrames(raw, meta.count);
    if (!frames) return;
    const peer = this.touch(peerId);
    this.events.onGhost?.(peer, { meta, frames });
  }

  /** Drop peers that have gone quiet without saying goodbye. */
  private sweep(): void {
    if (this.ghostPending) this.sendGhost();
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    let dropped = false;
    for (const [id, peer] of this.known) {
      if (peer.lastSeen < cutoff) {
        this.known.delete(id);
        dropped = true;
      }
    }
    if (dropped) this.events.onChange();
  }
}

/** A default name, so nobody has to type one before joining. */
export function suggestName(pick: () => number): string {
  const adjectives = ['quick', 'lucky', 'odd', 'bold', 'calm', 'wild', 'keen', 'sly'];
  const nouns = ['spanner', 'piston', 'gearbox', 'axle', 'clutch', 'sprocket', 'cam', 'rotor'];
  const adjective = adjectives[Math.floor(pick() * adjectives.length)] ?? 'odd';
  const noun = nouns[Math.floor(pick() * nouns.length)] ?? 'axle';
  return `${adjective} ${noun}`;
}
