/**
 * The track editor.
 *
 * Sliders are built from `SPEC_RANGES` rather than written out in the markup,
 * so adding a knob to the spec adds it to the editor and to the code format at
 * once and they cannot drift apart.
 *
 * The preview matters more than it looks. Terrain generation is chaotic:
 * nudging "hills" does not nudge the hills, it redraws them. Without seeing the
 * course you are tuning blind, and the difference between a track worth sharing
 * and a wall is not something the numbers tell you.
 */

import { generateTrackFromSpec, type TrackDef } from '../sim/track';
import { CAMPAIGN } from '../track/campaign';
import {
  describeSpec,
  encodeSpec,
  normaliseSpec,
  SPEC_RANGES,
  type SpecKnob,
  type TrackSpec,
} from '../track/spec';

export interface TrackEditorCallbacks {
  /** The design changed. Cheap: only the preview should react. */
  onPreview: (spec: TrackSpec) => void;
  /** Build this track for real, throwing away the current run. */
  onBuild: (spec: TrackSpec) => void;
  /** Copy the code to the clipboard. */
  onCopy: (code: string) => void;
}

const KNOB_ORDER: SpecKnob[] = ['tiles', 'hills', 'ramps', 'gaps', 'bank', 'width'];

/** Knobs that only mean anything in 3D, so they can be dimmed in flat mode. */
const THREE_D_ONLY: ReadonlySet<SpecKnob> = new Set<SpecKnob>(['bank', 'width']);

/** How a knob's value is shown next to its slider. */
function format(knob: SpecKnob, value: number): string {
  if (knob === 'tiles') return String(Math.round(value));
  if (knob === 'ramps' || knob === 'gaps') return `${Math.round(value * 100)}%`;
  return `${value.toFixed(2)}x`;
}

export class TrackEditor {
  private readonly sliders = new Map<SpecKnob, HTMLInputElement>();
  private readonly readouts = new Map<SpecKnob, HTMLElement>();
  private readonly seedInput: HTMLInputElement;
  private readonly codeField: HTMLInputElement;
  private readonly summary: HTMLElement;
  private readonly brief: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly preview: HTMLCanvasElement;
  private readonly callbacks: TrackEditorCallbacks;

  private current: TrackSpec;

  constructor(host: HTMLElement, initial: TrackSpec, callbacks: TrackEditorCallbacks) {
    this.callbacks = callbacks;
    this.current = normaliseSpec(initial);

    // The built-in tracks come first, because a slider with no idea what it is
    // for is a worse start than a list of things to try.
    const picker = document.createElement('select');
    picker.id = 'campaign';
    picker.setAttribute('aria-label', 'Built-in tracks');
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Pick a track';
    picker.append(custom);
    for (const [index, track] of CAMPAIGN.entries()) {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = track.name;
      option.title = track.brief;
      picker.append(option);
    }
    this.picker = picker;
    picker.addEventListener('change', () => {
      const track = CAMPAIGN[Number(picker.value)];
      if (!track) return;
      this.setSpec(track.spec);
      this.brief.textContent = track.brief;
      // Chosen from a list of finished tracks, so drive it rather than making
      // someone press a second button to confirm what they just picked.
      this.callbacks.onBuild(this.current);
    });
    host.append(picker);

    this.brief = document.createElement('p');
    this.brief.className = 'hint';
    host.append(this.brief);

    this.preview = document.createElement('canvas');
    this.preview.className = 'track-preview';
    this.preview.setAttribute('aria-label', 'Preview of this track');
    host.append(this.preview);

    this.summary = document.createElement('p');
    this.summary.className = 'track-summary';
    host.append(this.summary);

    for (const knob of KNOB_ORDER) {
      const range = SPEC_RANGES[knob];
      const row = document.createElement('label');
      row.className = 'field';
      if (THREE_D_ONLY.has(knob)) row.dataset['threeD'] = 'true';

      const caption = document.createElement('span');
      caption.className = 'field-label';
      caption.textContent = range.label;
      const readout = document.createElement('output');
      readout.className = 'field-value';
      caption.append(readout);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = String(range.min);
      slider.max = String(range.max);
      slider.step = String(range.step);
      slider.value = String(this.current[knob]);
      slider.addEventListener('input', () => {
        this.current = normaliseSpec({ ...this.current, [knob]: Number(slider.value) });
        this.markCustom();
        this.sync();
        this.callbacks.onPreview(this.current);
      });

      row.append(caption, slider);
      host.append(row);
      this.sliders.set(knob, slider);
      this.readouts.set(knob, readout);
    }

    const seedRow = document.createElement('div');
    seedRow.className = 'seed-row';
    this.seedInput = document.createElement('input');
    this.seedInput.id = 'seed-input';
    this.seedInput.type = 'text';
    this.seedInput.spellcheck = false;
    this.seedInput.autocomplete = 'off';
    this.seedInput.setAttribute('aria-label', 'Track seed');
    this.seedInput.value = this.current.seed;
    this.seedInput.addEventListener('input', () => {
      this.current = normaliseSpec({ ...this.current, seed: this.seedInput.value });
      this.markCustom();
      this.sync();
      this.callbacks.onPreview(this.current);
    });

    const dice = document.createElement('button');
    dice.type = 'button';
    dice.className = 'ghost-button';
    dice.title = 'Random track';
    dice.textContent = '⚇';
    dice.addEventListener('click', () => {
      this.setSpec(randomFrom(this.current));
      this.markCustom();
      this.callbacks.onPreview(this.current);
    });
    seedRow.append(this.seedInput, dice);
    host.append(seedRow);

    const build = document.createElement('button');
    build.type = 'button';
    build.className = 'primary-button';
    build.id = 'build-track';
    build.textContent = 'Drive this track';
    build.addEventListener('click', () => this.callbacks.onBuild(this.current));
    host.append(build);

    const codeRow = document.createElement('div');
    codeRow.className = 'seed-row';
    this.codeField = document.createElement('input');
    this.codeField.type = 'text';
    this.codeField.spellcheck = false;
    this.codeField.autocomplete = 'off';
    this.codeField.id = 'track-code';
    this.codeField.setAttribute('aria-label', 'Track code');
    this.codeField.placeholder = 'paste a track code';
    // Enter loads a pasted code. Anything unrecognised is left alone rather
    // than being cleared: retyping a long code because of one bad character is
    // exactly the sort of thing that makes people stop sharing them.
    this.codeField.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.loadTyped();
    });
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ghost-button';
    copy.id = 'copy-code';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => this.callbacks.onCopy(encodeSpec(this.current)));
    codeRow.append(this.codeField, copy);
    host.append(codeRow);

    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'secondary-button';
    load.id = 'load-code';
    load.textContent = 'Load a code';
    load.addEventListener('click', () => this.loadTyped());
    host.append(load);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'A code is the whole track. Send someone yours and they get the same hills, the same gaps, in the same places.';
    host.append(hint);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.draw()).observe(this.preview);
    }
    this.sync();
  }

  /** What the sliders currently describe. */
  get spec(): TrackSpec {
    return this.current;
  }

  /** Called when someone types a code, so the app can decide to build it. */
  onCodePasted: ((code: string) => void) | null = null;

  setSpec(spec: TrackSpec): void {
    this.current = normaliseSpec(spec);
    for (const [knob, slider] of this.sliders) slider.value = String(this.current[knob]);
    this.seedInput.value = this.current.seed;
    this.sync();
  }

  /** Show the picker as "Pick a track" again, since this is now your design. */
  private markCustom(): void {
    if (this.picker.value === '') return;
    this.picker.value = '';
    this.brief.textContent = '';
  }

  /** Dim the knobs that do nothing in the mode now running. */
  setMode(mode: '2d' | '3d'): void {
    for (const knob of THREE_D_ONLY) {
      const slider = this.sliders.get(knob);
      slider?.closest('.field')?.classList.toggle('is-inert', mode === '2d');
    }
  }

  private loadTyped(): void {
    const typed = this.codeField.value.trim();
    if (typed) this.onCodePasted?.(typed);
  }

  private sync(): void {
    for (const [knob, readout] of this.readouts) {
      readout.textContent = format(knob, this.current[knob]);
    }
    this.codeField.value = encodeSpec(this.current);
    this.summary.textContent = describeSpec(this.current);
    this.draw();
  }

  /**
   * Draw the whole course as a profile, gaps included.
   *
   * The entire track at once rather than a window on it: the question this
   * answers is "is this worth driving", which is about the shape of the whole
   * thing.
   */
  private draw(): void {
    const canvas = this.preview;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const track = generateTrackFromSpec(this.current);
    const pad = 4;
    const spanX = Math.max(1, track.endX - track.surface[0]!.x);
    const spanY = Math.max(1, track.maxY - track.minY);
    const sx = (x: number) => pad + ((x - track.surface[0]!.x) / spanX) * (width - pad * 2);
    const sy = (y: number) => height - pad - ((y - track.minY) / spanY) * (height - pad * 2);

    // Ground, one solid run at a time, so gaps read as holes here too.
    ctx.fillStyle = '#16243c';
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.25;
    forEachSolidRun(track, (from, to) => {
      ctx.beginPath();
      ctx.moveTo(sx(track.surface[from]!.x), height);
      for (let i = from; i <= to; i++) ctx.lineTo(sx(track.surface[i]!.x), sy(track.surface[i]!.y));
      ctx.lineTo(sx(track.surface[to]!.x), height);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(sx(track.surface[from]!.x), sy(track.surface[from]!.y));
      for (let i = from + 1; i <= to; i++) {
        ctx.lineTo(sx(track.surface[i]!.x), sy(track.surface[i]!.y));
      }
      ctx.stroke();
    });

    // Ramps, marked so a rampy track is recognisable at a glance.
    ctx.fillStyle = '#f59e0b';
    for (let i = 0; i < track.tiles.length; i++) {
      if (!track.tiles[i]!.ramp) continue;
      const point = track.surface[i]!;
      ctx.fillRect(sx(point.x) - 1, sy(point.y) - 4, 2, 4);
    }
  }
}

/** Walk the runs of consecutive solid tiles as [from, to] surface indices. */
function forEachSolidRun(track: TrackDef, visit: (from: number, to: number) => void): void {
  let start = -1;
  for (let i = 0; i < track.tiles.length; i++) {
    const solid = track.tiles[i]!.solid;
    if (solid && start < 0) start = i;
    if (!solid && start >= 0) {
      visit(start, i);
      start = -1;
    }
  }
  if (start >= 0) visit(start, track.tiles.length);
}

/** A fresh design, keeping nothing but the habit of being drivable. */
function randomFrom(previous: TrackSpec): TrackSpec {
  const seed = Math.random().toString(36).slice(2, 8);
  const soft = () => Math.random() * Math.random();
  return normaliseSpec({
    seed,
    tiles: 120 + Math.round(Math.random() * 260),
    hills: 0.5 + Math.random() * 1.3,
    ramps: soft() * 0.22,
    gaps: soft() * 0.14,
    bank: Math.random() * 1.6,
    width: previous.width,
  });
}
