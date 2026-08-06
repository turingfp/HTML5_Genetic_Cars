/**
 * The workshop: build a car by hand and put it in the race.
 *
 * Everything else here searches for you. This is the one place you get to have
 * an opinion, and the honest reason it exists is that having an opinion and
 * then watching it lose to something evolution found is the most instructive
 * thing this page can show you.
 *
 * Corners are dragged rather than typed. A chassis has eight of them and each
 * has an angle and a length, so sliders would mean sixteen numbers and no
 * sense at all of the shape they add up to. Dragging is also honest about the
 * constraint: a corner cannot leave its own sector, which is what keeps the
 * body convex, and you can feel that as a wall rather than read it in a hint.
 */

import {
  CHASSIS_AXIS_MIN,
  CHASSIS_AXIS_RANGE,
  CHASSIS_DENSITY_MIN,
  CHASSIS_DENSITY_RANGE,
  CHASSIS_VERTEX_COUNT,
  MAX_WHEEL_COUNT,
  MIN_WHEEL_COUNT,
  SPOKE_ANGLE_JITTER,
  WHEEL_DENSITY_MIN,
  WHEEL_DENSITY_RANGE,
  WHEEL_RADIUS_MIN,
  WHEEL_RADIUS_RANGE,
} from '../config';
import { rngFromSeed } from '../core/rng';
import { cloneCar, randomCar, rebuildVertices, type CarDef } from '../ga/genome';

const SECTOR = (Math.PI * 2) / CHASSIS_VERTEX_COUNT;
const HALF_SWING = (SECTOR / 2) * SPOKE_ANGLE_JITTER;
const MAX_REACH = CHASSIS_AXIS_MIN + CHASSIS_AXIS_RANGE;

export interface WorkshopCallbacks {
  /** Put this car into the next generation. */
  onRace: (def: CarDef) => void;
  /** Start from whatever is currently winning. */
  onCopyLeader: () => CarDef | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Workshop {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: WorkshopCallbacks;
  private readonly wheelCount: HTMLInputElement;
  private readonly radius: HTMLInputElement;
  private readonly wheelDensity: HTMLInputElement;
  private readonly bodyDensity: HTMLInputElement;
  private readonly readouts = new Map<string, HTMLElement>();
  private readonly note: HTMLElement;

  private def: CarDef;
  /** Corner being dragged, or -1. */
  private dragging = -1;
  /** Where the pointer went down, so a tap can be told from a drag. */
  private downAt: { x: number; y: number } | null = null;

  constructor(host: HTMLElement, callbacks: WorkshopCallbacks) {
    this.callbacks = callbacks;
    this.def = randomCar(rngFromSeed('workshop'));

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Drag a corner to reshape the body. Tap one to put a wheel on it. Your car joins the next generation and is then bred like any other, so if it is any good you will see its children.';
    host.append(hint);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'workshop-canvas';
    this.canvas.id = 'workshop-canvas';
    this.canvas.setAttribute('aria-label', 'Car being built');
    host.append(this.canvas);

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    const release = (e: PointerEvent) => this.onUp(e);
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);

    this.wheelCount = this.slider(host, 'wheels', 'Wheels', MIN_WHEEL_COUNT, MAX_WHEEL_COUNT, 1);
    this.radius = this.slider(
      host,
      'wheel-radius',
      'Wheel size',
      WHEEL_RADIUS_MIN,
      WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE,
      0.01,
    );
    this.wheelDensity = this.slider(
      host,
      'wheel-density',
      'Wheel weight',
      WHEEL_DENSITY_MIN,
      WHEEL_DENSITY_MIN + WHEEL_DENSITY_RANGE,
      1,
    );
    this.bodyDensity = this.slider(
      host,
      'body-density',
      'Body weight',
      CHASSIS_DENSITY_MIN,
      CHASSIS_DENSITY_MIN + CHASSIS_DENSITY_RANGE,
      1,
    );

    const row = document.createElement('div');
    // Not `seed-row`: that one holds an input and a small icon button and
    // refuses to shrink either, so two full-width labels shot 342 pixels past
    // the edge of a phone.
    row.className = 'button-row';
    row.append(
      this.button('Random', 'workshop-random', () => {
        this.def = randomCar(rngFromSeed(String(Math.random())));
        this.sync();
      }),
      this.button('Copy the leader', 'workshop-copy', () => {
        const leader = this.callbacks.onCopyLeader();
        if (!leader) {
          this.say('Nothing is leading yet.');
          return;
        }
        this.def = cloneCar(leader);
        this.sync();
        this.say('Copied the car in front. Now change something.');
      }),
    );
    host.append(row);

    const race = this.button('Race this car', 'workshop-race', () => {
      this.callbacks.onRace(cloneCar(this.def));
      this.say('In the queue. It starts with the next generation.');
    });
    race.className = 'primary-button';
    host.append(race);

    this.note = document.createElement('p');
    this.note.className = 'hint';
    this.note.id = 'workshop-note';
    host.append(this.note);

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.draw()).observe(this.canvas);
    }
    this.sync();
  }

  /** The car as it currently stands. */
  get car(): CarDef {
    return this.def;
  }

  private say(text: string): void {
    this.note.textContent = text;
  }

  private button(label: string, id: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = 'secondary-button';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private slider(
    host: HTMLElement,
    id: string,
    label: string,
    min: number,
    max: number,
    step: number,
  ): HTMLInputElement {
    const field = document.createElement('label');
    field.className = 'field';
    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = label;
    const readout = document.createElement('output');
    readout.className = 'field-value';
    caption.append(readout);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `workshop-${id}`;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('input', () => this.readSliders());
    field.append(caption, input);
    host.append(field);
    this.readouts.set(id, readout);
    return input;
  }

  /** Pull the slider values into the car. */
  private readSliders(): void {
    const want = clamp(Math.round(Number(this.wheelCount.value)), MIN_WHEEL_COUNT, MAX_WHEEL_COUNT);
    const radius = Number(this.radius.value);
    const density = Number(this.wheelDensity.value);

    while (this.def.wheels.length > want) this.def.wheels.pop();
    while (this.def.wheels.length < want) {
      // A new wheel takes the first corner that has not got one, since two
      // wheels on a corner is a car that cannot be built.
      const taken = new Set(this.def.wheels.map((w) => w.vertex));
      let vertex = 0;
      while (taken.has(vertex) && vertex < CHASSIS_VERTEX_COUNT - 1) vertex++;
      this.def.wheels.push({ radius, density, vertex });
    }
    for (const wheel of this.def.wheels) {
      wheel.radius = radius;
      wheel.density = density;
    }
    this.def.chassisDensity = Number(this.bodyDensity.value);
    this.sync(false);
  }

  /** Push the car into the sliders and redraw. */
  private sync(writeSliders = true): void {
    if (writeSliders) {
      const first = this.def.wheels[0]!;
      this.wheelCount.value = String(this.def.wheels.length);
      this.radius.value = String(first.radius);
      this.wheelDensity.value = String(first.density);
      this.bodyDensity.value = String(this.def.chassisDensity);
    }
    this.readouts.get('wheels')!.textContent = String(this.def.wheels.length);
    this.readouts.get('wheel-radius')!.textContent = `${Number(this.radius.value).toFixed(2)}m`;
    this.readouts.get('wheel-density')!.textContent = String(Math.round(Number(this.wheelDensity.value)));
    this.readouts.get('body-density')!.textContent = String(Math.round(Number(this.bodyDensity.value)));
    rebuildVertices(this.def);
    this.draw();
  }

  /* ── Dragging ──────────────────────────────────────────────────────────── */

  /**
   * Canvas pixels per metre, and the centre, for the current size.
   *
   * The extent has to include the wheels. A corner reaches 1.2m and a wheel on
   * it another 0.7, so scaling to the body alone drew wheels off the edge of
   * the panel. Fixed rather than fitted to the current car, so the drawing does
   * not rescale under your cursor while you drag.
   */
  private view(): { cx: number; cy: number; scale: number } {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const extent = MAX_REACH + WHEEL_RADIUS_MIN + WHEEL_RADIUS_RANGE;
    return { cx: w / 2, cy: h / 2, scale: (Math.min(w, h) * 0.46) / extent };
  }

  private toWorld(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { cx, cy, scale } = this.view();
    return {
      x: (event.clientX - rect.left - cx) / scale,
      // Canvas y runs down, the world's runs up.
      y: -(event.clientY - rect.top - cy) / scale,
    };
  }

  /** The corner nearest a world point, if it is close enough to mean it. */
  private nearestCorner(x: number, y: number): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
      const v = this.def.vertices[i]!;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    // Within a fifth of the body's reach counts as grabbing it.
    return bestDistance < MAX_REACH * 0.28 ? best : -1;
  }

  private onDown(event: PointerEvent): void {
    const { x, y } = this.toWorld(event);
    const corner = this.nearestCorner(x, y);
    if (corner < 0) return;
    this.dragging = corner;
    this.downAt = { x, y };
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private onMove(event: PointerEvent): void {
    if (this.dragging < 0) return;
    const { x, y } = this.toWorld(event);
    const spoke = this.def.spokes[this.dragging]!;

    // Length is simply how far out you dragged.
    spoke.length = clamp(Math.hypot(x, y), CHASSIS_AXIS_MIN, MAX_REACH);

    // Angle is where you are within this corner's own sector, and nowhere
    // else. A corner that could leave its sector could cross its neighbour,
    // and the body would stop being convex.
    const mid = this.dragging * SECTOR;
    let offset = Math.atan2(y, x) - mid;
    while (offset > Math.PI) offset -= Math.PI * 2;
    while (offset < -Math.PI) offset += Math.PI * 2;
    spoke.angle = clamp(offset / HALF_SWING, -1, 1);

    rebuildVertices(this.def);
    this.draw();
  }

  private onUp(event: PointerEvent): void {
    if (this.dragging < 0) return;
    const { x, y } = this.toWorld(event);
    // How far the *pointer* travelled, not how far it ended up from the
    // corner: dragging moves the corner onto the pointer, so measuring against
    // the corner made every drag look like a tap and quietly added a wheel.
    const from = this.downAt;
    const travelled = from ? Math.hypot(from.x - x, from.y - y) : Infinity;
    if (travelled < MAX_REACH * 0.06) this.toggleWheel(this.dragging);

    this.dragging = -1;
    this.downAt = null;
    this.canvas.releasePointerCapture(event.pointerId);
    this.sync(false);
  }

  private toggleWheel(vertex: number): void {
    const at = this.def.wheels.findIndex((w) => w.vertex === vertex);
    if (at >= 0) {
      if (this.def.wheels.length <= MIN_WHEEL_COUNT) {
        this.say(`A car needs at least ${MIN_WHEEL_COUNT} wheels.`);
        return;
      }
      this.def.wheels.splice(at, 1);
    } else {
      if (this.def.wheels.length >= MAX_WHEEL_COUNT) {
        this.say(`Four wheels is the most a car can carry.`);
        return;
      }
      this.def.wheels.push({
        radius: Number(this.radius.value),
        density: Number(this.wheelDensity.value),
        vertex,
      });
    }
    this.wheelCount.value = String(this.def.wheels.length);
    this.say('');
  }

  /* ── Drawing ───────────────────────────────────────────────────────────── */

  private draw(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width <= 0 || height <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const { cx, cy, scale } = this.view();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(cx, cy);
    // World y is up.
    ctx.scale(scale, -scale);

    // The sector each corner is confined to, so the constraint is visible
    // rather than something you discover by pushing against it.
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = 'rgba(148,163,184,0.16)';
    for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
      const mid = i * SECTOR;
      for (const edge of [mid - HALF_SWING, mid + HALF_SWING]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(edge) * MAX_REACH, Math.sin(edge) * MAX_REACH);
        ctx.stroke();
      }
    }

    // The body.
    ctx.beginPath();
    this.def.vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.22)';
    ctx.fill();
    ctx.lineWidth = 2.5 / scale;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Wheels.
    const wheelAt = new Map(this.def.wheels.map((w) => [w.vertex, w]));
    for (const wheel of this.def.wheels) {
      const v = this.def.vertices[wheel.vertex]!;
      ctx.beginPath();
      ctx.arc(v.x, v.y, wheel.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fill();
      ctx.lineWidth = 2 / scale;
      ctx.strokeStyle = '#e2e8f0';
      ctx.stroke();
    }

    // Corner handles, brighter where a wheel already sits.
    for (let i = 0; i < CHASSIS_VERTEX_COUNT; i++) {
      const v = this.def.vertices[i]!;
      ctx.beginPath();
      ctx.arc(v.x, v.y, (i === this.dragging ? 9 : 6) / scale, 0, Math.PI * 2);
      ctx.fillStyle = wheelAt.has(i) ? '#fde047' : '#7dd3fc';
      ctx.fill();
    }

    ctx.restore();
  }
}
