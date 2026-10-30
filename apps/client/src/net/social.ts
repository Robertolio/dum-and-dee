import { clearIdentity, loadIdentity, saveIdentity } from '../social/identity';
import { wsUrl } from './online';

export interface FriendView {
  id: string;
  name: string;
  online: boolean;
  team: { name: string; custom: boolean; pending: null | { name: string; by: 'me' | 'them' } };
}
export interface MeView {
  id: string;
  name: string;
  code: string;
  friends: FriendView[];
  incoming: Array<{ id: string; name: string }>;
  outgoing: Array<{ id: string; name: string }>;
  blocked: Array<{ id: string; name: string }>;
  invites: Array<{ id: string; from: string; name: string; room: string }>;
}

export type SocialEvent =
  | { type: 'me'; me: MeView }
  | { type: 'invite'; id: string; name: string; room: string }
  | { type: 'error'; code: string }
  | { type: 'auth_fail' }
  | { type: 'deleted' }
  | { type: 'status'; connected: boolean };

/** Long-lived socket for identity, friends, presence and invites. Separate from the game socket. */
export class SocialClient {
  me: MeView | null = null;
  vapid: string | null = null;
  connected = false;
  private ws: WebSocket | null = null;
  private listeners = new Set<(e: SocialEvent) => void>();
  private retry = 0;
  private timer = 0;
  private hb = 0;
  private wanted = false;
  private pendingReg: string | null = null;
  private queue: object[] = [];

  on(fn: (e: SocialEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: SocialEvent): void {
    for (const l of [...this.listeners]) l(e);
  }

  get hasIdentity(): boolean {
    return loadIdentity() !== null;
  }

  /** Connect and authenticate when this device has an identity. */
  start(): void {
    if (!loadIdentity()) return;
    this.wanted = true;
    this.open();
  }

  register(name: string): void {
    this.wanted = true;
    this.pendingReg = name;
    if (this.ws && this.ws.readyState === 1) this.send({ t: 'reg', name });
    else this.open();
  }

  /** Send now when signed in, otherwise right after the first `me`. */
  sendWhenReady(m: object): void {
    if (this.me) this.send(m);
    else this.queue.push(m);
  }

  wake(): void {
    if (!this.wanted) return;
    if (!this.ws || this.ws.readyState > 1) this.open();
    else this.send({ t: 'sync' });
  }

  stop(): void {
    this.wanted = false;
    clearTimeout(this.timer);
    clearInterval(this.hb);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setConnected(false);
    this.me = null;
  }

  send(m: object): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  private setConnected(c: boolean): void {
    if (this.connected === c) return;
    this.connected = c;
    this.emit({ type: 'status', connected: c });
  }

  private open(): void {
    if (this.ws && this.ws.readyState <= 1) return;
    clearTimeout(this.timer);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setConnected(true);
      const id = loadIdentity();
      if (this.pendingReg !== null) {
        this.send({ t: 'reg', name: this.pendingReg });
      } else if (id) this.send({ t: 'auth', token: id.token });
      clearInterval(this.hb);
      this.hb = window.setInterval(() => this.send({ t: 'sync' }), 20_000);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        this.onMessage(JSON.parse(ev.data) as Record<string, any>);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.hb);
      this.setConnected(false);
      if (this.wanted) this.schedule();
    };
    ws.onerror = () => undefined;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.timer = window.setTimeout(() => this.open(), delay);
  }

  private onMessage(m: Record<string, any>): void {
    switch (m.t) {
      case 'reg_ok':
        saveIdentity({ token: m.token, name: this.pendingReg ?? '' });
        this.pendingReg = null;
        break;
      case 'cfg':
        this.vapid = typeof m.vapid === 'string' ? m.vapid : null;
        break;
      case 'me': {
        this.me = m.me as MeView;
        const id = loadIdentity();
        if (id && id.name !== this.me.name) saveIdentity({ ...id, name: this.me.name });
        this.emit({ type: 'me', me: this.me });
        for (const q of this.queue.splice(0)) this.send(q);
        break;
      }
      case 'invite':
        this.emit({ type: 'invite', id: m.id, name: m.name, room: m.room });
        break;
      case 'soc_err':
        if (this.pendingReg !== null && String(m.code).startsWith('name_')) this.pendingReg = null;
        this.emit({ type: 'error', code: String(m.code) });
        break;
      case 'auth_fail':
        clearIdentity();
        this.me = null;
        this.wanted = false;
        this.emit({ type: 'auth_fail' });
        break;
      case 'deleted':
        clearIdentity();
        this.me = null;
        this.wanted = false;
        this.emit({ type: 'deleted' });
        break;
    }
  }
}
