import type { GameScene } from '../scenes/GameScene';
import type { Screens } from './screens';
import type { OnlineUI } from './online';
import type { FriendsUI } from './friends';
import { levelById } from '@dd/sim';
import { sfx } from '../audio/sfx';
import { fullscreenSupported, toggleFullscreen } from '../platform/fullscreen';

const IOS_HINT = 'iPhone: tap Share, then "Add to Home Screen", and open Dum & Dee from the home screen for fullscreen.';
const FS_HINT = 'Tip: Start also switches to fullscreen. Keep the phone in landscape.';

/** Start screen shown before play: explains Solo mode, picks analog/digital, starts the game. */
export function mountStartScreen(scene: GameScene, screens: Screens, online?: OnlineUI, friends?: FriendsUI): void {
  const root = document.getElementById('start');
  if (!root) return;
  if (new URLSearchParams(location.search).has('autostart')) {
    root.classList.add('hidden');
    const lvl = new URLSearchParams(location.search).get('level');
    screens.start(levelById(lvl ?? 'endless'));
    return;
  }
  const analogBtn = root.querySelector<HTMLButtonElement>('[data-testid="start-analog"]')!;
  const digitalBtn = root.querySelector<HTMLButtonElement>('[data-testid="start-digital"]')!;
  const startBtn = root.querySelector<HTMLButtonElement>('#start-btn')!;
  const hint = root.querySelector<HTMLElement>('#start-hint')!;
  hint.textContent = fullscreenSupported() ? FS_HINT : IOS_HINT;

  let posture: 'analog' | 'digital' = 'analog';
  const choose = (p: 'analog' | 'digital'): void => {
    posture = p;
    analogBtn.classList.toggle('active', p === 'analog');
    digitalBtn.classList.toggle('active', p === 'digital');
  };
  analogBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    choose('analog');
  });
  digitalBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    choose('digital');
  });

  startBtn.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    scene.controller.setSettings({ source: 'touch', posture });
    scene.refreshHints();
    root.classList.add('hidden');
    const proceed = (): void => {
      const room = new URLSearchParams(location.search).get('room');
      if (room && online) online.joinFromLink(room);
      else if (!(online && online.resumeSaved())) screens.showMenu();
    };
    if (friends) friends.afterStart(proceed);
    else proceed();
    void toggleFullscreen();
  });
}
