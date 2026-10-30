import type { GameScene } from '../scenes/GameScene';
import type { Screens } from './screens';
import type { OnlineUI } from './online';
import { SocialClient, type FriendView, type MeView, type SocialEvent } from '../net/social';
import { inviteFromUrl, isIos, isStandalone, loadIdentity, skipIdentity, skippedIdentity } from '../social/identity';
import { sfx } from '../audio/sfx';
import { pushSupport, enablePush, disablePush, pushEnabled } from '../social/push';

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
const btn = (text: string, id: string, onClick: () => void, cls = ''): HTMLButtonElement => {
  const b = tid(el('button', cls, text), id);
  b.type = 'button';
  b.addEventListener('click', () => {
    sfx.unlock();
    sfx.click();
    onClick();
  });
  return b;
};

const ERRORS: Record<string, string> = {
  name_length: 'Pick a name of 2 to 16 characters.',
  name_chars: 'Use letters, numbers, spaces and . - _ \' & only.',
  name_profane: 'Please pick a friendlier name.',
  bad_code: 'That does not look like a friend code. It looks like ROB-7K2.',
  unknown_code: 'No player with that code. Check it with your friend.',
  self: 'That is your own code.',
  already_friends: 'You are already friends.',
  already_sent: 'You already sent a request. Waiting for them to accept.',
  unblock_first: 'You blocked this player. Unblock first.',
  rate_limited: 'Too many tries. Wait a minute and try again.',
  not_friends: 'You are not friends (anymore).',
  not_found: 'Not found.',
  no_room: 'That game is no longer open.',
  auth_required: 'Not signed in.',
  already_registered: 'This device already has a name.',
  server: 'Something went wrong on the server. Try again.',
};

export const PRIVACY_TEXT = [
  'What we store: your chosen name, a friend code, a secret token for this device (also kept on this device), your friends list, team names, and, only if you turn on notifications, a push address of your browser. No email, no phone number, no location, no analytics.',
  'Who sees what: only the friends you accept can see your name and whether you are online. There is no search and nobody sees friends of friends.',
  'Wipe it: "Delete me" in Friends removes everything about you from the server and from this device at once. You can also renew your friend code at any time. Accounts unused for 6 months are deleted automatically.',
];

/** Identity, friends, teams, invites: onboarding, the Friends screen, the invite banner and the ?invite= landing. */
export class FriendsUI {
  readonly root = el('div', 'screen hidden');
  private readonly banner = el('div', 'invite-banner hidden');
  private readonly toastEl = el('div', 'toast hidden');
  private lists = el('div', 'flist');
  private errBox: HTMLElement | null = null;
  private addInput: HTMLInputElement | null = null;
  private dirty = false;
  private editing: string | null = null;
  private open = false;
  private liveInvites = new Map<string, { id: string; name: string; room: string }>();

  constructor(
    private readonly scene: GameScene,
    private readonly screens: Screens,
    private readonly online: OnlineUI,
    readonly social: SocialClient,
  ) {
    this.root.id = 'friends';
    this.root.dataset.testid = 'friends-screen';
    this.banner.dataset.testid = 'invite-banner';
    this.toastEl.dataset.testid = 'toast';
    document.body.append(this.root, this.banner, this.toastEl);
    social.on((e) => this.onEvent(e));
    screens.onFriends = () => this.showFriends();
    screens.friendsCount = () => this.badgeCount();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') social.wake();
    });
    window.addEventListener('pageshow', () => social.wake());
    window.addEventListener('online', () => social.wake());
    window.setInterval(() => this.renderBanner(), 1000);
    (window as unknown as { __friends?: FriendsUI }).__friends = this;
  }

  // ---- events ----

  private onEvent(e: SocialEvent): void {
    switch (e.type) {
      case 'me':
        this.updateBadge();
        this.renderBanner();
        if (this.open) {
          if (this.root.querySelector('.flist input:focus')) this.dirty = true;
          else this.renderLists();
        }
        break;
      case 'invite':
        this.liveInvites.set(e.id, e);
        sfx.click();
        this.renderBanner();
        break;
      case 'error':
        this.showError(ERRORS[e.code] ?? `Error: ${e.code}`);
        break;
      case 'auth_fail':
        this.toast('This device was signed out (the account no longer exists).');
        if (this.open) this.showOnboarding({ after: () => this.showFriends() });
        break;
      case 'deleted':
        void disablePush();
        this.toast('Everything about you was deleted from the server and from this device.');
        this.close();
        this.screens.showMenu();
        break;
      case 'status':
        break;
    }
  }

  private badgeCount(): number {
    const me = this.social.me;
    if (!me) return 0;
    return me.incoming.length + me.friends.filter((f) => f.team.pending?.by === 'them').length + me.invites.length;
  }

  private updateBadge(): void {
    const b = document.querySelector<HTMLElement>('[data-testid="friends-badge"]');
    if (!b) return;
    const n = this.badgeCount();
    b.textContent = String(n);
    b.classList.toggle('hidden', n === 0);
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    window.setTimeout(() => this.toastEl.classList.add('hidden'), 4500);
  }

  private showError(text: string): void {
    if (this.errBox) this.errBox.textContent = text;
    else this.toast(text);
  }

  // ---- invite banner ----

  private renderBanner(): void {
    const me = this.social.me;
    const items = new Map<string, { id: string; name: string; room: string }>();
    for (const i of me?.invites ?? []) items.set(i.id, i);
    for (const i of this.liveInvites.values()) items.set(i.id, i);
    const first = [...items.values()][0];
    if (!first || this.online.active) {
      this.banner.classList.add('hidden');
      return;
    }
    if (this.banner.dataset.invite === first.id && !this.banner.classList.contains('hidden')) return;
    this.banner.dataset.invite = first.id;
    this.banner.replaceChildren(
      el('span', '', `${first.name} is waiting`),
      btn('Join', 'invite-join', () => {
        this.liveInvites.delete(first.id);
        this.social.send({ t: 'invite_dismiss', id: first.id });
        this.banner.classList.add('hidden');
        this.screens.hideAll();
        this.close();
        this.online.joinFromLink(first.room);
      }, 'primary'),
      btn('✕', 'invite-dismiss', () => {
        this.liveInvites.delete(first.id);
        this.social.send({ t: 'invite_dismiss', id: first.id });
        this.banner.classList.add('hidden');
      }, 'x'),
    );
    this.banner.classList.remove('hidden');
  }

  // ---- first start / landing ----

  /** Called when the player presses Start. Shows the invite explanation or onboarding when needed, then `proceed`. */
  afterStart(proceed: () => void): void {
    const invite = inviteFromUrl();
    if (invite && !loadIdentity() && !isStandalone() && isIos()) {
      this.showIosInvite(invite, proceed);
      return;
    }
    if (!loadIdentity() && !skippedIdentity()) {
      this.showOnboarding({ invite, after: proceed });
      return;
    }
    if (invite && loadIdentity()) this.social.sendWhenReady({ t: 'fr_add', code: invite });
    proceed();
  }

  private showIosInvite(code: string, proceed: () => void): void {
    this.scene.paused = true;
    const card = el('div', 'card narrow');
    const body = el('div');
    const first = (): void => {
      body.replaceChildren(
        el('h2', '', 'You were invited'),
        tid(el('p', 'sub', `New here? Tap Share, then "Add to Home Screen". Open Dum & Dee from your home screen and enter code ${code}.`), 'invite-ios-new'),
        btn('I already have the app', 'invite-ios-have', second, 'link'),
      );
    };
    const second = (): void => {
      body.replaceChildren(
        el('h2', '', 'Open the app'),
        tid(el('p', 'sub', `Open the Dum & Dee app from your home screen and enter code ${code}.`), 'invite-ios-app'),
        btn('Back', 'invite-ios-back', first, 'link'),
      );
    };
    first();
    const copy = btn(`Copy code ${code}`, 'invite-ios-copy', () => {
      void navigator.clipboard?.writeText(code).then(() => (copy.textContent = 'Copied!'), () => undefined);
    });
    const cont = btn('Continue in this browser instead', 'invite-ios-continue', () => {
      this.root.classList.add('hidden');
      this.showOnboarding({ invite: code, after: proceed });
    }, 'link');
    card.append(body, copy, cont);
    this.mount(card);
  }

  showOnboarding(opts: { invite?: string | null; after: () => void }): void {
    this.open = true;
    this.errBox = null;
    this.scene.paused = true;
    const card = el('div', 'card narrow');
    card.append(el('h2', '', 'Who are you?'), el('p', 'sub', 'Pick a name. Your friends see it. No email, no password: this device remembers you.'));
    const name = tid(el('input', 'text-input'), 'onb-name');
    name.placeholder = 'Your name';
    name.maxLength = 16;
    name.autocomplete = 'off';
    name.spellcheck = false;
    const code = tid(el('input', 'code-input'), 'onb-invite');
    code.placeholder = 'ROB-7K2';
    code.maxLength = 8;
    code.autocomplete = 'off';
    code.spellcheck = false;
    code.value = opts.invite ?? '';
    const codeRow = el('div', 'join-row' + (opts.invite ? '' : ' hidden'));
    codeRow.append(code);
    const err = tid(el('p', 'err'), 'onb-error');
    this.errBox = err;
    const have = btn('Have an invite code?', 'onb-have', () => codeRow.classList.toggle('hidden'), 'link');
    let waiting = false;
    const go = btn('Create my identity', 'onb-create', () => {
      if (waiting) return;
      waiting = true;
      err.textContent = '';
      this.pendingInvite = codeRow.classList.contains('hidden') ? '' : code.value.trim();
      this.social.register(name.value);
      const off = this.social.on((e) => {
        if (e.type === 'me') {
          off();
          waiting = false;
          this.close();
          if (this.pendingInvite) this.social.send({ t: 'fr_add', code: this.pendingInvite });
          this.toast(`Welcome, ${e.me.name}! Your friend code is ${e.me.code}.`);
          opts.after();
        } else if (e.type === 'error') {
          waiting = false;
          off();
        }
      });
    }, 'primary big');
    name.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
    const skip = btn('Skip for now', 'onb-skip', () => {
      skipIdentity();
      this.close();
      opts.after();
    }, 'link');
    card.append(name, go, have, codeRow, err, skip, this.privacyLink());
    this.mount(card);
  }
  private pendingInvite = '';
  private offMe: (() => void) | null = null;

  private privacyLink(): HTMLElement {
    return btn('Privacy', 'privacy-link', () => this.showPrivacy(), 'link');
  }

  showPrivacy(): void {
    const prev = [...this.root.childNodes];
    const prevHidden = this.root.classList.contains('hidden');
    const card = el('div', 'card narrow');
    card.append(el('h2', '', 'Privacy'));
    for (const t of PRIVACY_TEXT) card.append(el('p', 'sub left', t));
    card.append(
      btn('Close', 'privacy-close', () => {
        this.root.replaceChildren(...prev);
        this.root.classList.toggle('hidden', prevHidden);
      }, 'primary'),
    );
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }

  // ---- friends screen ----

  private mount(card: HTMLElement): void {
    this.screens.hideAll();
    this.scene.paused = true;
    this.root.dataset.view = '';
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
  }
  private close(): void {
    this.open = false;
    this.errBox = null;
    this.root.classList.add('hidden');
    this.root.dataset.view = '';
  }

  showFriends(): void {
    if (!loadIdentity()) {
      this.showOnboarding({ after: () => this.showFriends() });
      return;
    }
    this.open = true;
    this.screens.hideAll();
    this.scene.paused = true;
    this.social.start();
    const card = el('div', 'card friends');
    card.append(el('h2', '', 'Friends'));
    const me = this.social.me;
    const top = el('div', 'me-box');
    const name = tid(el('b', '', me?.name ?? loadIdentity()?.name ?? ''), 'friends-me-name');
    const code = tid(el('div', 'code', me?.code ?? '…'), 'friends-my-code');
    top.append(el('small', '', 'Your friend code'), code, name);
    const share = el('div', 'share');
    const copy = btn('Copy code', 'friends-copy', () => {
      const c = this.social.me?.code ?? '';
      void navigator.clipboard?.writeText(c).then(() => (copy.textContent = 'Copied!'), () => (copy.textContent = c));
    });
    const wa = tid(el('a', 'btn wa', 'Invite via WhatsApp'), 'friends-wa');
    wa.target = '_blank';
    wa.rel = 'noopener';
    const setWa = (): void => {
      const c = this.social.me?.code ?? '';
      wa.href = `https://wa.me/?text=${encodeURIComponent(inviteText(c))}`;
      code.textContent = c || '…';
    };
    setWa();
    this.offMe?.();
    this.offMe = this.social.on((e) => e.type === 'me' && setWa());
    share.append(copy, wa);
    if (typeof navigator.share === 'function') share.append(btn('Share…', 'friends-share', () => void navigator.share({ title: 'Dum & Dee', text: inviteText(this.social.me?.code ?? '') }).catch(() => undefined)));
    top.append(share);
    card.append(top);

    const add = el('div', 'join-row');
    const input = tid(el('input', 'code-input'), 'friends-add-input');
    input.placeholder = 'ROB-7K2';
    input.maxLength = 8;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.autocapitalize = 'characters';
    this.addInput = input;
    const go = btn('Add friend', 'friends-add-go', () => {
      const v = input.value.trim();
      if (!v) return;
      this.showError('');
      this.social.send({ t: 'fr_add', code: v });
      input.value = '';
      this.toast('Request sent. Your friend has to accept it.');
    });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
    add.append(input, go);
    const err = tid(el('p', 'err'), 'friends-error');
    this.errBox = err;
    card.append(el('h3', '', 'Add a friend by code'), add, err);

    this.lists = el('div', 'flist');
    card.append(this.lists);
    this.renderLists();

    const foot = el('div', 'buttons wrap');
    foot.append(
      btn('Settings', 'friends-settings', () => this.showSettings(), 'link'),
      btn('Privacy', 'friends-privacy', () => this.showPrivacy(), 'link'),
      btn('Back', 'friends-back', () => {
        this.close();
        this.screens.showMenu();
      }, 'primary'),
    );
    card.append(foot);
    this.root.dataset.view = 'friends';
    this.root.replaceChildren(card);
    this.root.classList.remove('hidden');
    this.renderBanner();
  }

  private renderLists(): void {
    this.dirty = false;
    const me = this.social.me;
    const box = this.lists;
    box.replaceChildren();
    if (!me) {
      box.append(el('p', 'sub', this.social.connected ? 'Loading…' : 'Connecting…'));
      return;
    }
    if (me.incoming.length) {
      box.append(el('h3', '', 'Requests'));
      for (const r of me.incoming) {
        const row = tid(el('div', 'frow'), `request-${r.name}`);
        row.append(el('b', '', r.name), el('span', 'grow'), btn('Accept', `accept-${r.name}`, () => this.social.send({ t: 'fr_yes', id: r.id }), 'primary'), btn('No', `decline-${r.name}`, () => this.social.send({ t: 'fr_no', id: r.id })), btn('Block', `blockreq-${r.name}`, () => this.social.send({ t: 'fr_block', id: r.id }), 'link'));
        box.append(row);
      }
    }
    box.append(el('h3', '', me.friends.length ? 'Your friends' : 'No friends yet'));
    if (!me.friends.length) box.append(el('p', 'sub', 'Share your code, or enter your friend\'s code above.'));
    for (const f of me.friends) box.append(this.friendRow(f));
    if (me.outgoing.length) {
      box.append(el('h3', '', 'Waiting for them to accept'));
      for (const r of me.outgoing) box.append(tid(el('div', 'frow dim', r.name), `outgoing-${r.name}`));
    }
    if (me.blocked.length) {
      box.append(el('h3', '', 'Blocked'));
      for (const r of me.blocked) {
        const row = el('div', 'frow');
        row.append(el('b', '', r.name), el('span', 'grow'), btn('Unblock', `unblock-${r.name}`, () => this.social.send({ t: 'fr_unblock', id: r.id }), 'link'));
        box.append(row);
      }
    }
  }

  private friendRow(f: FriendView): HTMLElement {
    const wrap = tid(el('div', 'friend'), `friend-${f.name}`);
    const row = el('div', 'frow');
    const dot = tid(el('span', f.online ? 'dot on' : 'dot'), `online-${f.name}`);
    dot.title = f.online ? 'Online' : 'Offline';
    row.append(dot, el('b', '', f.name), el('span', 'team', f.team.name), el('span', 'grow'));
    row.append(btn(`Play with ${f.name}`, `play-${f.name}`, () => {
      this.close();
      this.online.playWith(f);
    }, 'primary'));
    const more = btn('⋯', `more-${f.name}`, () => sub.classList.toggle('hidden'), 'x');
    row.append(more);
    wrap.append(row);
    const t = f.team.pending;
    if (t && t.by === 'them') {
      const pr = tid(el('div', 'frow note'), `teamreq-${f.name}`);
      pr.append(el('span', '', `${f.name} wants to call you "${t.name}"`), el('span', 'grow'), btn('OK', `team-yes-${f.name}`, () => this.social.send({ t: 'team_yes', id: f.id }), 'primary'), btn('No', `team-no-${f.name}`, () => this.social.send({ t: 'team_no', id: f.id })));
      wrap.append(pr);
    } else if (t) {
      wrap.append(tid(el('div', 'frow note', `Waiting for ${f.name} to confirm "${t.name}"`), `teamwait-${f.name}`));
    }
    const sub = el('div', 'frow subrow hidden');
    const teamInput = tid(el('input', 'text-input small'), `team-input-${f.name}`);
    teamInput.maxLength = 24;
    teamInput.placeholder = 'Team name';
    teamInput.value = f.team.custom ? f.team.name : '';
    const setTeam = btn('Propose team name', `team-set-${f.name}`, () => {
      this.showError('');
      this.social.send({ t: 'team_set', id: f.id, name: teamInput.value });
    });
    sub.append(teamInput, setTeam);
    sub.append(btn('Remove', `remove-${f.name}`, () => {
      if (confirm(`Remove ${f.name} from your friends?`)) this.social.send({ t: 'fr_del', id: f.id });
    }, 'link'), btn('Block', `block-${f.name}`, () => {
      if (confirm(`Block ${f.name}? They are removed and cannot add you.`)) this.social.send({ t: 'fr_block', id: f.id });
    }, 'link'));
    teamInput.addEventListener('blur', () => this.dirty && this.renderLists());
    wrap.append(sub);
    return wrap;
  }

  // ---- settings ----

  private showSettings(): void {
    const me = this.social.me;
    const card = el('div', 'card narrow');
    card.append(el('h2', '', 'Settings'));
    const name = tid(el('input', 'text-input'), 'set-name');
    name.maxLength = 16;
    name.value = me?.name ?? '';
    const err = tid(el('p', 'err'), 'set-error');
    this.errBox = err;
    const row = el('div', 'join-row');
    row.append(name, btn('Rename', 'set-rename', () => {
      err.textContent = '';
      this.social.send({ t: 'rename', name: name.value });
    }));
    card.append(el('h3', '', 'Your name'), row, err);

    card.append(el('h3', '', 'Friend code'), el('p', 'sub', 'A new code makes the old one useless. Existing friends stay.'), btn('Renew my code', 'set-renew', () => {
      this.social.send({ t: 'renew' });
      this.toast('New code created.');
    }));

    card.append(el('h3', '', 'Notifications'), this.pushBox());

    card.append(el('h3', '', 'Delete me'), el('p', 'sub', 'Removes your name, friends, teams and notification address from the server and this device.'));
    const del = btn('Delete me', 'set-delete', () => {
      const c = el('div', 'frow');
      c.append(el('span', 'sub', 'Really delete everything?'), btn('Yes, delete', 'set-delete-yes', () => this.social.send({ t: 'delete_me' }), 'danger'), btn('Cancel', 'set-delete-no', () => c.remove(), 'link'));
      del.after(c);
    }, 'danger');
    card.append(del);
    card.append(btn('Back', 'set-back', () => this.showFriends(), 'primary'));
    this.root.dataset.view = 'settings';
    this.root.replaceChildren(card);
  }

  /** Push permission is asked here, on a deliberate tap, and also offered after the first friendship. */
  pushBox(): HTMLElement {
    const box = tid(el('div', 'pushbox'), 'push-box');
    const render = async (): Promise<void> => {
      const sup = pushSupport();
      box.replaceChildren();
      if (!sup.ok) {
        box.append(tid(el('p', 'sub', sup.reason), 'push-unsupported'), el('p', 'sub', 'No problem: friends who are away get a WhatsApp nudge button instead.'));
        return;
      }
      if (await pushEnabled()) {
        box.append(el('p', 'sub', 'Notifications are on: you hear about invites even when the app is closed.'), btn('Turn off', 'push-off', () => void disablePush(this.social).then(render), 'link'));
      } else {
        box.append(el('p', 'sub', 'Get a notification when a friend is waiting for you.'), btn('Turn on notifications', 'push-on', () => void enablePush(this.social).then((r) => (r === 'ok' ? render() : this.showError(r === 'denied' ? 'Notifications are blocked in your browser settings.' : r === 'novapid' ? 'Notifications are not set up on the server yet.' : 'Could not turn on notifications.'))), 'primary'));
      }
    };
    void render();
    return box;
  }
}

export const inviteText = (code: string): string => `Play Dum & Dee with me: ${location.origin}/?invite=${code} — my code is ${code}`;
export type { MeView };
