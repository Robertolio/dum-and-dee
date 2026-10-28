import Phaser from 'phaser';
import { computeGameWidth, GAME_H } from './config';
import { GameScene } from './scenes/GameScene';
import { mountDebugPanel } from './debug/panel';
import { mountStartScreen } from './ui/start';
import { mountAudioButtons } from './audio/sfx';
import type { PlayerInput } from '@dd/sim';

const width = computeGameWidth(window.innerWidth, window.innerHeight);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width,
  height: GAME_H,
  backgroundColor: '#0d2b30',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  input: {
    activePointers: 4,
  },
  audio: { noAudio: true },
  scene: [GameScene],
});

// Re-fit the game width when the aspect ratio changes (rotation, window resize on desktop).
window.addEventListener('resize', () => {
  const w = computeGameWidth(window.innerWidth, window.innerHeight);
  if (w !== game.scale.gameSize.width) game.scale.setGameSize(w, GAME_H);
  game.scale.refresh();
});

game.events.once(Phaser.Core.Events.READY, () => {
  const scene = game.scene.getScene('game') as GameScene;
  const mount = (): void => {
    mountDebugPanel(scene);
    mountAudioButtons();
    exposeTestHooks(scene);
    mountStartScreen(scene);
  };
  if (scene.scene.isActive()) mount();
  else scene.events.once(Phaser.Scenes.Events.CREATE, mount);
});

/** Hooks used by the Playwright smoke test and the recording script. Harmless in production. */
function exposeTestHooks(scene: GameScene): void {
  const api = {
    getState: () => scene.state,
    getTuning: () => scene.tuning,
    getSettings: () => scene.controller.settings(),
    setSettings: (s: Parameters<GameScene['controller']['setSettings']>[0]) => {
      scene.controller.setSettings(s);
      scene.refreshHints();
    },
    setInputOverride: (inputs: [PlayerInput, PlayerInput] | null) => scene.controller.setOverride(inputs),
    lastInputs: () => scene.lastInputs,
    reset: () => scene.reset(),
  };
  (window as unknown as { __dd: typeof api }).__dd = api;
}
