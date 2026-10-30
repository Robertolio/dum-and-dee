import { LEVELS, type LevelDef } from '@dd/sim';
import type { GameScene } from '../scenes/GameScene';
import { sfx } from '../audio/sfx';
import { loadProgress, recordEndless, recordLevel } from '../progress';
import { keepScreenOn } from '../platform/wakelock';

const THEMES: Array<{ id: 'factory' | 'studio'; title: string }> = [
  { id: 'factory', title: 'Factory' },
  { id: 'studio', title: 'TV Studio' },
];

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

  showMenu(): void {
    keepScreenOn();
    const p = loadProgress();
    this.scene.paused = true;
    this.result.classList.add('hidden');
    this.menu.replaceChildren();
    const card = el('div', 'card');
    card.append(el('h2', '', 'Choose a level'));
    for (const th of THEMES) {
      const defs = LEVELS.filter((l) => l.theme === th.id);
      if (defs.length === 0) continue;
      card.append(el('h3', '', th.title));
      const row = el('div', 'levels');
      for (const d of defs.filter((l) => !l.endless)) {
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
      for (const d of defs.filter((l) => l.endless)) {
        const b = el('button', 'level endless');
        b.dataset.testid = `level-${d.id}`;
        const rec = p.endless[d.id];
        b.append(el('b', '', '∞ ' + d.name), el('span', 'stars', rec ? `${rec.bestDistance} m` : 'distance'), el('small', '', rec ? `Best score ${rec.bestScore}` : d.blurb));
        b.addEventListener('click', () => {
          sfx.click();
          this.start(d);
        });
        row.append(b);
      }
      card.append(row);
    }
    const resume = el('button', 'plain', 'Resume');
    resume.dataset.testid = 'menu-resume';
    resume.addEventListener('click', () => {
      sfx.click();
      this.hideAll();
    });
    if (this.scene.state.tick > 30 && !this.scene.state.gameOver && !this.scene.state.finished) card.append(resume);
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
      const idx = LEVELS.indexOf(def);
      next = LEVELS.slice(idx + 1).find((l) => l.theme === def.theme && !l.endless);
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
      const nb = el('button', 'primary', 'Next level');
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
