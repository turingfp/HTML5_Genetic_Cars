/**
 * The room: who else is on this track, and what their cars are doing.
 *
 * Everything here is off until someone presses join. Connecting announces you
 * to strangers over public relays, and that is not something to do to a person
 * because they loaded a page, so the button says what it will do before it
 * does it.
 */

import { MEDALS, type MedalName } from '../track/spec';
import type { Peer } from '../net/room';

export interface RoomPanelCallbacks {
  onJoin: (name: string) => void;
  onLeave: () => void;
  onMigrants: (count: number) => void;
}

export type RoomStatus = 'offline' | 'connecting' | 'online' | 'failed';

const MEDAL_COLOUR = new Map<MedalName, string>(MEDALS.map((m) => [m.name, m.colour]));

export class RoomPanel {
  private readonly nameInput: HTMLInputElement;
  private readonly joinButton: HTMLButtonElement;
  private readonly statusLine: HTMLElement;
  private readonly peerList: HTMLElement;
  private readonly swarmLine: HTMLElement;
  private readonly migrants: HTMLInputElement;
  private readonly migrantsReadout: HTMLElement;

  private status: RoomStatus = 'offline';

  constructor(host: HTMLElement, suggestedName: string, callbacks: RoomPanelCallbacks) {
    const explain = document.createElement('p');
    explain.className = 'hint';
    explain.textContent =
      'Everyone on this track code lands in the same room. Your best car gets offered to them and theirs to you, so each tab is an island and champions swim between them. Peer to peer, no server, nothing stored.';
    host.append(explain);

    const row = document.createElement('div');
    row.className = 'seed-row';
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.id = 'room-name';
    this.nameInput.spellcheck = false;
    this.nameInput.autocomplete = 'off';
    this.nameInput.maxLength = 18;
    this.nameInput.value = suggestedName;
    this.nameInput.setAttribute('aria-label', 'Your name in the room');

    this.joinButton = document.createElement('button');
    this.joinButton.type = 'button';
    this.joinButton.id = 'room-join';
    this.joinButton.className = 'primary-button';
    this.joinButton.textContent = 'Join the room';
    this.joinButton.addEventListener('click', () => {
      if (this.status === 'online') callbacks.onLeave();
      else if (this.status !== 'connecting') callbacks.onJoin(this.nameInput.value);
    });
    row.append(this.nameInput, this.joinButton);
    host.append(row);

    this.statusLine = document.createElement('p');
    this.statusLine.className = 'room-status';
    this.statusLine.id = 'room-status';
    host.append(this.statusLine);

    const field = document.createElement('label');
    field.className = 'field';
    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = 'Migrants per generation';
    this.migrantsReadout = document.createElement('output');
    this.migrantsReadout.className = 'field-value';
    caption.append(this.migrantsReadout);
    this.migrants = document.createElement('input');
    this.migrants.type = 'range';
    this.migrants.id = 'migrants';
    this.migrants.min = '0';
    this.migrants.max = '8';
    this.migrants.step = '1';
    this.migrants.addEventListener('input', () => {
      this.migrantsReadout.textContent = this.migrants.value;
      callbacks.onMigrants(Number(this.migrants.value));
    });
    field.append(caption, this.migrants);
    host.append(field);

    const migrantHint = document.createElement('p');
    migrantHint.className = 'hint';
    migrantHint.textContent =
      'How many of your twenty slots are filled by someone else’s champion instead of your own breeding. Turn it up and you converge on the room; turn it down and you keep your own line.';
    host.append(migrantHint);

    this.swarmLine = document.createElement('p');
    this.swarmLine.className = 'swarm-line';
    this.swarmLine.id = 'swarm';
    host.append(this.swarmLine);

    this.peerList = document.createElement('div');
    this.peerList.className = 'peer-list';
    this.peerList.id = 'peers';
    host.append(this.peerList);

    this.setStatus('offline');
  }

  setMigrants(count: number): void {
    this.migrants.value = String(count);
    this.migrantsReadout.textContent = this.migrants.value;
  }

  setStatus(status: RoomStatus, detail = ''): void {
    this.status = status;
    this.joinButton.textContent = status === 'online' ? 'Leave' : 'Join the room';
    this.joinButton.disabled = status === 'connecting';
    this.nameInput.disabled = status === 'online' || status === 'connecting';

    const text: Record<RoomStatus, string> = {
      offline: 'Not connected.',
      connecting: 'Finding the room.',
      online: 'Connected.',
      failed: detail || 'Could not reach the room.',
    };
    this.statusLine.textContent = text[status];
    this.statusLine.dataset['status'] = status;
    if (status !== 'online') {
      this.peerList.replaceChildren();
      this.swarmLine.textContent = '';
    }
  }

  /**
   * Redraw the room.
   *
   * `mine` is this tab's own row, shown alongside the others so the comparison
   * is the point rather than an inference.
   */
  render(
    peers: Peer[],
    mine: { name: string; best: number; generation: number; medal: MedalName | null },
    totalEvaluations: number,
  ): void {
    if (this.status !== 'online') return;

    this.swarmLine.textContent =
      peers.length === 0
        ? 'Nobody else here yet. Send someone the track code.'
        : `${peers.length + 1} browsers, ${totalEvaluations.toLocaleString()} cars tried between them.`;

    const rows = [
      this.row({ ...mine, id: 'me' }, true),
      ...peers.map((peer) => this.row(peer, false)),
    ];
    this.peerList.replaceChildren(...rows);
  }

  private row(
    entry: { id: string; name: string; best: number; generation: number; medal: MedalName | null },
    isSelf: boolean,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = isSelf ? 'peer-row is-self' : 'peer-row';

    const medal = document.createElement('span');
    medal.className = 'peer-medal';
    if (entry.medal) {
      medal.textContent = '●';
      medal.style.color = MEDAL_COLOUR.get(entry.medal) ?? '#94a3b8';
      medal.title = `${entry.medal} medal`;
    } else {
      medal.textContent = '○';
      medal.title = 'no medal yet';
    }

    const name = document.createElement('span');
    name.className = 'peer-name';
    name.textContent = isSelf ? `${entry.name} (you)` : entry.name;

    const stat = document.createElement('span');
    stat.className = 'peer-stat';
    stat.textContent = `${entry.best.toFixed(1)}m · gen ${entry.generation}`;

    row.append(medal, name, stat);
    return row;
  }
}
