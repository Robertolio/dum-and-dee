import { CAMPAIGN, levelById, type LevelDef } from '@dd/sim';
import { normalizeCode, type EndMsg, type Seat } from '@dd/net';
import type { GameScene } from '../scenes/GameScene';
import type { Screens } from './screens';
import type { FriendView } from '../net/social';
import { OnlineClient, type OnlineEvent, type RoomView } from '../net/online';
import { sfx } from '../audio/sfx';
import { keepScreenOn } from '../platform/wakelock';
import { loadProgress, recordLevel } from '../progress';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const tid = <T extends HTMLElement>(e: T, id: string): T => {
  e.dataset.testid = id;
  return e;
};

const ERRORS: Record<string, string> = {
  no_such_room: 'That room does not exist (anymore). Check the code.',
  room_full: 'That room is already full.',
  in_progress: 'That game has already started.',
  server_full: 'The server is full right now. Try again in a minute.',
  rate_limited: 'Too many new rooms. Wait a minute and try again.',
  connect_failed: 'Could not reach the game server.',
};
const CLOSED: Record<string, string> = {
  partner_left: 'Your partner left the game.',
  timeout: 'Your partner did not come back in time, so the room was closed.',
  idle: 'The room was closed after a long time without activity.',
  server: 'The room was closed by the server.',
  connection_lost: 'Connection lost. The game could not be resumed.',
};

/** Online two-device play: entry, lobby (code, QR, share, seats, ready), countdown, pause, results. */
export class OnlineUI {
  readonly client = new OnlineClient();
  private readonly root = el('div', 'screen hidden');
  private readonly overlay = el('div', 'online-overlay hidden');
  private readonly badge = el('div', 'net-badge hidden');
  private room: RoomView | null = null;
  private countAt = 0;
  private countTimer = 0;
  private pauseUntil = 0;
  private inGame = false;
  private error = '';
  private lastLevelSent = '';
  private setupSent = false;
  private autoReady = true;
  private partnerName = '';
  private resultBox: HTMLElement | null = null;
  private inviteAfterCreate: FriendView | null = null;
  private inviteNote: { name: string; delivered: 'live' | 'push' | 'none' | 'pending' } | null = null;

  constructor(private readonly scene: GameScene, private readonly screens: Screens) {
    this.root.id = 'online';
    this.root.dataset.testid = 'online-screen';
    this.overlay.id = 'online-overlay';
    this.badge.dataset.testid = 'net-badge';
    document.body.append(this.root, this.overlay, this.badge);
    this.client.on((e) => this.onEvent(e));
    screens.menuHook = () => this.onMenuButton();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.client.wake();
    });
    window.addEventListener('pageshow', () => this.client.wake());
    window.addEventListener('online', () => this.client.wake());
    window.setInterval(() => this.updateBadge(), 1000);
    (window as unknown as { __online?: OnlineUI }).__online = this;
  }

  get active(): boolean {
    return this.client.status !== 'idle';
  }

  // ---- entry points ----

  private showNotice(text: string): void {
    this.scene.paused = true;
    const card = el('div', 'card narrow');
    const ok = tid(el('button', 'primary', 'OK'), 'online-notice-ok');
    ok.addEventListener('click', () => {
      sfx.click();
      this.root.classList.add('hidden');
      this.screens.showMenu();
    });
    card.append(tid(el('h2', '', text), 'online-error'), ok);
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }


  /** 'Play with <name>': open a room and tell the friend (live, push, or a WhatsApp nudge as last resort). */
  playWith(friend: FriendView): void {
    this.scene.paused = true;
    this.resetFlow();
    this.inviteAfterCreate = friend;
    this.partnerName = friend.name;
    this.inviteNote = { name: friend.name, delivered: 'pending' };
    this.client.create();
    this.showWait('Creating game…');
  }

  joinFromLink(code: string, partner = ''): void {
    const c = normalizeCode(code);
    this.scene.paused = true;
    if (!c) {
      this.showNotice('That game is not open (anymore).');
      return;
    }
    this.resetFlow();
    this.partnerName = partner;
    this.inviteNote = null;
    this.client.join(c);
    this.showWait('Joining…');
  }

  /** After a reload (or iOS killing the tab): quietly rejoin the saved room. */
  resumeSaved(): boolean {
    const s = OnlineClient.savedSession();
    if (!s) return false;
    this.scene.paused = true;
    this.resetFlow();
    this.client.join(s.room, s.token);
    this.showWait('Reconnecting…');
    return true;
  }

  private showWait(text: string): void {
    const card = el('div', 'card');
    card.append(el('h2', '', text));
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }

  // ---- events ----

  private onEvent(e: OnlineEvent): void {
    switch (e.type) {
      case 'invite_sent':
        if (this.inviteNote) this.inviteNote.delivered = e.delivered;
        if (this.room?.phase === 'lobby') this.renderLobby();
        break;
      case 'room':
        this.room = e.room;
        if (this.inviteAfterCreate && e.room.phase === 'lobby') {
          this.client.invite(this.inviteAfterCreate.id);
          this.inviteAfterCreate = null;
        }
        if (e.room.phase === 'lobby') {
          if (this.inGame && !this.resultBox) this.leaveGameView();
          this.renderLobby();
        } else if (e.room.phase === 'countdown') this.renderLobby();
        else if (e.room.phase === 'paused') this.showPause(this.pauseUntil || performance.now() + 60000);
        break;
      case 'count':
        this.countAt = e.at;
        this.showCountdown();
        break;
      case 'start':
        this.startGame(e.level, e.sync);
        break;
      case 'end':
        this.showResult(e.end);
        break;
      case 'pause':
        this.pauseUntil = performance.now() + (e.until - this.client.serverNow());
        this.showPause(this.pauseUntil);
        break;
      case 'resume':
        this.hidePause();
        break;
      case 'closed':
        this.showClosed(CLOSED[e.reason] ?? 'The game was closed.');
        break;
      case 'error':
        this.error = ERRORS[e.code] ?? `Error: ${e.code}`;
        if (e.code === 'connect_failed' || e.code === 'no_such_room' || e.code === 'room_full' || e.code === 'in_progress' || e.code === 'server_full' || e.code === 'rate_limited') {
          this.client.leave();
          this.showNotice(this.error);
        }
        break;
      case 'status':
        if (e.status === 'reconnecting' && this.inGame) this.showPause(performance.now() + 60000, 'Reconnecting…');
        if (e.status === 'open' && this.inGame && this.room?.phase !== 'paused') this.hidePause();
        break;
    }
  }

  private onMenuButton(): boolean {
    if (!this.active) return false;
    this.showLeaveDialog();
    return true;
  }

  private showLeaveDialog(): void {
    this.overlay.replaceChildren();
    const card = el('div', 'card');
    card.append(el('h2', '', 'Leave the game?'), el('p', 'sub', 'Your partner will be told that you left.'));
    const row = el('div', 'buttons');
    const stay = tid(el('button', 'primary', 'Stay'), 'online-stay');
    stay.addEventListener('click', () => this.overlay.classList.add('hidden'));
    const leave = tid(el('button', '', 'Leave'), 'online-leave');
    leave.addEventListener('click', () => {
      this.overlay.classList.add('hidden');
      this.leaveToMenu();
    });
    row.append(stay, leave);
    card.append(row);
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove('hidden');
  }

  private leaveToMenu(): void {
    this.inviteNote = null;
    this.client.leave();
    this.leaveGameView();
    this.root.classList.add('hidden');
    this.screens.showMenu();
  }

  private leaveGameView(): void {
    this.inGame = false;
    this.scene.stopOnline();
    this.scene.paused = true;
    this.overlay.classList.add('hidden');
    this.badge.classList.add('hidden');
  }

  // ---- waiting (there is no lobby: host is Dum, the other is Dee, the game starts by itself) ----

  private resetFlow(): void {
    this.setupSent = false;
    this.autoReady = true;
    this.lastLevelSent = '';
    clearInterval(this.countTimer);
  }

  private autoSetup(r: RoomView, both: boolean): void {
    if (!this.setupSent) {
      this.setupSent = true;
      this.client.setCtl(this.scene.controller.settings().posture);
      if (r.you === r.host) this.sendLevel();
    }
    if (this.autoReady && both && r.phase === 'lobby' && !r.seats[r.you]?.ready) this.client.setReady(true);
  }

  private renderLobby(): void {
    const r = this.room;
    if (!r) return;
    this.scene.paused = true;
    this.screens.hideAll();
    this.scene.paused = true;
    const both = !!(r.seats[0]?.connected && r.seats[1]?.connected);
    this.autoSetup(r, both);
    if (r.phase === 'countdown') {
      this.showCountdown();
      return;
    }
    const card = el('div', 'card narrow');
    const host = r.you === r.host;
    const name = this.partnerName;
    const title = both ? 'Get ready…' : host ? (name ? `Waiting for ${name}…` : 'Waiting for your friend…') : 'Joining…';
    card.append(tid(el('h2', '', title), 'wait-title'), el('p', 'sub', `You are ${r.you === 0 ? 'Dum (left)' : 'Dee (right)'}`));
    if (host && this.inviteNote && !both) card.append(this.inviteNoteEl(`${location.origin}/?room=${r.code}`));
    if (both && !this.autoReady) {
      const go = tid(el('button', 'primary big', 'Play again'), 'online-play-again');
      go.addEventListener('click', () => {
        sfx.unlock();
        sfx.click();
        this.autoReady = true;
        this.client.setReady(true);
        this.renderLobby();
      });
      card.append(go);
    }
    const cancel = tid(el('button', 'link', both && !this.autoReady ? 'Leave' : 'Cancel'), 'wait-cancel');
    cancel.addEventListener('click', () => {
      sfx.click();
      this.leaveToMenu();
    });
    card.append(cancel);
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }

  private showCountdown(): void {
    const card = el('div', 'card narrow');
    card.append(el('p', 'sub', 'Get your thumb ready'), tid(el('div', 'bigcount'), 'online-count'));
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
    this.startCountdown();
  }

  private inviteNoteEl(link: string): HTMLElement {
    const n = this.inviteNote!;
    const box = tid(el('div', 'invite-note'), 'wait-invite-note');
    if (n.delivered === 'pending') {
      box.append(el('small', '', `Telling ${n.name}…`));
    } else if (n.delivered === 'none') {
      box.append(el('small', '', `${n.name} is offline and has no notifications on. Send a nudge:`));
      const wa = tid(el('a', 'btn wa', `WhatsApp ${n.name}`), 'lobby-nudge');
      wa.href = `https://wa.me/?text=${encodeURIComponent(`I am waiting in Dum & Dee! Join me: ${link}`)}`;
      wa.target = '_blank';
      wa.rel = 'noopener';
      box.append(wa);
    } else box.append(el('small', '', n.delivered === 'live' ? `${n.name} is online and sees your invite.` : `${n.name} got a notification.`));
    return box;
  }

  private sendLevel(): void {
    const id = this.screens.continueDef().id;
    this.lastLevelSent = id;
    this.client.setLevel(id);
  }


  // ---- countdown / game ----

  private startCountdown(): void {
    clearInterval(this.countTimer);
    const tick = (): void => {
      const box = this.root.querySelector<HTMLElement>('[data-testid="online-count"]');
      if (!box) return;
      const left = Math.ceil((this.countAt - this.client.serverNow()) / 1000);
      box.classList.toggle('hidden', left <= 0);
      box.textContent = left > 0 ? String(Math.min(3, left)) : '';
      if (left <= 0) clearInterval(this.countTimer);
    };
    tick();
    this.countTimer = window.setInterval(tick, 100);
  }

  private startGame(level: string, sync: NonNullable<OnlineClient['sync']>): void {
    clearInterval(this.countTimer);
    keepScreenOn();
    const def: LevelDef = levelById(level);
    this.inGame = true;
    this.root.classList.add('hidden');
    this.overlay.classList.add('hidden');
    this.resultBox = null;
    this.screens.hideAll();
    this.scene.startOnline(def, sync);
    this.lastLevelSent = '';
    this.setupSent = true;
    this.updateBadge();
  }

  private showPause(until: number, title = 'Waiting for partner…'): void {
    this.overlay.replaceChildren();
    const card = el('div', 'card');
    const h = tid(el('h2', '', title), 'online-pause');
    const left = el('p', 'sub');
    const upd = (): void => {
      left.textContent = `The game continues when they are back. Closing in ${Math.max(0, Math.ceil((until - performance.now()) / 1000))} s.`;
    };
    upd();
    const t = window.setInterval(() => {
      if (this.overlay.classList.contains('hidden')) clearInterval(t);
      else upd();
    }, 500);
    const leave = tid(el('button', 'link', 'Leave'), 'online-leave-paused');
    leave.addEventListener('click', () => this.leaveToMenu());
    card.append(h, left, leave);
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove('hidden');
  }

  private hidePause(): void {
    if (this.resultBox) return;
    this.overlay.classList.add('hidden');
  }

  private showResult(end: EndMsg): void {
    const def = this.scene.levelDef;
    if (end.kind === 'complete' && end.result) recordLevel(def.id, end.result.stars, end.result.score);
    this.scene.stopOnline();
    this.scene.paused = true;
    const card = el('div', 'card');
    if (end.kind === 'complete' && end.result) {
      card.append(el('h2', '', 'Level complete!'), el('div', 'bigstars', '★'.repeat(end.result.stars) + '☆'.repeat(3 - end.result.stars)), el('p', 'big', `Score ${end.result.score}`));
    } else {
      card.append(el('h2', '', 'Game over'), el('p', 'big', `Score ${end.score}`), el('p', '', `Distance ${end.distance} m`));
    }
    this.autoReady = false;
    const back = tid(el('button', 'primary', 'Play again'), 'online-result-back');
    back.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.overlay.classList.add('hidden');
      this.resultBox = null;
      this.inGame = false;
      this.badge.classList.add('hidden');
      this.autoReady = true;
      this.sendLevel();
      this.client.setReady(true);
      if (this.room) this.renderLobby();
    });
    const leave = tid(el('button', 'link', 'Leave'), 'online-result-leave');
    leave.addEventListener('click', () => this.leaveToMenu());
    card.append(back, leave);
    this.resultBox = tid(card, 'online-result');
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove('hidden');
  }

  private showClosed(text: string): void {
    this.leaveGameView();
    this.resultBox = null;
    const card = el('div', 'card');
    const ok = tid(el('button', 'primary', 'OK'), 'online-closed-ok');
    ok.addEventListener('click', () => {
      this.overlay.classList.add('hidden');
      this.root.classList.add('hidden');
      this.screens.showMenu();
    });
    card.append(tid(el('h2', '', 'Game closed'), 'online-closed'), el('p', 'sub', text), ok);
    this.root.classList.add('hidden');
    this.overlay.replaceChildren(card);
    this.overlay.classList.remove('hidden');
  }

  private updateBadge(): void {
    if (!this.inGame) {
      this.badge.classList.add('hidden');
      return;
    }
    const s = this.client.status;
    this.badge.textContent = s === 'open' ? `Online · ${this.client.pingMs} ms` : s === 'reconnecting' ? 'Reconnecting…' : 'Offline';
    this.badge.classList.remove('hidden');
  }
}
