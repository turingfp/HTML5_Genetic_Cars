/**
 * Control wiring.
 *
 * The original attached inline `onclick` attributes to global functions. Here
 * the panel owns its elements and reports intent through callbacks, so the app
 * never has to reach into the DOM.
 */

import { SPEEDS, type Speed } from '../config';
import type { CrossoverMode, FitnessGoal, SelectionMethod } from '../ga/evolution';

export interface PanelCallbacks {
  onSpeed: (speed: Speed) => void;
  onPauseToggle: () => void;
  onMutationRate: (rate: number) => void;
  onMutationSize: (size: number) => void;
  onEliteCount: (count: number) => void;
  onPopulationSize: (size: number) => void;
  onGoal: (goal: FitnessGoal) => void;
  onSelection: (method: SelectionMethod) => void;
  onCrossover: (mode: CrossoverMode) => void;
  onDiversity: (pressure: number) => void;
  onImmigrants: (count: number) => void;
  onResetPopulation: () => void;
  onToggleReplay: () => void;
  onFollowLeader: () => void;
  onShare: () => void;
  onClearHallOfFame: () => void;
}

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

export class Panel {
  private speedButtons = new Map<Speed, HTMLButtonElement>();
  private pauseButton: HTMLButtonElement;
  private replayButton: HTMLButtonElement;

  readonly mutationRate: HTMLInputElement;
  readonly mutationSize: HTMLInputElement;
  readonly elites: HTMLInputElement;
  readonly population: HTMLInputElement;
  readonly diversity: HTMLInputElement;
  readonly immigrants: HTMLInputElement;

  private goal: HTMLSelectElement;
  private selection: HTMLSelectElement;
  private crossover: HTMLSelectElement;

  constructor(callbacks: PanelCallbacks) {
    const speeds = required<HTMLDivElement>('speeds');
    for (const speed of SPEEDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = speed === 'max' ? 'max' : `${speed}×`;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => callbacks.onSpeed(speed));
      speeds.append(button);
      this.speedButtons.set(speed, button);
    }

    this.pauseButton = required<HTMLButtonElement>('pause');
    this.pauseButton.addEventListener('click', callbacks.onPauseToggle);

    this.replayButton = required<HTMLButtonElement>('replay');
    this.replayButton.addEventListener('click', callbacks.onToggleReplay);

    this.mutationRate = required<HTMLInputElement>('mutation-rate');
    this.mutationRate.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onMutationRate(Number(this.mutationRate.value) / 100);
    });

    this.mutationSize = required<HTMLInputElement>('mutation-size');
    this.mutationSize.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onMutationSize(Number(this.mutationSize.value) / 100);
    });

    this.elites = required<HTMLInputElement>('elites');
    this.elites.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onEliteCount(Number(this.elites.value));
    });

    this.population = required<HTMLInputElement>('population');
    this.population.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onPopulationSize(Number(this.population.value));
    });

    this.diversity = required<HTMLInputElement>('diversity');
    this.diversity.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onDiversity(Number(this.diversity.value) / 100);
    });

    this.immigrants = required<HTMLInputElement>('immigrants');
    this.immigrants.addEventListener('input', () => {
      this.syncLabels();
      callbacks.onImmigrants(Number(this.immigrants.value));
    });

    this.goal = required<HTMLSelectElement>('goal');
    this.goal.addEventListener('change', () => callbacks.onGoal(this.goal.value as FitnessGoal));

    this.selection = required<HTMLSelectElement>('selection');
    this.selection.addEventListener('change', () =>
      callbacks.onSelection(this.selection.value as SelectionMethod),
    );

    this.crossover = required<HTMLSelectElement>('crossover');
    this.crossover.addEventListener('change', () =>
      callbacks.onCrossover(this.crossover.value as CrossoverMode),
    );

    required('reset').addEventListener('click', callbacks.onResetPopulation);
    required('follow').addEventListener('click', callbacks.onFollowLeader);
    required('share').addEventListener('click', callbacks.onShare);
    required('clear-hall').addEventListener('click', callbacks.onClearHallOfFame);
  }

  setSpeed(speed: Speed): void {
    for (const [value, button] of this.speedButtons) {
      button.setAttribute('aria-pressed', value === speed ? 'true' : 'false');
    }
  }

  setPaused(paused: boolean): void {
    this.pauseButton.textContent = paused ? 'Resume' : 'Pause';
  }

  setReplaying(replaying: boolean): void {
    this.replayButton.textContent = replaying ? 'Back to evolving' : 'Watch best run';
  }

  /** Reflect restored settings into the inputs without firing callbacks. */
  setValues(values: {
    mutationRate: number;
    mutationSize: number;
    eliteCount: number;
    populationSize: number;
    diversityPressure: number;
    immigrants: number;
    goal: FitnessGoal;
    selection: SelectionMethod;
    crossoverMode: CrossoverMode;
  }): void {
    this.mutationRate.value = String(Math.round(values.mutationRate * 100));
    this.mutationSize.value = String(Math.round(values.mutationSize * 100));
    this.elites.value = String(values.eliteCount);
    this.population.value = String(values.populationSize);
    this.diversity.value = String(Math.round(values.diversityPressure * 100));
    this.immigrants.value = String(values.immigrants);
    this.goal.value = values.goal;
    this.selection.value = values.selection;
    this.crossover.value = values.crossoverMode;
    this.syncLabels();
  }

  /** Keep each slider's readout showing that slider's current value. */
  private syncLabels(): void {
    const set = (name: string, text: string) => {
      const el = document.querySelector<HTMLElement>(`[data-readout="${name}"]`);
      if (el) el.textContent = text;
    };
    set('mutation-rate', `${this.mutationRate.value}%`);
    set('mutation-size', `${this.mutationSize.value}%`);
    set('elites', this.elites.value);
    set('population', this.population.value);
    set('diversity', `${this.diversity.value}%`);
    set('immigrants', this.immigrants.value);
  }
}
