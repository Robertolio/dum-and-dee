import { randomBytes } from 'node:crypto';
import { RoomManager, type Conn } from '@dd/net';
import { Hub, Social, openSqlite, type PushSender } from '../src';

export const mkClock = () => {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

export const mkSocial = async (clock = mkClock(), extra: Partial<ConstructorParameters<typeof Social>[1]> = {}) => {
  const db = await openSqlite(':memory:');
  const social = new Social(db, { now: clock.now, randomBytes: (n) => randomBytes(n), ...extra });
  return { db, social, clock };
};

export class FakeConn implements Conn {
  got: Array<Record<string, any>> = [];
  closed: number | null = null;
  send(d: string): void {
    this.got.push(JSON.parse(d));
  }
  close(code = 1000): void {
    this.closed = code;
  }
  last(t: string): Record<string, any> | undefined {
    return [...this.got].reverse().find((m) => m.t === t);
  }
}

export const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

export const mkHub = async (push?: PushSender) => {
  const clock = mkClock();
  const { social, db } = await mkSocial(clock);
  const mgr = new RoomManager({ now: clock.now, randomBytes: (n) => randomBytes(n) });
  const sent: Array<{ endpoint: string; payload: any }> = [];
  const sender: PushSender = push ?? {
    publicKey: 'PUB',
    send: async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, payload });
      return 'ok';
    },
  };
  const hub = new Hub(mgr, social, sender, { now: clock.now });
  const client = (ip = '1.1.1.1') => {
    const conn = new FakeConn();
    const hc = hub.connect(conn, ip)!;
    const say = async (m: object) => {
      hub.message(hc, JSON.stringify(m));
      await tick();
    };
    return { conn, hc, say };
  };
  return { hub, social, mgr, db, clock, client, sent };
};
