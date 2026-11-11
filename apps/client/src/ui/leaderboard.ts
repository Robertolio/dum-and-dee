import type { Screens } from './screens';
import { sfx } from '../audio/sfx';
import { loadIdentity } from '../social/identity';

type Kind = 'duo' | 'solo';

interface Entry {
  rank: number;
  name: string;
  score: number;
  levels: number;
  me: boolean;
  friend: boolean;
}
interface View {
  entries: Entry[];
  me: Entry | null;
  total: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Leaderboard: two tabs (Duos, Solo), one all-time top 25 each. Total = sum of the best score per level. Reads /api/leaderboard only. */
export class LeaderboardUI {
  private readonly root = el('div', 'screen hidden');
  private kind: Kind = 'duo';
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
    const id = loadIdentity();
    try {
      const res = await fetch(`/api/leaderboard?kind=${this.kind}&range=all&env=overall`, { headers: id ? { 'x-dd-token': id.token } : {} });
      if (!res.ok) throw new Error(String(res.status));
      const v = (await res.json()) as View;
      if (my === this.seq) this.render(v, '');
    } catch {
      if (my === this.seq) this.render(null, 'Could not load the leaderboard.');
    }
  }

  private render(v: View | null, note: string): void {
    const card = el('div', 'card');
    card.style.cssText = 'display:flex;flex-direction:column;max-height:94vh;width:min(560px,94vw);padding:10px 14px;gap:6px;overflow:hidden';
    const head = el('div', 'ctl');
    head.style.margin = '0';
    const back = el('button', '', 'Back');
    back.dataset.testid = 'lb-back';
    back.addEventListener('click', () => {
      sfx.click();
      this.close();
    });
    head.append(back);
    for (const [k, label] of [['duo', 'Duos'], ['solo', 'Solo']] as Array<[Kind, string]>) {
      const b = el('button', k === this.kind ? 'active' : '', label);
      b.dataset.testid = `lb-kind-${k}`;
      b.addEventListener('click', () => {
        sfx.click();
        this.kind = k;
        this.show();
      });
      head.append(b);
    }
    card.append(head);
    if (this.screens.soloNote) {
      const n = el('p', 'sub', this.screens.soloNote);
      n.dataset.testid = 'lb-note';
      n.style.margin = '0';
      card.append(n);
    }
    const row = (e: Entry): HTMLElement => {
      const r = el('div', 'lb-row');
      r.dataset.testid = e.me ? 'lb-row-me' : 'lb-row';
      r.style.cssText = `display:flex;gap:8px;padding:3px 8px;border-radius:8px;font-size:15px;${e.me ? 'background:rgba(255,211,107,0.35);font-weight:700;' : ''}`;
      const rank = el('span', '', `#${e.rank}`);
      rank.style.width = '2.6em';
      const name = el('span', '', e.name + (e.me ? ' (you)' : e.friend ? ' ★' : ''));
      name.style.cssText = 'flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const lv = el('span', '', `${e.levels} level${e.levels === 1 ? '' : 's'}`);
      lv.style.opacity = '0.7';
      const pts = el('span', '', String(e.score));
      pts.style.cssText = 'min-width:3.5em;text-align:right';
      r.append(rank, name, lv, pts);
      return r;
    };
    const list = el('div', 'lb-list');
    list.dataset.testid = 'lb-list';
    list.style.cssText = 'flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch';
    if (v && v.entries.length) {
      for (const e of v.entries) list.append(row(e));
    } else if (v) {
      const empty = el('p', 'sub', 'Play a level to get on the board.');
      empty.dataset.testid = 'lb-empty';
      list.append(empty);
    } else list.append(el('p', 'sub', note));
    card.append(list);
    if (v?.me) {
      const mine = row(v.me);
      mine.style.borderTop = '1px solid rgba(255,255,255,0.3)';
      card.append(mine);
    }
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }
}
