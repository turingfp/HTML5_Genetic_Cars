/**
 * The hall of fame: the best cars seen so far, with a thumbnail of each.
 */

import { TOP_SCORE_COUNT } from '../config';
import { drawThumbnail, ELITE_STYLE } from '../render/carPath';
import type { HallOfFameEntry } from './storage';

export class Leaderboard {
  private root: HTMLElement;
  onSelect: ((entry: HallOfFameEntry) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  render(entries: HallOfFameEntry[]): void {
    this.root.textContent = '';

    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No finishers yet.';
      this.root.append(empty);
      return;
    }

    const list = document.createElement('ol');
    list.className = 'leaderboard-list';

    for (const entry of entries.slice(0, TOP_SCORE_COUNT)) {
      const item = document.createElement('li');

      const thumb = document.createElement('canvas');
      const size = 44;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      thumb.width = size * dpr;
      thumb.height = size * dpr;
      thumb.className = 'thumb';
      const ctx = thumb.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        drawThumbnail(ctx, entry.def, size, ELITE_STYLE);
      }

      const text = document.createElement('div');
      text.className = 'entry-text';

      const score = document.createElement('strong');
      score.textContent = entry.score.toFixed(1);

      const detail = document.createElement('span');
      detail.textContent = `${entry.distance.toFixed(1)}m · gen ${entry.generation}`;

      text.append(score, detail);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'entry-button';
      button.title = 'Export this car as JSON';
      button.textContent = '↓';
      button.addEventListener('click', () => this.onSelect?.(entry));

      item.append(thumb, text, button);
      list.append(item);
    }

    this.root.append(list);
  }
}
