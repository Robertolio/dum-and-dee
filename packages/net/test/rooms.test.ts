import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, normalizeCode, parseClientMsg, RoomManager, type Conn, type ServerMsg } from '../src/index';

class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed: number | null = null;
  send(d: string): void {
    this.msgs.push(JSON.parse(d) as ServerMsg);
  }
  close(code = 1000): void {
    this.closed = code;
  }
  last<T extends ServerMsg['t']>(t: T): Extract<ServerMsg, { t: T }> | undefined {
    return [...this.msgs].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
  }
}

function setup(opts: Partial<ConstructorParameters<typeof RoomManager>[0]> = {}) {
  let now = 1000;
  const mgr = new RoomManager({ now: () => now, randomBytes: (n) => randomBytes(n), ...opts });
  const advance = (ms: number): void => {
    now += ms;
    mgr.tick();
  };
  const client = (ip = '1.1.1.1') => {
    const c = new FakeConn();
    const ctx = mgr.connect(c, ip)!;
    const send = (m: unknown): void => mgr.message(ctx, JSON.stringify(m));
    return { c, ctx, send };
  };
  return { mgr, advance, client, time: () => now };
}

describe('protocol validation', () => {
  it('accepts well-formed messages and rejects junk', () => {
    expect(parseClientMsg('{"t":"create","v":1}')?.t).toBe('create');
    expect(parseClientMsg('{"t":"join","room":"abc234"}')?.t).toBe('join');
    expect(parseClientMsg('{"t":"join","room":"abc0O1"}')).toBeNull();
    expect(parseClientMsg('{"t":"seat","seat":2}')).toBeNull();
    expect(parseClientMsg('{"t":"in","seq":1,"f":[{"tick":3,"push":0.6,"h":0.8,"jump":1}]}')?.t).toBe('in');
    expect(parseClientMsg('{"t":"in","seq":1,"f":[{"tick":3,"push":99,"h":0.8}]}')).toBeNull();
    expect(parseClientMsg('{"t":"in","seq":1,"f":[]}')).toBeNull();
    expect(parseClientMsg('not json')).toBeNull();
    expect(parseClientMsg('{"t":"level","id":"../etc"}')).toBeNull();
    expect(parseClientMsg('x'.repeat(5000))).toBeNull();
    expect(normalizeCode(' k7m2pq ')).toBe('K7M2PQ');
  });
});

describe('rooms', () => {
  it('creates 6-character codes without confusing letters, and they are unique and unpredictable', () => {
    const { mgr, client } = setup({ createsPerMinutePerIp: 1000, maxRooms: 1000, maxConnsPerIp: 1000, maxConns: 5000 });
    const codes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const a = client();
      a.send({ t: 'create', v: 1 });
      const code = a.c.last('joined')!.room;
      expect(code).toHaveLength(6);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      codes.add(code);
    }
    expect(codes.size).toBe(300);
    expect([...codes].join('')).not.toMatch(/[01OIL]/);
    expect(mgr.roomCount).toBe(300);
  });

  it('lobby: join, seat swap rules, ready, countdown, start', () => {
    const { advance, client } = setup();
    const a = client();
    a.send({ t: 'create', v: 1 });
    const code = a.c.last('joined')!.room;
    expect(a.c.last('joined')!.seat).toBe(0);
    const b = client('2.2.2.2');
    b.send({ t: 'join', room: code });
    expect(b.c.last('joined')!.seat).toBe(1);
    b.send({ t: 'seat', seat: 0 });
    expect(b.c.last('err')!.code).toBe('seat_taken');
    const c = client('3.3.3.3');
    c.send({ t: 'join', room: code });
    expect(c.c.last('err')!.code).toBe('room_full');
    b.send({ t: 'level', id: 'endless' });
    expect(b.c.last('err')!.code).toBe('not_host');
    a.send({ t: 'level', id: 'endless' });
    expect(a.c.last('room')!.level).toBe('endless');
    a.send({ t: 'ready', ready: true });
    expect(a.c.last('count')).toBeUndefined();
    b.send({ t: 'ready', ready: true });
    expect(a.c.last('count')).toBeDefined();
    advance(3100);
    expect(a.c.last('start')!.level).toBe('endless');
    expect(b.c.last('start')).toBeDefined();
    expect(a.c.last('room')!.phase).toBe('play');
  });

  it('unreadying during the countdown cancels it', () => {
    const { advance, client } = setup();
    const a = client();
    a.send({ t: 'create', v: 1 });
    const b = client('2.2.2.2');
    b.send({ t: 'join', room: a.c.last('joined')!.room });
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: false });
    advance(4000);
    expect(a.c.last('start')).toBeUndefined();
    expect(a.c.last('room')!.phase).toBe('lobby');
  });

  function started() {
    const s = setup();
    const a = s.client();
    a.send({ t: 'create', v: 1 });
    const code = a.c.last('joined')!.room;
    const b = s.client('2.2.2.2');
    b.send({ t: 'join', room: code });
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    s.advance(3100);
    return { ...s, a, b, code };
  }

  it('a lost connection pauses the game; reconnecting with the token resumes it', () => {
    const { mgr, advance, client, a, b, code } = started();
    mgr.disconnect(b.ctx);
    expect(a.c.last('pause')).toBeDefined();
    advance(20_000);
    const b2 = client('2.2.2.2');
    b2.send({ t: 'join', room: code, token: b.c.last('joined')!.token });
    expect(b2.c.last('joined')!.seat).toBe(1);
    expect(a.c.last('resume')).toBeDefined();
    expect(a.c.last('room')!.phase).toBe('play');
  });

  it('without reconnect the room closes after the grace period with a clear reason', () => {
    const { mgr, advance, a, b, code } = started();
    mgr.disconnect(b.ctx);
    advance(61_000);
    expect(a.c.last('closed')!.reason).toBe('timeout');
    expect(mgr.roomByCode(code)).toBeUndefined();
  });

  it('a stranger cannot hijack a seat without the token', () => {
    const { mgr, client, a, b, code } = started();
    mgr.disconnect(b.ctx);
    const x = client('9.9.9.9');
    x.send({ t: 'join', room: code });
    expect(x.c.last('err')!.code).toBe('in_progress');
    x.send({ t: 'join', room: code, token: 'f'.repeat(32) });
    expect(x.c.last('joined')).toBeUndefined();
    expect(a.c.last('pause')).toBeDefined();
  });

  it('leaving during play closes the room for the partner', () => {
    const { a, b } = started();
    a.send({ t: 'leave' });
    expect(b.c.last('closed')!.reason).toBe('partner_left');
  });

  it('idle rooms expire', () => {
    const { mgr, advance, client } = setup({ idleMs: 5000 });
    const a = client();
    a.send({ t: 'create', v: 1 });
    advance(6000);
    expect(mgr.roomCount).toBe(0);
  });

  it('limits: rooms, connections per ip, creates per minute, message floods', () => {
    const s = setup({ maxRooms: 2, createsPerMinutePerIp: 100, maxConnsPerIp: 3 });
    const mk = (ip: string) => {
      const x = s.client(ip);
      x.send({ t: 'create', v: 1 });
      return x;
    };
    mk('1.0.0.1');
    mk('1.0.0.2');
    expect(mk('1.0.0.3').c.last('err')!.code).toBe('server_full');
    const s2 = setup({ createsPerMinutePerIp: 2, maxConnsPerIp: 5 });
    for (let i = 0; i < 2; i++) s2.client('5.5.5.5').send({ t: 'create', v: 1 });
    const third = s2.client('5.5.5.5');
    third.send({ t: 'create', v: 1 });
    expect(third.c.last('err')!.code).toBe('rate_limited');
    const s3 = setup({ maxConnsPerIp: 2 });
    s3.client('6.6.6.6');
    s3.client('6.6.6.6');
    const fc = new FakeConn();
    expect(s3.mgr.connect(fc, '6.6.6.6')).toBeNull();
    expect(fc.closed).toBe(1013);
    const flood = s3.client('7.7.7.7');
    for (let i = 0; i < 100; i++) flood.ctx.conn && s3.mgr.message(flood.ctx, '{"t":"nope"}');
    expect(flood.c.closed).toBe(1008);
  });
});
