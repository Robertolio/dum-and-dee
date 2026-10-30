import { describe, expect, it } from 'vitest';
import { NetSim, SimClient, scriptedInput, startGame, type LinkOpts } from '../src/netsim';

function measure(link: LinkOpts, seconds = 20, level = 'endless') {
  const net = new NetSim(link, 7);
  const [a, b] = startGame(net, level);
  expect(a.sync?.ready).toBe(true);
  net.run(seconds * 1000);
  const err = (c: typeof a): { mean: number; max: number; theta: number } => {
    let sum = 0;
    let n = 0;
    let max = 0;
    let th = 0;
    for (const [tick, p] of c.predAt) {
      const s = net.serverHistory.get(tick);
      if (!s || tick < 300) continue;
      for (const i of [0, 1] as const) {
        const e = Math.abs(p.x[i] - s.x[i]);
        sum += e;
        n++;
        max = Math.max(max, e);
      }
      th = Math.max(th, Math.abs(p.theta - s.theta));
    }
    return { mean: sum / Math.max(1, n), max, theta: th };
  };
  // Cross-client: both predictions at the same tick should be close.
  let cross = 0;
  let crossMax = 0;
  let cn = 0;
  for (const [tick, p] of a.predAt) {
    const q = b.predAt.get(tick);
    if (!q || tick < 300) continue;
    const e = Math.abs(p.x[0] - q.x[0]) + Math.abs(p.x[1] - q.x[1]);
    cross += e;
    crossMax = Math.max(crossMax, e);
    cn++;
  }
  return { a: err(a), b: err(b), cross: cross / Math.max(1, cn), crossMax, ticks: net.serverHistory.size, lead: a.sync!.lead, hard: a.sync!.stats.hardSnaps, snaps: a.sync!.stats.snaps };
}

describe('netsim: two predicted clients against the authoritative server', () => {
  const cases: Array<[string, LinkOpts]> = [
    ['50 ms', { latency: 25, jitter: 15, loss: 0.03 }],
    ['100 ms', { latency: 50, jitter: 15, loss: 0.03 }],
    ['200 ms', { latency: 100, jitter: 15, loss: 0.03 }],
  ];
  for (const [name, link] of cases) {
    it(`stays in sync at ${name} round trip, 30 ms jitter, 3% loss`, () => {
      const r = measure(link);
      console.log(name, JSON.stringify({ errA: r.a, errB: r.b, cross: r.cross, crossMax: r.crossMax, lead: r.lead, hardSnaps: r.hard, snaps: r.snaps }));
      expect(r.ticks).toBeGreaterThan(1000);
      expect(r.snaps).toBeGreaterThan(150);
      expect(r.a.mean).toBeLessThan(0.05);
      expect(r.b.mean).toBeLessThan(0.05);
      expect(r.a.max).toBeLessThan(0.5);
      expect(r.cross).toBeLessThan(0.1);
      expect(r.crossMax).toBeLessThan(0.6);
      expect(r.hard).toBeLessThan(4);
    });
  }

  it('the sim keeps the same outcome on both clients as on the server (score and lives)', () => {
    const net = new NetSim({ latency: 50, jitter: 15, loss: 0.03 }, 3);
    const [a, b] = startGame(net, 'f1');
    net.run(15000);
    const s = (net.mgr.roomByCode(net.code) as unknown as { game: { state: { score: number; lives: number; tick: number } } }).game.state;
    expect(Math.abs(a.sync!.pred.score - s.score)).toBeLessThan(400);
    expect(Math.abs(b.sync!.pred.lives - s.lives)).toBeLessThanOrEqual(1);
  });

  it('a partner that drops out pauses the game; after reconnecting both clients converge again', () => {
    const net = new NetSim({ latency: 50, jitter: 15, loss: 0.03 }, 11);
    const [a, b] = startGame(net, 'endless');
    net.run(4000);
    const token = b.token;
    const tickBefore = net.mgr.roomByCode(net.code)!.game!.state.tick;
    b.online = false;
    net.mgr.disconnect(b.ctx!);
    net.run(6000);
    const room = net.mgr.roomByCode(net.code)!;
    expect(room.phase).toBe('paused');
    expect(a.seen.has('pause')).toBe(true);
    expect(room.game!.state.tick - tickBefore).toBeLessThan(10);
    const b2 = new SimClient(net, (t) => scriptedInput(t, 1));
    net.clients.push(b2);
    b2.send({ t: 'join', room: net.code, token });
    net.run(8000);
    expect(room.phase).toBe('play');
    expect(a.seen.has('resume')).toBe(true);
    expect(b2.seat).toBe(1);
    expect(room.game!.state.tick - tickBefore).toBeGreaterThan(200);
    let cross = 0;
    let n = 0;
    for (const [tick, p] of a.predAt) {
      const q = b2.predAt.get(tick);
      if (!q || tick < tickBefore + 150) continue;
      cross += Math.abs(p.x[0] - q.x[0]) + Math.abs(p.x[1] - q.x[1]);
      n++;
    }
    expect(n).toBeGreaterThan(100);
    expect(cross / n).toBeLessThan(0.15);
  });
});
