/**
 * How far along the track the best car has got, and which medal that is.
 *
 * A genetic algorithm has no finish line, which is most of why watching one
 * goes slack after a few minutes: the number goes up and there is nothing it is
 * going up *towards*. A bar with four marks on it turns "142.6 metres" into
 * "nearly gold", which is a thing to want.
 */

import { MEDALS, medalFor, type MedalName } from '../track/spec';

export class MedalBar {
  private readonly host: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly caption: HTMLElement;
  private best = -1;
  private earned: MedalName | null = null;

  constructor(host: HTMLElement) {
    this.host = host;

    const rail = document.createElement('div');
    rail.className = 'medal-rail';
    this.fill = document.createElement('div');
    this.fill.className = 'medal-fill';
    rail.append(this.fill);

    // Marks sit on the rail at the fraction each medal needs, so the distance
    // to the next one is a length you can see rather than arithmetic.
    for (const medal of MEDALS) {
      const mark = document.createElement('span');
      mark.className = 'medal-mark';
      mark.style.left = `${medal.at * 100}%`;
      mark.style.background = medal.colour;
      mark.title = `${medal.name}: ${Math.round(medal.at * 100)}% of the track`;
      rail.append(mark);
    }

    this.caption = document.createElement('span');
    this.caption.className = 'medal-caption';

    host.append(rail, this.caption);
  }

  /** `best` is the furthest anything has reached; `length` the whole course. */
  update(best: number, length: number): void {
    if (!(length > 0)) return;
    // Redraw only on a real change: this is called every frame.
    if (Math.abs(best - this.best) < 0.05) return;
    this.best = best;

    const fraction = Math.max(0, Math.min(1, best / length));
    this.fill.style.width = `${fraction * 100}%`;

    const medal = medalFor(best, length);
    if (medal !== this.earned) {
      this.earned = medal;
      const colour = MEDALS.find((m) => m.name === medal)?.colour;
      this.fill.style.background = colour ?? '#38bdf8';
      this.host.dataset['medal'] = medal ?? '';
    }

    const next = [...MEDALS].reverse().find((m) => fraction < m.at);
    this.caption.textContent = next
      ? `${Math.round(fraction * 100)}% · ${(next.at * length - best).toFixed(0)}m to ${next.name}`
      : `finished · ${Math.round(fraction * 100)}%`;
  }

  /** A new track means a new course to measure against. */
  reset(): void {
    this.best = -1;
    this.earned = null;
    this.fill.style.width = '0%';
    this.caption.textContent = '';
    this.host.dataset['medal'] = '';
  }
}
