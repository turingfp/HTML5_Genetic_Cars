/**
 * The application: owns the simulation, the loop, the renderers and the UI,
 * and decides what updates when.
 *
 * The update cadence is the performance contract. Physics steps touch no DOM
 * at all; canvases and readouts refresh once per animation frame; the chart and
 * the hall of fame only change when a generation ends.
 */

import {
  DEFAULT_ELITE_COUNT,
  DEFAULT_MUTATION_RATE,
  DEFAULT_MUTATION_SIZE,
  DEFAULT_POPULATION_SIZE,
  DEFAULT_DIVERSITY_PRESSURE,
  DEFAULT_IMMIGRANTS,
  DEFAULT_MIGRANTS,
  MAX_DIVERSITY_PRESSURE,
  MAX_ELITE_COUNT,
  MAX_IMMIGRANTS,
  MAX_MIGRANTS,
  MAX_POPULATION_SIZE,
  MIN_POPULATION_SIZE,
  PHYSICS_HZ,
  SPEEDS,
  TIME_STEP,
  TOP_SCORE_COUNT,
  type Speed,
} from '../config';
import { hasWebGL } from '../core/device';
import { Room, suggestName, type Peer } from '../net/room';
import {
  GHOST_MAX_WIRE_FRAMES,
  packCar,
  packCar3D,
  unpackCar,
  unpackCar3D,
  type GhostMessage,
} from '../net/wire';
import {
  decodeSpec,
  defaultSpec,
  encodeSpec,
  medalFor,
  normaliseSpec,
  type TrackSpec,
} from '../track/spec';
import { MedalBar } from '../ui/medalbar';
import { RoomPanel } from '../ui/roompanel';
import { TrackEditor } from '../ui/trackeditor';
import { Workshop } from '../ui/workshop';
import { randomSeed, rngFromSeed } from '../core/rng';
import type { CarScore, GAParams } from '../ga/evolution';
import type { CarDef } from '../ga/genome';
import { randomCar3D, type Car3DDef } from '../ga/genome3d';
import { BrainView } from '../render/brainview';
import { Chart, type GenerationStats } from '../render/chart';
import { GenePool, type GenePoolCar } from '../render/genepool';
import { Minimap } from '../render/minimap';
import { Renderer } from '../render/renderer';
import { Ghost } from '../replay/ghost';
import { Ghost3D } from '../replay/ghost3d';
import { Simulation, createSnapshot, type WorldSnapshot } from '../sim/simulation';
import { Leaderboard } from '../ui/leaderboard';
import { Panel } from '../ui/panel';
import { HealthStrip, Readouts, countLiving } from '../ui/stats';
import {
  loadHallOfFame,
  loadSettings,
  saveHallOfFame,
  saveSettings,
  seedFromUrl,
  syncSeedToUrl,
  trackCodeFromUrl,
  type HallOfFameEntry,
} from '../ui/storage';
import type { Renderer3D } from '../render3d/renderer3d';
import type { Simulation3D, World3DSnapshot } from '../sim3d/simulation3d';
import { createSnapshot3D } from '../sim3d/snapshot3d';
import type { MinimapMarker } from '../render/minimap';
import type { StatsView } from '../ui/stats';
import { Loop } from './loop';

export type Mode = '2d' | '3d';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

/**
 * How long the 3D engine gets to come up before we give up on it.
 *
 * Generous, because it is compiling half a megabyte of WebAssembly and a slow
 * phone on a slow connection deserves the room. The point is not to be strict,
 * it is that a hang has to end in something rather than nothing: without this
 * a stalled instantiation leaves a dark canvas behind a "warming up" banner
 * for as long as you care to wait.
 */
const LOAD_3D_TIMEOUT_MS = 25_000;

/** The promise, or a rejection once the deadline passes. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export class App {
  private sim: Simulation;
  private loop: Loop;
  private renderer: Renderer;
  private minimap: Minimap;
  private chart: Chart;
  private brainView: BrainView;
  private genePool: GenePool;
  private healthStrip: HealthStrip;
  private leaderboard: Leaderboard;
  private readouts: Readouts;
  private panel: Panel;
  private ghost = new Ghost();
  /** The same idea in 3D, which is the mode this opens in. */
  private ghost3d = new Ghost3D();
  /** Whether the 3D ghost is drawn. It races whether or not you watch it. */
  private showGhost3d = true;
  private banner: HTMLElement;
  /** Why 3D last refused to start, if it did. */
  private failure3d: string | null = null;

  private trackEditor: TrackEditor;
  private roomPanel: RoomPanel;
  private medalBar: MedalBar;

  /** The design now being driven, as opposed to the one in the editor. */
  private spec: TrackSpec;

  /** The room, once someone has asked to join one. */
  private room: Room | null = null;
  /** Cars this tab has evaluated all session, which is its share of the work. */
  private evaluations = 0;
  /** What this tab calls itself in the room. */
  private roomName = 'you';

  private snapshot: WorldSnapshot = createSnapshot();
  /**
   * Records are kept per mode. The two modes are different problems with
   * different score scales, so sharing a leaderboard let a 2D run stand as the
   * 3D record, and the chart restarted every time you switched.
   */
  private records: Record<Mode, { history: GenerationStats[]; hall: HallOfFameEntry[]; best: number }> = {
    '2d': { history: [], hall: [], best: 0 },
    '3d': { history: [], hall: [], best: 0 },
  };

  /**
   * 3D is where this starts. Box3D has to compile its WebAssembly before a
   * world can exist, so the mode is set from the first frame while `boot()`
   * fetches the engine behind a banner. Until that resolves `sim3d` is null and
   * the 3D draw path simply does nothing.
   */
  private mode: Mode = '3d';
  private sim3d: Simulation3D | null = null;
  private renderer3d: Renderer3D | null = null;
  private snapshot3d: World3DSnapshot = createSnapshot3D();
  private loading3d = false;

  /** Colour cars by the family they descend from rather than by status. */
  private colourByLineage = false;

  /** -1 follows whoever is in front; otherwise the index of a chosen car. */
  private cameraTarget = -1;
  private replaying = false;
  private lastDrawTime = performance.now();

  constructor() {
    const stored = loadSettings();
    // A link may carry the whole design, or only a seed if it predates codes,
    // or neither.
    const shared = decodeSpec(trackCodeFromUrl() ?? '');
    this.spec = shared ?? defaultSpec(seedFromUrl() ?? randomSeed());
    const seed = this.spec.seed;

    this.sim = new Simulation({
      trackSeed: seed,
      params: {
        populationSize: clamp(
          stored.populationSize ?? DEFAULT_POPULATION_SIZE,
          MIN_POPULATION_SIZE,
          MAX_POPULATION_SIZE,
        ),
        mutationRate: clamp(stored.mutationRate ?? DEFAULT_MUTATION_RATE, 0, 1),
        mutationSize: clamp(stored.mutationSize ?? DEFAULT_MUTATION_SIZE, 0.01, 1),
        eliteCount: clamp(stored.eliteCount ?? DEFAULT_ELITE_COUNT, 0, MAX_ELITE_COUNT),
        diversityPressure: clamp(
          stored.diversityPressure ?? DEFAULT_DIVERSITY_PRESSURE,
          0,
          MAX_DIVERSITY_PRESSURE,
        ),
        immigrants: clamp(stored.immigrants ?? DEFAULT_IMMIGRANTS, 0, MAX_IMMIGRANTS),
        migrants: clamp(stored.migrants ?? DEFAULT_MIGRANTS, 0, MAX_MIGRANTS),
        ...(stored.goal ? { goal: stored.goal } : {}),
        ...(stored.selection ? { selection: stored.selection } : {}),
        ...(stored.crossoverMode ? { crossoverMode: stored.crossoverMode } : {}),
      },
    });

    // The constructor only takes a seed, so a shared design is applied here.
    // Cheap: nothing has been stepped yet.
    this.sim.setTrackSpec(this.spec);

    this.renderer = new Renderer(element<HTMLCanvasElement>('view'));
    this.minimap = new Minimap(element<HTMLCanvasElement>('minimap'));
    this.chart = new Chart(element<HTMLCanvasElement>('chart'));
    this.brainView = new BrainView(element<HTMLCanvasElement>('brain'));
    this.genePool = new GenePool(element<HTMLCanvasElement>('genepool'));
    this.healthStrip = new HealthStrip(element<HTMLCanvasElement>('health'));
    this.leaderboard = new Leaderboard(element('leaderboard'));
    this.readouts = new Readouts(document);
    this.banner = element('banner');

    this.renderer.camera.setZoom(stored.zoom ?? this.renderer.camera.fitZoom());
    for (const mode of ['2d', '3d'] as const) {
      const hall = loadHallOfFame(mode);
      this.records[mode].hall = hall;
      this.records[mode].best = hall[0]?.score ?? 0;
    }
    this.leaderboard.render(this.current.hall);
    this.chart.draw(this.current.history);

    this.panel = new Panel({
      onSpeed: (speed) => this.setSpeed(speed),
      onPauseToggle: () => this.setPaused(!this.loop.paused),
      onMutationRate: (rate) => this.setParam('mutationRate', rate),
      onMutationSize: (size) => this.setParam('mutationSize', size),
      onEliteCount: (count) => this.setParam('eliteCount', count),
      onPopulationSize: (size) => this.setParam('populationSize', size),
      onGoal: (goal) => this.setParam('goal', goal),
      onSelection: (method) => this.setParam('selection', method),
      onCrossover: (mode) => this.setParam('crossoverMode', mode),
      onDiversity: (pressure) => this.setParam('diversityPressure', pressure),
      onImmigrants: (count) => this.setParam('immigrants', count),
      onResetPopulation: () => this.resetPopulation(),
      onToggleReplay: () => this.toggleReplay(),
      onFollowLeader: () => this.setCameraTarget(-1),
      onShare: () => void this.share(),
      onClearHallOfFame: () => this.clearHallOfFame(),
    });

    this.panel.setValues(this.sim.params);
    this.readouts.set('seed', this.sim.trackSeed);
    syncSeedToUrl(this.sim.trackSeed, encodeSpec(this.spec));

    this.medalBar = new MedalBar(element('medals'));
    this.trackEditor = new TrackEditor(element('track-editor'), this.spec, {
      onBuild: (spec) => this.buildTrack(spec),
      onCopy: (code) => void this.copyCode(code),
    });
    this.trackEditor.onCodePasted = (code) => this.loadCode(code);

    new Workshop(element('workshop'), {
      onRace: (def) => this.raceHandBuilt(def),
      onCopyLeader: () => this.leaderSilhouette(),
    });

    this.roomPanel = new RoomPanel(element('room-panel'), suggestName(Math.random), {
      onJoin: (name) => void this.joinRoom(name),
      onLeave: () => void this.leaveRoom(),
      onMigrants: (count) => this.setParam('migrants', count),
    });
    this.roomPanel.setMigrants(this.sim.params.migrants);

    this.healthStrip.onSelect = (index) => this.setCameraTarget(index);
    this.leaderboard.onSelect = (entry) => this.exportCar(entry);

    this.sim.onCarDeath = (car) => {
      const recorder = this.sim.recorders[this.sim.cars.indexOf(car)];
      if (!recorder) return;
      // A finished run becomes the ghost if it beat everything before it.
      this.ghost.consider(recorder, car.def, car.score, this.sim.generation);
    };
    this.sim.onGenerationEnd = (scores, generation) => this.onGenerationEnd(scores, generation);

    this.loop = new Loop({
      step: () => this.step(),
      draw: () => this.draw(),
    });

    const storedSpeed = stored.speed;
    this.setSpeed(storedSpeed && SPEEDS.includes(storedSpeed) ? storedSpeed : 1);

    for (const button of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      const mode = button.dataset.mode === '3d' ? '3d' : '2d';
      button.addEventListener('click', () => void this.setMode(mode));
    }

    element('view-graveyard').addEventListener('click', () => this.renderer3d?.viewGraveyard());
    element<HTMLInputElement>('toggle-graveyard').addEventListener('change', (event) => {
      if (this.renderer3d) {
        this.renderer3d.showGraveyard = (event.target as HTMLInputElement).checked;
      }
    });
    element<HTMLInputElement>('toggle-trails').addEventListener('change', (event) => {
      if (this.renderer3d) {
        this.renderer3d.showTrails = (event.target as HTMLInputElement).checked;
      }
    });
    element<HTMLInputElement>('toggle-lineage').addEventListener('change', (event) => {
      this.colourByLineage = (event.target as HTMLInputElement).checked;
      if (this.renderer3d) this.renderer3d.colourByLineage = this.colourByLineage;
      this.renderer.colourByLineage = this.colourByLineage;
    });

    this.installInputHandlers();
    this.snapCameraToLeader();
    this.loop.start();
    void this.boot();
  }

  private installInputHandlers(): void {
    document.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (event.code === 'Space') {
        event.preventDefault();
        this.setPaused(!this.loop.paused);
        return;
      }
      const index = Number(event.key) - 1;
      if (index >= 0 && index < SPEEDS.length) this.setSpeed(SPEEDS[index]!);
    });

    // Scroll to zoom over the simulation view.
    const view = element<HTMLCanvasElement>('view');
    view.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.renderer.camera.setZoom(this.renderer.camera.zoom * factor);
        this.persist();
      },
      { passive: false },
    );

    // Returning to a hidden tab must not replay the time spent away.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.loop.resetClock();
    });
  }

  private step(): void {
    if (this.mode === '3d') {
      this.sim3d?.step();
      // One physics step of ghost, so it keeps pace at every speed setting
      // including max mode, where many steps happen per drawn frame.
      this.ghost3d.advance(1);
      return;
    }
    if (this.replaying) {
      this.ghost.advance();
      if (this.ghost.finished) this.ghost.rewind();
      return;
    }
    this.sim.step();
    // The ghost runs alongside the pack, restarting with each generation.
    this.ghost.advance();
  }

  private draw(): void {
    const now = performance.now();
    const dt = Math.min((now - this.lastDrawTime) / 1000, 0.25);
    this.lastDrawTime = now;

    if (this.mode === '3d') {
      this.draw3d(dt);
      return;
    }

    this.sim.snapshot(this.snapshot);
    const ghostFrame = this.ghost.current();

    if (this.replaying && ghostFrame) {
      this.renderer.camera.follow(ghostFrame.chassis.x, ghostFrame.chassis.y, dt);
      this.renderer.draw(this.sim.track, null, ghostFrame);
    } else {
      const target = this.followTarget();
      if (target) this.renderer.camera.follow(target.x, target.y, dt);
      this.renderer.draw(this.sim.track, this.snapshot, ghostFrame);
    }

    this.minimap.draw(
      this.sim.track,
      this.replaying ? null : this.markersFrom2D(),
      this.renderer.camera.x,
      this.snapshot.bestX,
    );
    this.healthStrip.draw(this.snapshot);
    this.updateReadouts(this.snapshot);

    const index = this.watchedIndex(this.snapshot.leaderIndex);
    const watched = this.snapshot.cars[index];
    this.setWatchedLabel(index);
    this.brainView.draw(
      watched
        ? {
            brain: watched.def?.brain ?? null,
            activations: watched.activations,
            memory: watched.memory,
            alive: watched.alive,
          }
        : null,
    );
    this.genePool.draw(
      this.snapshot.cars.map(
        (car): GenePoolCar => ({
          brain: car.def?.brain ?? null,
          alive: car.alive,
          isElite: car.isElite,
        }),
      ),
    );
  }

  /**
   * Which car the driver panel is showing: whichever one the camera follows, so
   * the network on screen belongs to the car you are watching.
   */
  private watchedIndex(leaderIndex: number): number {
    return this.cameraTarget >= 0 ? this.cameraTarget : leaderIndex;
  }

  /** Name of the car in the driver panel, so it is clear whose network it is. */
  private setWatchedLabel(index: number): void {
    this.readouts.set(
      'brain-target',
      index < 0 ? 'no car' : this.cameraTarget >= 0 ? `car ${index}` : `car ${index}, leader`,
    );
  }

  private draw3d(dt: number): void {
    const sim = this.sim3d;
    const renderer = this.renderer3d;
    if (!sim || !renderer) return;

    sim.snapshot(this.snapshot3d);
    renderer.draw(sim.track, this.snapshot3d, dt);
    renderer.drawGhost(this.showGhost3d ? this.ghost3d.current() : null);
    this.minimap.draw(
      sim.track.profile,
      this.markersFrom3D(),
      this.snapshot3d.leader.x,
      this.snapshot3d.bestX,
    );
    this.healthStrip.draw(this.snapshot3d);
    this.updateReadouts(this.snapshot3d);
    this.readouts.set('deaths', String(renderer.graveyard.count));

    const index = this.watchedIndex(this.snapshot3d.leaderIndex);
    const watched = this.snapshot3d.cars[index];
    this.setWatchedLabel(index);
    this.brainView.draw(
      watched
        ? {
            // A 3D car keeps its driver on the silhouette it was extruded from.
            brain: watched.def?.base.brain ?? null,
            activations: watched.activations,
            memory: watched.memory,
            alive: watched.alive,
          }
        : null,
    );
    this.genePool.draw(
      this.snapshot3d.cars.map(
        (car): GenePoolCar => ({
          brain: car.def?.base.brain ?? null,
          alive: car.alive,
          isElite: car.isElite,
        }),
      ),
    );
  }

  private markersFrom2D(): MinimapMarker[] {
    return this.snapshot.cars.map((car, i) => ({
      x: car.chassis.x,
      alive: car.alive,
      isElite: car.isElite,
      isLeader: i === this.snapshot.leaderIndex,
    }));
  }

  private markersFrom3D(): MinimapMarker[] {
    return this.snapshot3d.cars.map((car, i) => ({
      x: car.chassis.position.x,
      alive: car.alive,
      isElite: car.isElite,
      isLeader: i === this.snapshot3d.leaderIndex,
    }));
  }

  private followTarget(): { x: number; y: number } | null {
    const snapshot = this.snapshot;
    if (this.cameraTarget >= 0) {
      const car = snapshot.cars[this.cameraTarget];
      if (car?.alive) return { x: car.chassis.x, y: car.chassis.y };
      // Fall back to the leader once the chosen car is gone.
      this.setCameraTarget(-1);
    }
    if (snapshot.leaderIndex < 0) return null;
    return { x: snapshot.leaderX, y: snapshot.leaderY };
  }

  private updateReadouts(snapshot: StatsView): void {
    this.readouts.set('generation', String(snapshot.generation));
    this.readouts.set('alive', `${snapshot.aliveCount}/${snapshot.cars.length}`);
    this.readouts.set('distance', `${snapshot.bestX.toFixed(1)}m`);
    // In the flat mode the ghost holds the best run on this track, including
    // one still in progress, so the headline moves the moment a record is set.
    // The 3D mode has no ghost, so it reports its own recorded best.
    const live = this.mode === '2d' ? this.ghost.score : -Infinity;
    this.readouts.set('best', Math.max(this.current.best, live, 0).toFixed(1));
    this.readouts.set('sps', String(this.loop.stepsPerSecond));
    this.readouts.set('lineages', String(countLiving(snapshot)));
    // The bar rewards the cars on screen right now, so it moves as they drive
    // rather than jumping once a generation.
    this.medalBar.update(snapshot.bestX, this.trackLength);

    if (this.replaying) {
      const seconds = (this.ghost.position / PHYSICS_HZ).toFixed(1);
      const total = (this.ghost.frameCount / PHYSICS_HZ).toFixed(1);
      this.showBanner(
        `Replaying the best run · scored ${this.ghost.score.toFixed(1)} in generation ${this.ghost.generation} · ${seconds}s / ${total}s`,
      );
    } else {
      this.hideBanner();
    }
  }

  private onGenerationEnd(
    scores: CarScore<CarDef | Car3DDef>[],
    generation: number,
  ): void {
    if (scores.length === 0) return;
    const sorted = scores.slice().sort((a, b) => b.score - a.score);
    const half = Math.max(1, Math.ceil(sorted.length / 2));

    this.current.history.push({
      generation,
      best: sorted[0]!.score,
      eliteAverage: sorted.slice(0, half).reduce((a, s) => a + s.score, 0) / half,
      average: sorted.reduce((a, s) => a + s.score, 0) / sorted.length,
    });
    this.chart.draw(this.current.history);

    // One entry per generation, so the board tracks progress rather than
    // filling up with every incremental record inside a single round.
    this.recordHallOfFame(sorted[0]!, generation);

    // Trails belong to a generation; the graveyard deliberately does not.
    this.renderer3d?.resetTrails();

    // A whole new set of weights, so the throttled heatmap should not wait.
    this.genePool.invalidate();

    // Each generation races the ghost from the start line again.
    this.ghost.rewind();
    this.ghost3d.rewind();
    this.syncGhostButton();

    this.evaluations += scores.length;
    this.medalBar.update(sorted[0]!.distance, this.trackLength);
    this.shareWithRoom(sorted[0]!, generation);
  }

  /**
   * Tell the room how the generation went, and offer its winner.
   *
   * Once per generation rather than continuously: a champion is only worth
   * sending when it has finished being evaluated, and a leaderboard that
   * updates twenty times a second is harder to read than one that updates
   * when something happens.
   */
  private shareWithRoom(best: CarScore<CarDef | Car3DDef>, generation: number): void {
    const room = this.room;
    if (!room) return;
    room.report(generation, best.distance, this.evaluations);
    room.offerChampion(
      'base' in best.def ? packCar3D(best.def) : packCar(best.def),
      best.distance,
      generation,
    );
    this.renderRoom();
  }

  private recordHallOfFame(best: CarScore<CarDef | Car3DDef>, generation: number): void {
    // A 3D car carries its silhouette inside `base`; the board and its
    // thumbnails only ever deal in silhouettes.
    const def = 'base' in best.def ? best.def.base : best.def;
    const record = this.current;
    record.hall.push({
      def: structuredClone(def),
      score: best.score,
      distance: best.distance,
      generation,
      trackSeed: this.sim.trackSeed,
      recordedAt: Date.now(),
    });
    record.hall.sort((a, b) => b.score - a.score);
    record.hall = record.hall.slice(0, TOP_SCORE_COUNT);
    record.best = Math.max(record.best, best.score);
    this.leaderboard.render(record.hall);
    saveHallOfFame(this.mode, record.hall);
  }

  private clearHallOfFame(): void {
    this.current.hall = [];
    this.current.best = 0;
    this.leaderboard.render(this.current.hall);
    saveHallOfFame(this.mode, this.current.hall);
  }

  /** Records belonging to whichever mode is on screen. */
  private get current() {
    return this.records[this.mode];
  }

  private exportCar(entry: HallOfFameEntry): void {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `boxcar3d-${entry.score.toFixed(0)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private async share(): Promise<void> {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      this.flashBanner('Link copied.');
    } catch {
      this.flashBanner(url);
    }
  }

  /** Generation settings apply to both worlds, so the modes stay comparable. */
  private setParam<K extends keyof GAParams>(key: K, value: GAParams[K]): void {
    this.sim.params[key] = value;
    if (this.sim3d) this.sim3d.params[key] = value;
    this.persist();
  }

  private setSpeed(speed: Speed): void {
    this.loop.speed = speed;
    if (this.loop.paused) this.setPaused(false);
    this.panel.setSpeed(speed);
    this.persist();
  }

  private setPaused(paused: boolean): void {
    this.loop.paused = paused;
    if (!paused) this.loop.resetClock();
    this.panel.setPaused(paused);
  }

  private setCameraTarget(index: number): void {
    this.cameraTarget = index;
    this.healthStrip.selected = index;
    // In 3D this also re-engages the chase camera after free orbiting.
    if (this.renderer3d && index < 0) this.renderer3d.followLeader = true;
  }

  /**
   * The ghost button, which means different things in the two modes.
   *
   * The flat mode replays the best run on its own, with the pack hidden. In 3D
   * the ghost is already out there racing the living cars every generation,
   * which is the thing worth watching, so the button turns it on and off
   * instead of taking over the view.
   */
  private toggleReplay(): void {
    if (this.mode === '3d') {
      if (!this.ghost3d.available) {
        this.flashBanner('No finished run yet. The ghost appears after the first generation.');
        return;
      }
      this.showGhost3d = !this.showGhost3d;
      this.panel.setReplaying(this.showGhost3d, '3d');
      this.flashBanner(
        this.showGhost3d
          ? `Racing ${this.ghost3d.who || 'the best run so far'}: ${this.ghost3d.score.toFixed(1)}m.`
          : 'Ghost hidden.',
      );
      return;
    }

    if (!this.replaying && !this.ghost.available) {
      this.flashBanner('No finished run to replay yet.');
      return;
    }
    this.replaying = !this.replaying;
    this.ghost.rewind();
    this.panel.setReplaying(this.replaying);
    if (!this.replaying) this.snapCameraToLeader();
  }

  private resetPopulation(): void {
    if (this.mode === '3d') {
      this.sim3d?.resetPopulation();
      // A new population is a fresh search, so the record of the old one goes.
      this.renderer3d?.clearHistory();
    } else this.sim.resetPopulation();

    // Only this mode's chart restarts; the other mode's run is untouched.
    this.current.history = [];
    this.chart.draw(this.current.history);
    this.ghost.clear();
    this.minimap.exploredX = 0;
    this.replaying = false;
    this.panel.setReplaying(false);
    this.setCameraTarget(-1);
    if (this.mode === '2d') this.snapCameraToLeader();
  }

  /**
   * Build a designed track and start the run over.
   *
   * The track is the experiment, so changing it invalidates everything
   * measured against the old one: both modes' charts, the ghost, the death
   * map. Keeping any of it would be comparing runs on different courses.
   */
  private buildTrack(spec: TrackSpec): void {
    this.spec = normaliseSpec(spec);
    this.sim.setTrackSpec(this.spec);
    // Both worlds follow the same design, so switching mode shows the same
    // course rather than a different one that happens to share a seed.
    this.sim3d?.setTrackSpec(this.spec);
    this.renderer3d?.clearHistory();
    this.records['2d'].history = [];
    this.records['3d'].history = [];
    this.chart.draw(this.current.history);
    this.ghost.clear();
    this.ghost3d.clear();
    this.renderer3d?.clearGhost();
    this.minimap.exploredX = 0;
    this.replaying = false;
    this.panel.setReplaying(false);
    this.trackEditor.setSpec(this.spec);
    this.medalBar.reset();
    this.readouts.set('seed', this.spec.seed);
    syncSeedToUrl(this.spec.seed, encodeSpec(this.spec));
    this.setCameraTarget(-1);
    if (this.mode === '2d') this.snapCameraToLeader();

    // A room is a room *for a track*. Changing course means leaving the people
    // driving the old one, which is better than silently comparing scores
    // across different terrain.
    if (this.room && this.room.code !== encodeSpec(this.spec)) {
      void this.leaveRoom();
      this.flashBanner('New track, so you have left the old room.');
    }
  }

  /** Load a pasted code, if it is one. */
  private loadCode(code: string): void {
    const spec = decodeSpec(code);
    if (!spec) {
      this.flashBanner('That does not look like a track code.');
      return;
    }
    this.buildTrack(spec);
    this.flashBanner('Loaded a shared track.');
  }

  private async copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.flashBanner('Track code copied.');
    } catch {
      // Clipboard access needs a permission the page may not have. The code is
      // in a text field either way, so this is a nudge rather than a failure.
      this.flashBanner('Could not copy. The code is in the box, select it.');
    }
  }

  /**
   * Put a hand-built car into whichever world is on screen.
   *
   * The 3D mode needs the two genes a silhouette has no opinion about, so they
   * are taken from a random 3D car rather than invented: a body someone drew
   * flat says nothing about how wide it should be.
   */
  private raceHandBuilt(def: CarDef): void {
    if (this.mode === '3d' && this.sim3d) {
      const shape = randomCar3D(rngFromSeed(String(Math.random())));
      this.sim3d.enqueue({ ...shape, base: def });
    } else {
      this.sim.enqueue(def);
    }
    this.flashBanner('Your car is in. It starts with the next generation.');
  }

  /** The silhouette of whatever is currently in front, for copying. */
  private leaderSilhouette(): CarDef | null {
    if (this.mode === '3d') {
      const car = this.snapshot3d.cars[this.snapshot3d.leaderIndex];
      return car?.def ? structuredClone(car.def.base) : null;
    }
    const car = this.snapshot.cars[this.snapshot.leaderIndex];
    return car?.def ? structuredClone(car.def) : null;
  }

  /** How long the current course is, which is what medals measure against. */
  private get trackLength(): number {
    return this.mode === '3d' && this.sim3d
      ? this.sim3d.track.profile.length
      : this.sim.track.length;
  }

  /* ── The room ────────────────────────────────────────────────────────── */

  /**
   * Join the room for this track.
   *
   * Only ever from a button. This announces the tab to strangers over public
   * relays, so it is not something to do on someone's behalf.
   */
  private async joinRoom(name: string): Promise<void> {
    if (this.room) return;
    this.roomPanel.setStatus('connecting');
    const code = encodeSpec(this.spec);
    try {
      this.roomName = name;
      this.room = await Room.join(
        code,
        { name, mode: this.mode },
        this.trackLength,
        {
          onChange: () => this.renderRoom(),
          onChampion: (peer) => this.onChampionArrived(peer),
          onGhost: (peer, ghost) => this.onGhostArrived(peer, ghost),
          onTrouble: (reason) => this.roomPanel.setTrouble(reason),
        },
      );
      this.roomPanel.setStatus('online');
      this.renderRoom();
      this.attachMigrantSource();
      this.room.setGhostSource(() => this.ghostOffer());
      // Whatever this tab has already driven is worth sending: the room may
      // have been joined ten generations in.
      this.room.sendGhost();
    } catch (error) {
      this.room = null;
      this.roomPanel.setStatus(
        'failed',
        error instanceof Error ? error.message : 'Could not reach the room.',
      );
    }
  }

  private async leaveRoom(): Promise<void> {
    const room = this.room;
    this.room = null;
    this.sim.migrantSource = null;
    if (this.sim3d) this.sim3d.migrantSource = null;
    this.roomPanel.setStatus('offline');
    await room?.leave();
  }

  /**
   * Point both simulations at the room for their migrants.
   *
   * Each mode unpacks with its own validator, so a 3D car can never end up in
   * the flat world or the other way round, and anything malformed is dropped
   * rather than fixed.
   */
  private attachMigrantSource(): void {
    this.sim.migrantSource = () => {
      const offer = this.room?.takeMigrant('2d', Math.random);
      return offer ? unpackCar(offer.car) : null;
    };
    if (this.sim3d) {
      this.sim3d.migrantSource = () => {
        const offer = this.room?.takeMigrant('3d', Math.random);
        return offer ? unpackCar3D(offer.car) : null;
      };
    }
  }

  private onChampionArrived(peer: Peer): void {
    if (this.sim.params.migrants <= 0) return;
    this.flashBanner(`A car arrived from ${peer.name}.`);
  }

  /**
   * This tab's ghost, packed for anyone who asks.
   *
   * Trimmed to the wire limit rather than refused for being long, because a
   * ghost that stops a little early still shows you the line, and a peer who
   * gets nothing learns nothing.
   */
  private ghostOffer(): GhostMessage | null {
    const replay = this.ghost3d.share();
    if (!replay) return null;
    const count = Math.min(replay.frameCount, GHOST_MAX_WIRE_FRAMES);
    if (count === 0) return null;
    return {
      meta: {
        car: packCar3D(replay.def),
        score: replay.score,
        generation: replay.generation,
        count,
        mode: '3d',
      },
      frames: replay.frames,
    };
  }

  /**
   * Someone else's lap, arriving to be raced.
   *
   * Held to exactly the same bar as our own: it replaces the ghost only if it
   * went further. Otherwise the fastest car on the track would be whoever
   * happened to send last.
   */
  private onGhostArrived(peer: Peer, ghost: GhostMessage): void {
    if (ghost.meta.mode !== '3d') return;
    const def = unpackCar3D(ghost.meta.car);
    if (!def) return;
    const adopted = this.ghost3d.adopt({
      def,
      frames: ghost.frames,
      frameCount: ghost.meta.count,
      score: ghost.meta.score,
      generation: ghost.meta.generation,
      who: peer.name,
    });
    if (!adopted) return;
    this.syncGhostButton();
    if (this.mode !== '3d') return;
    this.flashBanner(`${peer.name} set a faster lap: ${ghost.meta.score.toFixed(1)}m. Racing it.`);
  }

  private renderRoom(): void {
    if (!this.room) return;
    const best = Math.max(this.current.best, this.liveBest());
    this.roomPanel.render(
      this.room.peers(),
      {
        name: this.roomName,
        best,
        generation: this.generationNow(),
        medal: medalFor(best, this.trackLength),
      },
      this.room.totalEvaluations(this.evaluations),
    );
  }

  /** Furthest anything has reached this generation, in the mode on screen. */
  private liveBest(): number {
    return this.mode === '3d' ? this.snapshot3d.bestX : this.snapshot.bestX;
  }

  private generationNow(): number {
    return this.mode === '3d' ? (this.sim3d?.generation ?? 0) : this.sim.generation;
  }

  /**
   * Bring up the 3D world, fetching Box3D and three.js the first time.
   * Returns false if this browser cannot run it.
   */
  private async ensure3D(): Promise<boolean> {
    if (this.sim3d) return true;
    if (this.loading3d) return false;

    // Ask before fetching. On a device with no WebGL the failure would
    // otherwise happen inside three.js, after half a megabyte of it had
    // already come down the wire.
    if (!hasWebGL()) return false;

    this.loading3d = true;
    this.showBanner('Warming up the 3D physics engine.');
    try {
      // Box3D and three.js are only fetched for 3D, so the flat mode does not
      // have to carry them.
      const [{ Simulation3D }, { Renderer3D }] = await withTimeout(
        Promise.all([import('../sim3d/simulation3d'), import('../render3d/renderer3d')]),
        LOAD_3D_TIMEOUT_MS,
        'Loading the 3D engine timed out.',
      );
      this.sim3d = await withTimeout(
        Simulation3D.create({
          trackSeed: this.sim.trackSeed,
          params: { ...this.sim.params },
        }),
        LOAD_3D_TIMEOUT_MS,
        'Starting the 3D physics world timed out.',
      );
      this.renderer3d = new Renderer3D(element<HTMLCanvasElement>('view3d'));
      this.renderer3d.onContextChange = (lost) => {
        // A lost context is a frozen picture, not a stopped simulation, so say
        // what happened rather than letting it look like a hang.
        if (lost) this.showBanner('The browser dropped the 3D view. Waiting for it to come back.');
        else this.flashBanner('3D view is back.');
      };
      this.sim3d.onCarDeath = (car) => {
        const recorder = this.sim3d?.recorders[this.sim3d.cars.indexOf(car)];
        // A finished run becomes the ghost if it beat everything before it,
        // and a new best is worth telling the room about.
        if (
          recorder &&
          this.ghost3d.consider(recorder, car.def, car.score, this.sim3d!.generation)
        ) {
          this.syncGhostButton();
          this.room?.sendGhost();
        }
        if (!car.deathPosition) return;
        this.renderer3d?.addDeath({
          // Along the course and across the road as it actually died, but
          // pinned to the road height so the field reads as a death map.
          x: car.deathPosition.x,
          y: car.deathRoadY,
          z: car.deathPosition.z,
          generation: this.sim3d!.generation,
          fellOff: car.fellOff,
        });
      };
      this.sim3d.onGenerationEnd = (scores, generation) =>
        this.onGenerationEnd(scores, generation);
      // The 3D world may be built long after a room was joined, so it wires
      // itself up rather than waiting to be told.
      if (this.room) this.attachMigrantSource();
      return true;
    } catch (error) {
      console.error(error);
      // Kept so the fallback can say what actually happened rather than the
      // generic "3D will not start", which tells nobody anything.
      this.failure3d = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.loading3d = false;
      this.hideBanner();
    }
  }

  /**
   * Open in 3D, which is what this rebuild is for.
   *
   * The engine is WebAssembly and takes a moment to compile, so the canvas sits
   * dark behind a banner until it is ready rather than showing the flat mode
   * for a second and yanking it away. If it cannot start at all, the flat mode
   * is a genuine fallback rather than an error page.
   */
  private async boot(): Promise<void> {
    if (await this.ensure3D()) {
      await this.enter3D();
      return;
    }
    await this.setMode('2d');
    this.flashBanner(
      this.failure3d
        ? `3D did not start, so here is the flat mode. ${this.failure3d}`
        : '3D will not start in this browser, so here is the flat mode.',
    );
  }

  /**
   * Switch between the flat and 3D simulations. They are independent worlds
   * that share the interface, the track seed and the generation controls.
   */
  private async setMode(mode: Mode): Promise<void> {
    if (mode === this.mode || this.loading3d) return;

    if (mode === '3d') {
      if (!(await this.ensure3D())) {
        this.flashBanner(
          this.failure3d
            ? `Could not start 3D mode. ${this.failure3d}`
            : 'Could not start 3D mode in this browser.',
        );
        return;
      }
      await this.enter3D();
      return;
    }

    this.markModeButtons('2d');
    element<HTMLCanvasElement>('view3d').hidden = true;
    element<HTMLCanvasElement>('view').hidden = false;
    element('view3d-controls').hidden = true;
    element('view2d-note').hidden = false;
    this.mode = '2d';
    this.onModeChanged();
    this.showRecords();
    this.minimap.exploredX = 0;
    this.renderer.camera.resize();
    this.snapCameraToLeader();
    this.loop.resetClock();
  }

  private markModeButtons(mode: Mode): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('#modes button')) {
      button.setAttribute('aria-pressed', button.dataset.mode === mode ? 'true' : 'false');
    }
  }

  private async enter3D(): Promise<void> {
    if (!this.sim3d) return;
    this.markModeButtons('3d');

    // Keep both worlds on the same course and settings. Comparing the whole
    // design rather than the seed: two tracks can share a seed and differ in
    // every other way now.
    if (encodeSpec(this.sim3d.track.spec) !== encodeSpec(this.spec)) {
      this.sim3d.setTrackSpec(this.spec);
    }
    Object.assign(this.sim3d.params, this.sim.params);

    element<HTMLCanvasElement>('view').hidden = true;
    element<HTMLCanvasElement>('view3d').hidden = false;
    element('view3d-controls').hidden = false;
    element('view2d-note').hidden = true;
    this.mode = '3d';
    this.onModeChanged();
    this.showRecords();
    this.minimap.exploredX = 0;
    this.sim3d.snapshot(this.snapshot3d);
    this.renderer3d?.snapTo(
      this.snapshot3d.leader.x,
      this.snapshot3d.leader.y,
      this.snapshot3d.leader.z,
    );
    this.loop.resetClock();
  }

  /**
   * Settle everything that depends on which mode is on screen.
   *
   * Scores only compare within a mode and the two courses are different
   * lengths, so the medal bar restarts and the room is told which one this tab
   * is now running.
   */
  private onModeChanged(): void {
    this.syncGhostButton();
    this.trackEditor.setMode(this.mode);
    this.medalBar.reset();
    this.room?.setSelf({ name: this.roomName, mode: this.mode });
    this.room?.setTrackLength(this.trackLength);
    this.renderRoom();
  }

  /**
   * Label the ghost button for what is actually on screen.
   *
   * "Hide the ghost" while there is no ghost to hide is a lie the button told
   * from the first frame, since showing one is the default and nothing has
   * finished a run yet.
   */
  private syncGhostButton(): void {
    if (this.mode === '3d') {
      this.panel.setReplaying(this.showGhost3d && this.ghost3d.available, '3d');
    } else {
      this.panel.setReplaying(this.replaying, '2d');
    }
  }

  /** Show the chart and leaderboard belonging to the mode now on screen. */
  private showRecords(): void {
    this.chart.draw(this.current.history);
    this.leaderboard.render(this.current.hall);
  }

  private snapCameraToLeader(): void {
    this.sim.snapshot(this.snapshot);
    if (this.snapshot.leaderIndex >= 0) {
      this.renderer.camera.snapTo(this.snapshot.leaderX, this.snapshot.leaderY);
    }
  }

  private bannerTimer: number | null = null;

  private showBanner(text: string): void {
    if (this.bannerTimer !== null) return;
    this.banner.textContent = text;
    this.banner.hidden = false;
  }

  private hideBanner(): void {
    if (this.bannerTimer !== null) return;
    this.banner.hidden = true;
  }

  private flashBanner(text: string): void {
    if (this.bannerTimer !== null) clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.hidden = false;
    this.bannerTimer = window.setTimeout(() => {
      this.bannerTimer = null;
      this.banner.hidden = true;
    }, 2200);
  }

  private persist(): void {
    saveSettings({
      ...this.sim.params,
      speed: this.loop.speed,
      zoom: this.renderer.camera.zoom,
    });
  }

  /** Handle exposed for end-to-end tests. */
  debug() {
    const ready = this.mode === '2d' || this.sim3d !== null;
    const active = this.mode === '3d' && this.sim3d ? this.sim3d : this.sim;
    return {
      mode: this.mode,
      /** False while the 3D engine is still compiling on first load. */
      ready,
      generation: active.generation,
      frame: active.frame,
      alive: active.aliveCount,
      bestX: active.bestX,
      stepsPerSecond: this.loop.stepsPerSecond,
      paused: this.loop.paused,
      speed: this.loop.speed,
      seed: this.sim.trackSeed,
      replaying: this.replaying,
      hallOfFame: this.current.hall.length,
      timeStep: TIME_STEP,
      // Cheap fingerprint of the terrain, so tests can assert that a seed
      // rebuilds the same course without comparing rendered pixels.
      trackSignature: this.sim.track.surface
        .reduce((acc, p) => (acc * 31 + p.x * 1000 + p.y * 7919) % 1_000_000_007, 7),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
