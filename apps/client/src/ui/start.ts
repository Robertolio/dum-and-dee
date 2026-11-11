import type { GameScene } from '../scenes/GameScene';
import type { Screens } from './screens';
import type { OnlineUI } from './online';
import type { FriendsUI } from './friends';
import { CAMPAIGN, LEVELS, levelById } from '@dd/sim';
import { toggleFullscreen } from '../platform/fullscreen';
import { initialControls } from '../platform/controls';
import { inviteFromUrl } from '../social/identity';

/**
 * Opening: no intro screen. The home menu has one big Play button; the tap that presses it also unlocks audio,
 * keeps the screen awake (inside screens.start) and goes fullscreen. Controls are picked automatically.
 */
export function mountStartScreen(scene: GameScene, screens: Screens, online?: OnlineUI, friends?: FriendsUI): void {
  const q = new URLSearchParams(location.search);
  if (q.has('autostart')) {
    screens.start(levelById(q.get('level') ?? 'endless'));
    return;
  }
  const begin = (): void => {
    scene.controller.setSettings(initialControls());
    scene.refreshHints();
    void toggleFullscreen();
    const jump = LEVELS.find((l) => l.id === q.get('level'));
    if (jump) {
      screens.start(jump);
      return;
    }
    const room = q.get('room');
    if (room && online) {
      online.joinFromLink(room);
      return;
    }
    if (online?.resumeSaved()) return;
    screens.start(screens.continueDef() ?? CAMPAIGN[0]!);
  };
  screens.onPlay = () => {
    if (inviteFromUrl() && friends) friends.afterStart(begin);
    else begin();
  };
  screens.onFriend = () => {
    scene.controller.setSettings(initialControls());
    void toggleFullscreen();
    if (inviteFromUrl() && friends) friends.afterStart(() => friends.showFriends());
    else friends?.showFriends();
  };
  screens.showMenu();
}
