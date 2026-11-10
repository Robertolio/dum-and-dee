import { CAMPAIGN, levelById, nextLevel, type LevelDef } from '@dd/sim';
import type { GameScene } from '../scenes/GameScene';
import { sfx } from '../audio/sfx';
import { loadProgress, recordEndless, recordLevel } from '../progress';
import { keepScreenOn } from '../platform/wakelock';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function starsText(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** Level select, game-over and level-complete screens (DOM overlays above the canvas). */
export class Screens {
  private readonly menu = el('div');
  private readonly result = el('div');
  private readonly menuBtn = el('button', '', '☰');
  /** Online play takes over the menu button (leave dialog instead of the local menu). */
  private view: 'home' | 'panel' | 'levels' | null = null;
  menuHook: (() => boolean) | null = null;
  /** Other full screens (friends, settings) register here so the corner icons can close them. */
  readonly overlayClosers: Array<() => boolean> = [];
  onPlay: (() => void) | null = null;
  onFriend: (() => void) | null = null;
  onSettings: ((back: () => void) => void) | null = null;
  onPrivacy: ((back: () => void) => void) | null = null;
  onFriends: ((back: () => void) => void) | null = null;
  friendsCount: () => number = () => 0;

  constructor(private readonly scene: GameScene) {
    this.menu.id = 'menu';
    this.menu.className = 'screen hidden';
    this.menu.dataset.testid = 'menu-screen';
    this.result.id = 'result';
    this.result.className = 'screen hidden';
    this.result.dataset.testid = 'result-screen';
    this.menuBtn.id = 'menu-btn';
    this.menuBtn.title = 'Menu';
    this.menuBtn.dataset.testid = 'menu-button';
    this.menuBtn.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      if (this.menuHook?.()) return;
      const open = this.overlayClosers.some((f) => f());
      if (open) return this.showPanel();
      if (!this.menu.classList.contains('hidden') && this.view === 'panel') {
        if (this.scene.state.tick > 0 && !this.scene.state.gameOver && !this.scene.state.finished) this.hideAll();
        else this.showMenu();
        return;
      }
      this.showPanel();
    });
    document.body.append(this.menu, this.result, this.menuBtn);
    scene.onEnd = (kind) => this.showResult(kind);
  }

  hideAll(): void {
    this.view = null;
    this.menu.classList.add('hidden');
    this.result.classList.add('hidden');
    this.scene.paused = false;
  }

  start(def: LevelDef): void {
    sfx.unlock();
    keepScreenOn();
    this.hideAll();
    this.scene.startLevel(def);
  }

  continueDef(): LevelDef {
    const p = loadProgress();
    const open = CAMPAIGN.find((l) => !p.levels[l.id]);
    return open ?? CAMPAIGN[CAMPAIGN.length - 1]!;
  }

  showMenu(levels = false): void {
    this.view = levels ? 'levels' : 'home';
    keepScreenOn();
    const p = loadProgress();
    this.scene.paused = true;
    this.result.classList.add('hidden');
    this.menu.replaceChildren();
    const card = el('div', 'card');
    const running = this.scene.state.tick > 0 && !this.scene.state.gameOver && !this.scene.state.finished;
    if (levels) {
      card.append(el('h2', '', 'Levels'));
      const tv = el('button', 'primary', 'TV Studio');
      tv.dataset.testid = 'btn-tvstudio';
      tv.addEventListener('click', () => {
        sfx.click();
        this.start(levelById('s1'));
      });
      const bh = el('button', 'primary', 'Boathouse');
      bh.dataset.testid = 'btn-boathouse';
      bh.addEventListener('click', () => {
        sfx.click();
        this.start(levelById('b1'));
      });
      card.append(tv, bh);
      const row = el('div', 'levels');
      for (const d of CAMPAIGN) {
        const b = el('button', 'level');
        b.dataset.testid = `level-${d.id}`;
        const rec = p.levels[d.id];
        b.append(el('b', '', d.name), el('span', 'stars', starsText(rec?.stars ?? 0)), el('small', '', rec ? `Best ${rec.best}` : d.blurb));
        b.addEventListener('click', () => {
          sfx.click();
          this.start(d);
        });
        row.append(b);
      }
      card.append(row);
      const back = el('button', 'plain', 'Back');
      back.dataset.testid = 'levels-back';
      back.addEventListener('click', () => {
        sfx.click();
        this.showPanel();
      });
      card.append(back);
      this.menu.append(card);
      this.menu.classList.remove('hidden');
      return;
    }
    card.append(el('h1', 'title', 'Dum & Dee'));
    const started = !!p.levels[CAMPAIGN[0]!.id] || Object.keys(p.levels).length > 0;
    const cont = this.continueDef();
    const play = el('button', 'primary huge', started ? 'Continue' : 'Play');
    play.dataset.testid = 'btn-play';
    if (started) play.append(el('small', '', cont.name));
    play.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      if (this.onPlay) this.onPlay();
      else this.start(started ? cont : CAMPAIGN[0]!);
    });
    const friend = el('button', 'big', 'Play with a friend');
    friend.dataset.testid = 'btn-friend';
    const badge = el('span', 'badge hidden');
    badge.dataset.testid = 'friends-badge';
    const fc = this.friendsCount();
    badge.textContent = String(fc);
    badge.classList.toggle('hidden', fc === 0);
    friend.append(badge);
    friend.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.menu.classList.add('hidden');
      this.onFriend?.();
    });
    card.append(play, friend);
    this.menu.append(card);
    this.menu.classList.remove('hidden');
  }

  /** True while a menu, result or other full screen is open. */
  hasPausedUI(): boolean {
    return !this.menu.classList.contains('hidden') || !this.result.classList.contains('hidden');
  }

  /** Which menu screen is on top right now, or null while playing. */
  currentView(): 'home' | 'panel' | 'levels' | null {
    return this.menu.classList.contains('hidden') ? null : this.view;
  }

  /** Return to a screen remembered with currentView(); null means back into the game. */
  restoreView(v: 'home' | 'panel' | 'levels' | null): void {
    if (v === 'panel') this.showPanel();
    else if (v === 'home') this.showMenu();
    else if (v === 'levels') this.showMenu(true);
    else this.hideAll();
  }

  /** The ☰ menu: everything that is not "Play" or "Play with a friend". */
  showPanel(): void {
    this.view = 'panel';
    keepScreenOn();
    this.scene.paused = true;
    this.result.classList.add('hidden');
    const card = el('div', 'card narrow');
    card.append(el('h2', '', 'Menu'));
    const running = this.scene.state.tick > 0 && !this.scene.state.gameOver && !this.scene.state.finished;
    const add = (label: string, id: string, fn: () => void, cls = ''): void => {
      const b = el('button', cls, label);
      b.dataset.testid = id;
      b.addEventListener('click', () => {
        sfx.unlock();
        sfx.click();
        fn();
      });
      card.append(b);
    };
    if (running) add('Resume', 'panel-resume', () => this.hideAll(), 'primary');
    add('∞ Endless', 'btn-endless', () => this.start(levelById('endless')));
    add('TV Studio', 'panel-tvstudio', () => this.start(levelById('s1')));
    add('Boathouse', 'panel-boathouse', () => this.start(levelById('b1')));
    add('Levels', 'btn-levels', () => this.showMenu(true));
    add('Friends', 'btn-friends', () => {
      const v = this.view;
      this.menu.classList.add('hidden');
      this.onFriends?.(() => this.restoreView(v === 'levels' ? 'panel' : v));
    });
    add('Settings', 'panel-settings', () => {
      const v = this.view;
      this.menu.classList.add('hidden');
      this.onSettings?.(() => this.restoreView(v));
    });
    add('Privacy', 'panel-privacy', () => {
      const v = this.view;
      this.menu.classList.add('hidden');
      this.onPrivacy?.(() => this.restoreView(v));
    });
    add('Home', 'panel-home', () => this.showMenu(), 'plain');
    this.menu.replaceChildren(card);
    this.menu.classList.remove('hidden');
  }

  showResult(kind: 'gameover' | 'complete'): void {
    const s = this.scene.state;
    const def = this.scene.levelDef;
    this.scene.paused = true;
    const card = el('div', 'card');
    let next: LevelDef | undefined;
    if (kind === 'complete' && s.result) {
      recordLevel(def.id, s.result.stars, s.result.score);
      next = nextLevel(def.id);
      card.append(el('h2', '', 'Level complete!'), el('div', 'bigstars', starsText(s.result.stars)));
      const r = s.result;
      card.append(
        el('p', 'big', `Score ${r.score}`),
        el('p', '', `${def.theme === 'boathouse' ? 'Hull' : 'Water'} ${r.water}% (+${r.waterBonus}) · Lives (+${r.lifeBonus}) · Time ${r.time.toFixed(0)}s (+${r.timeBonus})`),
        el('p', '', `Best combo ${r.bestCombo}`),
      );
    } else {
      if (def.endless) recordEndless(def.id, s.distance, Math.floor(s.score));
      card.append(el('h2', '', 'Game over'), el('p', 'big', `Score ${Math.floor(s.score)}`));
      card.append(el('p', '', def.endless ? `Distance ${s.distance} m · Best combo ${s.bestCombo}` : `${def.name} · Best combo ${s.bestCombo}`));
    }
    const row = el('div', 'buttons');
    if (next) {
      const nb = el('button', 'primary', next.theme !== def.theme ? `Next: ${next.name} (${next.theme === 'boathouse' ? 'Boathouse' : 'TV Studio'})` : 'Next level');
      nb.dataset.testid = 'btn-next';
      nb.addEventListener('click', () => {
        sfx.click();
        this.start(next!);
      });
      row.append(nb);
    }
    const again = el('button', next ? '' : 'primary', kind === 'complete' ? 'Retry' : 'Play again');
    again.dataset.testid = 'btn-again';
    again.addEventListener('click', () => {
      sfx.click();
      this.start(def);
    });
    const menu = el('button', '', 'Menu');
    menu.dataset.testid = 'btn-menu';
    menu.addEventListener('click', () => {
      sfx.click();
      this.showMenu();
    });
    row.append(again, menu);
    card.append(row);
    this.result.replaceChildren(card);
    this.result.classList.remove('hidden');
  }
}
