import qrcode from 'qrcode-generator';
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
  private levelMode: 'play' | 'endless' = 'play';
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

  showEntry(code = '', error = ''): void {
    this.screens.hideAll();
    this.scene.paused = true;
    const card = el('div', 'card');
    card.append(el('h2', '', 'Play together'), el('p', 'sub', 'Two phones, one ladder. One of you starts a game, the other joins with the code.'));
    const nw = tid(el('button', 'primary big', 'New game'), 'online-new');
    nw.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.inviteNote = null;
      this.client.create();
      this.showWait('Creating game…');
    });
    const input = tid(el('input', 'code-input'), 'online-code-input');
    input.placeholder = 'CODE';
    input.maxLength = 6;
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = code;
    const go = tid(el('button', 'big', 'Join'), 'online-join-go');
    const msg = tid(el('p', 'err', error), 'online-error');
    const doJoin = (): void => {
      const c = normalizeCode(input.value);
      if (!c) {
        msg.textContent = 'Enter the 6-character code.';
        return;
      }
      sfx.unlock();
      sfx.click();
      this.client.join(c);
      this.showWait('Joining…');
    };
    go.addEventListener('click', doJoin);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());
    const row = el('div', 'join-row');
    row.append(input, go);
    const back = tid(el('button', 'link', 'Back'), 'online-back');
    back.addEventListener('click', () => {
      sfx.click();
      this.root.classList.add('hidden');
      this.screens.showMenu();
    });
    card.append(nw, el('p', 'sub', 'or join a friend'), row, msg, back);
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }

  /** 'Play with <name>': open a room and tell the friend (live, push, or a WhatsApp nudge as last resort). */
  playWith(friend: FriendView): void {
    this.scene.paused = true;
    this.inviteAfterCreate = friend;
    this.inviteNote = { name: friend.name, delivered: 'pending' };
    this.client.create();
    this.showWait('Creating game…');
  }

  joinFromLink(code: string): void {
    const c = normalizeCode(code);
    this.scene.paused = true;
    if (!c) {
      this.showEntry();
      return;
    }
    this.client.join(c);
    this.showWait('Joining…');
  }

  /** After a reload (or iOS killing the tab): quietly rejoin the saved room. */
  resumeSaved(): boolean {
    const s = OnlineClient.savedSession();
    if (!s) return false;
    this.scene.paused = true;
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
          if (this.inGame) this.leaveGameView();
          this.renderLobby();
        } else if (e.room.phase === 'countdown') this.renderLobby();
        else if (e.room.phase === 'paused') this.showPause(this.pauseUntil || performance.now() + 60000);
        break;
      case 'count':
        this.countAt = e.at;
        this.startCountdown();
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
          this.showEntry('', this.error);
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

  // ---- lobby ----

  private renderLobby(): void {
    const r = this.room;
    if (!r) return;
    this.scene.paused = true;
    this.screens.hideAll();
    this.scene.paused = true;
    if (r.you === r.host && this.lastLevelSent === '') this.sendLevel();
    const link = `${location.origin}/?room=${r.code}`;
    const card = el('div', 'card lobby');
    card.append(el('h2', '', 'Play together'));
    const top = el('div', 'lobby-top');
    const left = el('div', 'lobby-left');
    left.append(el('small', '', 'Room code'), tid(el('div', 'code', r.code), 'lobby-code'));
    const row = el('div', 'share');
    const text = `Play Dum & Dee with me! ${link}`;
    const wa = tid(el('a', 'btn wa', 'Share via WhatsApp'), 'lobby-share-wa');
    wa.href = `https://wa.me/?text=${encodeURIComponent(text)}`;
    wa.target = '_blank';
    wa.rel = 'noopener';
    const copy = tid(el('button', '', 'Copy link'), 'lobby-copy');
    copy.addEventListener('click', () => {
      sfx.click();
      void navigator.clipboard?.writeText(link).then(
        () => (copy.textContent = 'Copied!'),
        () => (copy.textContent = link),
      );
    });
    row.append(wa, copy);
    if (typeof navigator.share === 'function') {
      const sh = tid(el('button', '', 'Share…'), 'lobby-share');
      sh.addEventListener('click', () => void navigator.share({ title: 'Dum & Dee', text: 'Play Dum & Dee with me!', url: link }).catch(() => undefined));
      row.append(sh);
    }
    left.append(row);
    const me = r.seats[r.you];
    const both = r.seats[0] && r.seats[1];
    const ready = tid(el('button', me?.ready ? 'primary big active' : 'primary big', me?.ready ? 'Ready ✓' : 'Ready'), 'lobby-ready');
    ready.addEventListener('click', () => {
      sfx.unlock();
      sfx.click();
      this.client.setReady(!me?.ready);
    });
    const status = tid(el('p', 'sub', this.statusText(r, !!both)), 'lobby-status');
    left.append(ready, status);
    if (this.inviteNote) left.append(this.inviteNoteEl(link, r.code));
    const qr = tid(el('canvas', 'qr'), 'lobby-qr');
    this.drawQr(qr, link);
    top.append(left, qr);
    card.append(top);

    const seats = el('div', 'seats');
    for (const s of [0, 1] as const) seats.append(this.seatCard(r, s));
    card.append(seats);

    const ctl = el('div', 'ctl');
    ctl.append(el('small', '', 'Your controls'));
    for (const m of ['analog', 'digital'] as const) {
      const b = tid(el('button', this.scene.controller.settings().posture === m ? 'active' : '', m === 'analog' ? 'Analog' : 'Digital'), `lobby-ctl-${m}`);
      b.addEventListener('click', () => {
        sfx.click();
        this.scene.controller.setSettings({ posture: m });
        this.scene.refreshHints();
        this.client.setCtl(m);
      });
      ctl.append(b);
    }
    card.append(ctl);

    const host = r.you === r.host;
    const lv = el('div', 'ctl');
    if (host) {
      const cont = this.screens.continueDef();
      const started = Object.keys(loadProgress().levels).length > 0;
      lv.append(el('small', '', 'Level'));
      const bp = tid(el('button', this.levelMode === 'play' ? 'active' : '', started ? `Continue: ${cont.name}` : `Play: ${CAMPAIGN[0]!.name}`), 'lobby-level-play');
      const be = tid(el('button', this.levelMode === 'endless' ? 'active' : '', '∞ Endless'), 'lobby-level-endless');
      bp.addEventListener('click', () => {
        sfx.click();
        this.levelMode = 'play';
        this.sendLevel();
      });
      be.addEventListener('click', () => {
        sfx.click();
        this.levelMode = 'endless';
        this.sendLevel();
      });
      lv.append(bp, be);
    } else lv.append(el('small', '', 'Level'), tid(el('b', '', levelById(r.level).name), 'lobby-level'), el('small', '', '(chosen by the host)'));
    card.append(lv);

    const leave = tid(el('button', 'link', 'Leave'), 'lobby-leave');
    leave.addEventListener('click', () => {
      sfx.click();
      this.leaveToMenu();
    });
    card.append(leave);
    const count = tid(el('div', 'countdown hidden'), 'lobby-count');
    card.append(count);
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
    if (r.phase === 'countdown') this.startCountdown();
  }

  private inviteNoteEl(link: string, code: string): HTMLElement {
    const n = this.inviteNote!;
    const box = tid(el('div', 'invite-note'), 'lobby-invite-note');
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
    void code;
    return box;
  }

  private statusText(r: RoomView, both: boolean): string {
    if (!both) return 'Waiting for your partner to join…';
    const other = r.seats[(1 - r.you) as Seat];
    if (r.seats[r.you]?.ready && !other?.ready) return 'Waiting for your partner to press Ready…';
    if (!r.seats[r.you]?.ready) return 'Press Ready when you are set.';
    return 'Starting…';
  }

  private seatCard(r: RoomView, s: Seat): HTMLElement {
    const info = r.seats[s];
    const mine = r.you === s;
    const c = tid(el('button', `seat ${s === 0 ? 'dum' : 'dee'}${mine ? ' mine' : ''}`), `lobby-seat-${s}`);
    c.append(el('b', '', s === 0 ? 'Dum' : 'Dee'));
    c.append(el('span', '', mine ? 'You' : info ? (info.connected ? 'Partner' : 'Partner (offline)') : 'Free'));
    if (info) c.append(el('small', '', `${info.ctl}${info.ready ? ' · ready' : ''}`));
    if (!info && !mine) {
      c.classList.add('free');
      c.addEventListener('click', () => {
        sfx.click();
        this.client.setSeat(s);
      });
    }
    return c;
  }

  private sendLevel(): void {
    const id = this.levelMode === 'endless' ? 'endless' : this.screens.continueDef().id;
    this.lastLevelSent = id;
    this.client.setLevel(id);
  }

  private drawQr(canvas: HTMLCanvasElement, text: string): void {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const scale = 4;
    const quiet = 2;
    const size = (n + quiet * 2) * scale;
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    canvas.style.width = '132px';
    canvas.style.height = '132px';
  }

  // ---- countdown / game ----

  private startCountdown(): void {
    clearInterval(this.countTimer);
    const tick = (): void => {
      const box = this.root.querySelector<HTMLElement>('[data-testid="lobby-count"]');
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
    const back = tid(el('button', 'primary', 'Back to lobby'), 'online-result-back');
    back.addEventListener('click', () => {
      this.overlay.classList.add('hidden');
      this.resultBox = null;
      this.inGame = false;
      this.badge.classList.add('hidden');
      if (this.room) this.renderLobby();
    });
    card.append(back);
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
