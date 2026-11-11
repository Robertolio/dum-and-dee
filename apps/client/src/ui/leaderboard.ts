import type { Screens } from './screens';
import { sfx } from '../audio/sfx';
import { loadIdentity } from '../social/identity';

type Kind = 'duo' | 'player';
type Range = 'week' | 'all';

interface Entry {
  rank: number;
  name: string;
  score: number;
  me: boolean;
  friend: boolean;
}
interface View {
  entries: Entry[];
  me: Entry | null;
  total: number;
}

const ENVS: Array<[string, string]> = [
  ['overall', 'Overall'],
  ['factory', 'Meat factory'],
  ['studio', 'TV studio'],
  ['boathouse', 'Boathouse'],
  ['rowing', 'Rowing race'],
  ['endless', 'Endless'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Leaderboard screen: Duos / Players, This week / All time, one environment (or Overall). Reads /api/leaderboard; nothing is ever sent from here. */
export class LeaderboardUI {
  private readonly root = el('div', 'screen hidden');
  private kind: Kind = 'duo';
  private range: Range = 'week';
  private env = 'overall';
  private back: (() => void) | null = null;
  private seq = 0;

  constructor(private readonly screens: Screens) {
    this.root.id = 'leaderboard';
    this.root.dataset.testid = 'leaderboard-screen';
    document.body.append(this.root);
    screens.overlayClosers.push(() => {
      const was = !this.root.classList.contains('hidden');
      this.root.classList.add('hidden');
      return was;
    });
    screens.onLeaderboard = (back) => this.show(back);
  }

  show(back?: () => void): void {
    if (back) this.back = back;
    this.render(null, 'Loading…');
    void this.load();
  }

  private close(): void {
    this.root.classList.add('hidden');
    const b = this.back;
    this.back = null;
    if (b) b();
    else this.screens.restoreView('panel');
  }

  private async load(): Promise<void> {
    const my = ++this.seq;
    const q = new URLSearchParams({ kind: this.kind, range: this.range, env: this.env });
    const id = loadIdentity();
    try {
      const res = await fetch(`/api/leaderboard?${q}`, { headers: id ? { 'x-dd-token': id.token } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const v = (await res.json()) as View;
      if (my === this.seq) this.render(v, '');
    } catch {
      if (my === this.seq) this.render(null, 'Could not load the leaderboard. Try again later.');
    }
  }

  private render(v: View | null, note: string): void {
    const card = el('div', 'card');
    card.style.maxHeight = '90vh';
    card.style.overflowY = 'auto';
    const head = el('div', 'ctl');
    const done = el('button', 'primary', 'Back');
    done.dataset.testid = 'lb-back';
    done.addEventListener('click', () => {
      sfx.click();
      this.close();
    });
    head.append(done, el('h2', '', 'Leaderboard'));
    card.append(head);
    const tabs = (items: Array<[string, string]>, cur: string, id: string, set: (v: string) => void): HTMLElement => {
      const row = el('div', 'ctl');
      for (const [val, label] of items) {
        const b = el('button', val === cur ? 'active' : '', label);
        b.dataset.testid = `${id}-${val}`;
        b.addEventListener('click', () => {
          sfx.click();
          set(val);
          this.show();
        });
        row.append(b);
      }
      return row;
    };
    const top = tabs([['duo', 'Duos'], ['player', 'Players']], this.kind, 'lb-kind', (x) => (this.kind = x as Kind));
    top.append(...tabs([['week', 'This week'], ['all', 'All time']], this.range, 'lb-range', (x) => (this.range = x as Range)).children);
    card.append(top);
    const envs = el('div', 'ctl');
    envs.style.flexWrap = 'wrap';
    for (const [val, label] of ENVS) {
      const b = el('button', val === this.env ? 'active' : '', label);
      b.dataset.testid = `lb-env-${val}`;
      b.addEventListener('click', () => {
        sfx.click();
        this.env = val;
        this.show();
      });
      envs.append(b);
    }
    card.append(envs);
    const list = el('div', 'lb-list');
    list.dataset.testid = 'lb-list';
    list.style.textAlign = 'left';
    const row = (e: Entry): HTMLElement => {
      const r = el('div', 'lb-row');
      r.dataset.testid = e.me ? 'lb-row-me' : 'lb-row';
      r.style.cssText = `display:flex;gap:10px;padding:4px 8px;border-radius:8px;${e.me ? 'background:rgba(255,211,107,0.35);font-weight:700;' : ''}`;
      const name = el('span', '', e.name + (e.me ? ' (you)' : e.friend ? ' ★' : ''));
      name.style.flex = '1';
      r.append(el('span', '', `#${e.rank}`), name, el('span', '', String(e.score)));
      r.firstElementChild!.setAttribute('style', 'width:3em');
      return r;
    };
    if (v && v.entries.length) {
      for (const e of v.entries) list.append(row(e));
      if (v.me) {
        list.append(el('div', 'sub', '…'));
        list.append(row(v.me));
      }
    } else if (v) {
      const empty = el('p', 'sub', 'No scores yet. Play online with a friend to get on the board.');
      empty.dataset.testid = 'lb-empty';
      list.append(empty);
    } else list.append(el('p', 'sub', note));
    card.append(list);
    card.append(el('p', 'sub', 'Only online two-player runs count. Names are shown without any search.'));
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }
}
