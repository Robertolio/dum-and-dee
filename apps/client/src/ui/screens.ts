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
  menuHook: (() => boolean) | null = null;
  onTogether: (() => void) | null = null;
  onFriends: (() => void) | null = null;
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
      this.showMenu();
    });
    document.body.append(this.menu, this.result, this.menuBtn);
    scene.onEnd = (kind) => this.showResult(kind);
  }

  hideAll(): void {
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
    keepScreenOn();
    const p = loadProgress();
    this.scene.paused = true;
    this.result.classList.add('hidden');
    this.menu.replaceChildren();
    const card = el('div', 'card');
    const running = this.scene.state.tick > 30 && !this.scene.state.gameOver && !this.scene.state.finished;
    if (levels) {
      card.append(el('h2', '', 'Levels'));
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
        this.showMenu();
      });
      card.append(back);
      this.menu.append(card);
      this.menu.classList.remove('hidden');
      return;
    }
    card.append(el('h2', '', 'Dum & Dee'));
    const cont = this.continueDef();
    const started = !!p.levels[CAMPAIGN[0]!.id] || Object.keys(p.levels).length > 0;
    const play = el('button', 'primary big', started ? 'Continue' : 'Play');
    play.dataset.testid = 'btn-play';
    play.append(el('small', '', started ? cont.name : CAMPAIGN[0]!.name));
    play.addEventListener('click', () => {
      sfx.click();
      this.start(started ? cont : CAMPAIGN[0]!);
    });
    const endless = levelById('endless');
    const er = p.endless[endless.id];
    const inf = el('button', 'big', '∞ Endless');
    inf.dataset.testid = 'btn-endless';
    inf.append(el('small', '', er ? `Best ${er.bestDistance} m` : 'Factory and studio'));
    inf.addEventListener('click', () => {
      sfx.click();
      this.start(endless);
    });
    const together = el('button', 'big', '👥 Play together');
    together.dataset.testid = 'btn-together';
    together.append(el('small', '', 'Two phones, one ladder'));
    together.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.menu.classList.add('hidden');
      this.onTogether?.();
    });
    const friends = el('button', 'big', '🤝 Friends');
    friends.dataset.testid = 'btn-friends';
    friends.append(el('small', '', 'Codes, teams, play with a friend'));
    const badge = el('span', 'badge hidden');
    badge.dataset.testid = 'friends-badge';
    const fc = this.friendsCount();
    badge.textContent = String(fc);
    badge.classList.toggle('hidden', fc === 0);
    friends.append(badge);
    friends.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.menu.classList.add('hidden');
      this.onFriends?.();
    });
    card.append(play, inf, together, friends);
    if (running) {
      const resume = el('button', 'plain', 'Resume');
      resume.dataset.testid = 'menu-resume';
      resume.addEventListener('click', () => {
        sfx.click();
        this.hideAll();
      });
      card.append(resume);
    }
    const lv = el('button', 'link', 'Levels');
    lv.dataset.testid = 'btn-levels';
    lv.addEventListener('click', () => {
      sfx.click();
      this.showMenu(true);
    });
    card.append(lv);
    this.menu.append(card);
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
        el('p', '', `Water ${r.water}% (+${r.waterBonus}) · Lives (+${r.lifeBonus}) · Time ${r.time.toFixed(0)}s (+${r.timeBonus})`),
        el('p', '', `Best combo ${r.bestCombo}`),
      );
    } else {
      if (def.endless) recordEndless(def.id, s.distance, Math.floor(s.score));
      card.append(el('h2', '', 'Game over'), el('p', 'big', `Score ${Math.floor(s.score)}`));
      card.append(el('p', '', def.endless ? `Distance ${s.distance} m · Best combo ${s.bestCombo}` : `${def.name} · Best combo ${s.bestCombo}`));
    }
    const row = el('div', 'buttons');
    if (next) {
      const nb = el('button', 'primary', next.theme !== def.theme ? `Next: ${next.name} (TV Studio)` : 'Next level');
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
