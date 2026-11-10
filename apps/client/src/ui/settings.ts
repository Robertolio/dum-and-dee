import type { GameScene } from '../scenes/GameScene';
import type { Screens } from './screens';
import { saveControls } from '../platform/controls';
import { sfx } from '../audio/sfx';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Settings behind the gear: control override (automatic by default), privacy, developer tools. */
export class SettingsUI {
  private readonly root = el('div', 'screen hidden');
  private back: (() => void) | null = null;

  constructor(private readonly scene: GameScene, private readonly screens: Screens, private readonly showPrivacy: () => void) {
    this.root.id = 'settings';
    this.root.dataset.testid = 'settings-screen';
    document.body.append(this.root);
    screens.overlayClosers.push(() => {
      const was = !this.root.classList.contains('hidden');
      this.root.classList.add('hidden');
      return was;
    });
    screens.onSettings = () => this.show();
    screens.onPrivacy = () => this.showPrivacy();
    const gear = document.getElementById('debug-toggle');
    gear?.setAttribute('aria-label', 'Settings');
    gear?.setAttribute('data-testid', 'settings-button');
    gear?.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      if (!this.root.classList.contains('hidden')) this.close();
      else this.show();
    });
  }

  private close(): void {
    this.root.classList.add('hidden');
    if (this.screens.hasPausedUI()) return;
    this.screens.showPanelOrResume();
  }

  show(): void {
    this.scene.paused = true;
    const card = el('div', 'card narrow');
    card.append(el('h2', '', 'Settings'));
    const cfg = this.scene.controller.settings();
    card.append(el('h3', '', 'Controls'), el('p', 'sub', 'Chosen automatically for this device. Change it only if it does not fit.'));
    card.append(controlsSection(this.scene, () => this.show()));
    const dev = el('button', 'link', 'Developer tools');
    dev.dataset.testid = 'settings-dev';
    dev.addEventListener('click', () => {
      document.getElementById('debug')?.classList.toggle('open');
      this.root.classList.add('hidden');
    });
    const done = el('button', 'primary', 'Done');
    done.dataset.testid = 'settings-done';
    done.addEventListener('click', () => {
      sfx.click();
      this.close();
    });
    card.append(dev, done);
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }

}

/** Touch/Keyboard and Analog/Digital buttons, shared by the gear settings and the Friends settings. */
export function controlsSection(scene: GameScene, rerender: () => void): HTMLElement {
  const box = el('div', 'ctls');
  const cfg = scene.controller.settings();
  const apply = (c: { source?: 'touch' | 'keyboard'; posture?: 'analog' | 'digital' }): void => {
    scene.controller.setSettings(c);
    saveControls(c);
    scene.refreshHints();
  };
  const mk = (label: string, id: string, active: boolean, c: { source?: 'touch' | 'keyboard'; posture?: 'analog' | 'digital' }): HTMLButtonElement => {
    const b = el('button', active ? 'active' : '', label);
    b.dataset.testid = id;
    b.addEventListener('click', () => {
      sfx.click();
      apply(c);
      rerender();
    });
    return b;
  };
  const row = el('div', 'ctl');
  row.append(mk('Touch (thumbs)', 'set-touch', cfg.source === 'touch', { source: 'touch' }), mk('Keyboard', 'set-keyboard', cfg.source === 'keyboard', { source: 'keyboard' }));
  box.append(row);
  if (cfg.source === 'touch') {
    const r2 = el('div', 'ctl');
    r2.append(mk('Analog', 'set-analog', cfg.posture === 'analog', { posture: 'analog' }), mk('Digital', 'set-digital', cfg.posture === 'digital', { posture: 'digital' }));
    box.append(r2);
  }
  return box;
}
