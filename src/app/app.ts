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
  MAX_ELITE_COUNT,
  MAX_POPULATION_SIZE,
  MIN_POPULATION_SIZE,
  PHYSICS_HZ,
  SPEEDS,
  TIME_STEP,
  TOP_SCORE_COUNT,
  type Speed,
} from '../config';
import { randomSeed } from '../core/rng';
import type { CarScore } from '../ga/evolution';
import { Chart, type GenerationStats } from '../render/chart';
import { Minimap } from '../render/minimap';
import { Renderer } from '../render/renderer';
import { Ghost } from '../replay/ghost';
import { Simulation, createSnapshot, type WorldSnapshot } from '../sim/simulation';
import { Leaderboard } from '../ui/leaderboard';
import { Panel } from '../ui/panel';
import { HealthStrip, Readouts } from '../ui/stats';
import {
  loadHallOfFame,
  loadSettings,
  saveHallOfFame,
  saveSettings,
  seedFromUrl,
  syncSeedToUrl,
  type HallOfFameEntry,
} from '../ui/storage';
import { Loop } from './loop';

function element<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export class App {
  private sim: Simulation;
  private loop: Loop;
  private renderer: Renderer;
  private minimap: Minimap;
  private chart: Chart;
  private healthStrip: HealthStrip;
  private leaderboard: Leaderboard;
  private readouts: Readouts;
  private panel: Panel;
  private ghost = new Ghost();
  private banner: HTMLElement;

  private snapshot: WorldSnapshot = createSnapshot();
  private history: GenerationStats[] = [];
  private hallOfFame: HallOfFameEntry[] = [];

  /** -1 follows whoever is in front; otherwise the index of a chosen car. */
  private cameraTarget = -1;
  private replaying = false;
  private lastDrawTime = performance.now();
  private bestEver = 0;

  constructor() {
    const stored = loadSettings();
    const seed = seedFromUrl() ?? randomSeed();

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
      },
    });

    this.renderer = new Renderer(element<HTMLCanvasElement>('view'));
    this.minimap = new Minimap(element<HTMLCanvasElement>('minimap'));
    this.chart = new Chart(element<HTMLCanvasElement>('chart'));
    this.healthStrip = new HealthStrip(element<HTMLCanvasElement>('health'));
    this.leaderboard = new Leaderboard(element('leaderboard'));
    this.readouts = new Readouts(document);
    this.banner = element('banner');

    this.renderer.camera.setZoom(stored.zoom ?? this.renderer.camera.fitZoom());
    this.hallOfFame = loadHallOfFame();
    this.bestEver = this.hallOfFame[0]?.score ?? 0;
    this.leaderboard.render(this.hallOfFame);
    this.chart.draw(this.history);

    this.panel = new Panel({
      onSpeed: (speed) => this.setSpeed(speed),
      onPauseToggle: () => this.setPaused(!this.loop.paused),
      onMutationRate: (rate) => {
        this.sim.params.mutationRate = rate;
        this.persist();
      },
      onMutationSize: (size) => {
        this.sim.params.mutationSize = size;
        this.persist();
      },
      onEliteCount: (count) => {
        this.sim.params.eliteCount = count;
        this.persist();
      },
      onPopulationSize: (size) => {
        this.sim.params.populationSize = size;
        this.persist();
      },
      onRebuildTrack: (nextSeed) => this.rebuildTrack(nextSeed),
      onRandomSeed: () => this.panel.setSeed(randomSeed()),
      onResetPopulation: () => this.resetPopulation(),
      onToggleReplay: () => this.toggleReplay(),
      onFollowLeader: () => this.setCameraTarget(-1),
      onShare: () => void this.share(),
      onClearHallOfFame: () => this.clearHallOfFame(),
    });

    this.panel.setValues(this.sim.params);
    this.panel.setSeed(this.sim.trackSeed);
    this.readouts.set('seed', this.sim.trackSeed);
    syncSeedToUrl(this.sim.trackSeed);

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

    this.installInputHandlers();
    this.snapCameraToLeader();
    this.loop.start();
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

    this.minimap.draw(this.sim.track, this.replaying ? null : this.snapshot, this.renderer.camera.x);
    this.healthStrip.draw(this.snapshot);
    this.updateReadouts();
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

  private updateReadouts(): void {
    const snapshot = this.snapshot;
    this.readouts.set('generation', String(snapshot.generation));
    this.readouts.set('alive', `${snapshot.aliveCount}/${snapshot.cars.length}`);
    this.readouts.set('distance', `${snapshot.bestX.toFixed(1)}m`);
    // The ghost holds the best run on this track, including the one in progress,
    // so the headline number moves as soon as a record is set.
    this.readouts.set('best', Math.max(this.bestEver, this.ghost.score, 0).toFixed(1));
    this.readouts.set('sps', String(this.loop.stepsPerSecond));

    if (this.replaying) {
      const seconds = (this.ghost.position / PHYSICS_HZ).toFixed(1);
      const total = (this.ghost.frameCount / PHYSICS_HZ).toFixed(1);
      this.showBanner(
        `Replaying the best run — scored ${this.ghost.score.toFixed(1)} in generation ${this.ghost.generation} · ${seconds}s / ${total}s`,
      );
    } else {
      this.hideBanner();
    }
  }

  private onGenerationEnd(scores: CarScore[], generation: number): void {
    if (scores.length === 0) return;
    const sorted = scores.slice().sort((a, b) => b.score - a.score);
    const half = Math.max(1, Math.ceil(sorted.length / 2));

    this.history.push({
      generation,
      best: sorted[0]!.score,
      eliteAverage: sorted.slice(0, half).reduce((a, s) => a + s.score, 0) / half,
      average: sorted.reduce((a, s) => a + s.score, 0) / sorted.length,
    });
    this.chart.draw(this.history);

    // One entry per generation, so the board tracks progress rather than
    // filling up with every incremental record inside a single round.
    this.recordHallOfFame(sorted[0]!, generation);

    // Each generation races the ghost from the start line again.
    this.ghost.rewind();
  }

  private recordHallOfFame(best: CarScore, generation: number): void {
    this.hallOfFame.push({
      def: structuredClone(best.def),
      score: best.score,
      distance: best.distance,
      generation,
      trackSeed: this.sim.trackSeed,
      recordedAt: Date.now(),
    });
    this.hallOfFame.sort((a, b) => b.score - a.score);
    this.hallOfFame = this.hallOfFame.slice(0, TOP_SCORE_COUNT);
    this.bestEver = Math.max(this.bestEver, best.score);
    this.leaderboard.render(this.hallOfFame);
    saveHallOfFame(this.hallOfFame);
  }

  private clearHallOfFame(): void {
    this.hallOfFame = [];
    this.bestEver = 0;
    this.leaderboard.render(this.hallOfFame);
    saveHallOfFame(this.hallOfFame);
  }

  private exportCar(entry: HallOfFameEntry): void {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `genetic-car-${entry.score.toFixed(0)}.json`;
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
  }

  private toggleReplay(): void {
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
    this.sim.resetPopulation();
    this.history = [];
    this.chart.draw(this.history);
    this.ghost.clear();
    this.minimap.exploredX = 0;
    this.replaying = false;
    this.panel.setReplaying(false);
    this.setCameraTarget(-1);
    this.snapCameraToLeader();
  }

  private rebuildTrack(seed: string): void {
    this.sim.setTrack(seed);
    this.history = [];
    this.chart.draw(this.history);
    this.ghost.clear();
    this.minimap.exploredX = 0;
    this.replaying = false;
    this.panel.setReplaying(false);
    this.panel.setSeed(seed);
    this.readouts.set('seed', seed);
    syncSeedToUrl(seed);
    this.setCameraTarget(-1);
    this.snapCameraToLeader();
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
    return {
      generation: this.sim.generation,
      frame: this.sim.frame,
      alive: this.sim.aliveCount,
      bestX: this.sim.bestX,
      stepsPerSecond: this.loop.stepsPerSecond,
      paused: this.loop.paused,
      speed: this.loop.speed,
      seed: this.sim.trackSeed,
      replaying: this.replaying,
      hallOfFame: this.hallOfFame.length,
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
