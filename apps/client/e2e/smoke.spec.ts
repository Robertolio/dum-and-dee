import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __dd: {
      getState: () => {
        tick: number;
        score: number;
        distance: number;
        lives: number;
        players: { x: number; h: number; hTarget: number; push: number }[];
        ladder: { theta: number };
        bucket: { water: number };
      };
      getSettings: () => { posture: 'analog' | 'digital'; source: 'touch' | 'keyboard' };
      setSettings: (s: { posture?: 'analog' | 'digital'; source?: 'touch' | 'keyboard' }) => void;
      lastInputs: () => { push: number; hTarget: number }[];
      reset: () => void;
    };
  }
}

type TouchPoint = { x: number; y: number; id: number };
type Cdp = Awaited<ReturnType<Page['context']>> extends infer C
  ? C extends { newCDPSession: (p: Page) => Promise<infer S> }
    ? S
    : never
  : never;

// One CDP session per page: Chrome tracks the active touch points per session.
const sessions = new WeakMap<Page, Cdp>();

async function touch(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd', points: TouchPoint[]) {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
}

async function openGame(page: Page) {
  await page.goto('/?autostart=1');
  await expect(page.locator('#game canvas')).toBeVisible();
  await page.waitForFunction(() => window.__dd !== undefined && window.__dd.getState().tick > 10);
  await page.evaluate(() => window.__dd.setSettings({ source: 'touch', posture: 'analog' }));
}

test.describe('Dum & Dee — one-screen prototype (mobile landscape)', () => {
  test('boots in landscape, simulation ticks and the HUD canvas is shown', async ({ page }) => {
    await openGame(page);
    const canvas = page.locator('#game canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(box!.height);
    const t1 = await page.evaluate(() => window.__dd.getState().tick);
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => window.__dd.getState().tick);
    expect(t2).toBeGreaterThan(t1 + 10);
    await expect(page.locator('#rotate')).toBeHidden();
  });

  test('two thumbs walk the team forward; dragging Dee down tilts the ladder (analog)', async ({ page }) => {
    await openGame(page);
    const x0 = await page.evaluate(() => window.__dd.getState().players[0]!.x);
    await touch(page, 'touchStart', [
      { x: 200, y: 300, id: 1 },
      { x: 640, y: 300, id: 2 },
    ]);
    await page.waitForTimeout(1500);
    const mid = await page.evaluate(() => {
      const s = window.__dd.getState();
      return { x: s.players[0]!.x, inputs: window.__dd.lastInputs(), theta: s.ladder.theta };
    });
    expect(mid.x).toBeGreaterThan(x0 + 1);
    expect(mid.inputs[0]!.push).toBeCloseTo(0.6, 1);
    expect(mid.inputs[1]!.push).toBeCloseTo(0.6, 1);
    expect(Math.abs(mid.theta)).toBeLessThan(0.05);

    // Dee drags down → bends → ladder tilts down toward Dee (negative angle).
    await touch(page, 'touchMove', [
      { x: 200, y: 300, id: 1 },
      { x: 640, y: 380, id: 2 },
    ]);
    await page.waitForTimeout(700);
    const bent = await page.evaluate(() => {
      const s = window.__dd.getState();
      return { hB: s.players[1]!.h, theta: s.ladder.theta, hTarget: window.__dd.lastInputs()[1]!.hTarget };
    });
    expect(bent.hTarget).toBeLessThan(0.4);
    expect(bent.hB).toBeLessThan(0.45);
    expect(bent.theta).toBeLessThan(-0.12);
    await touch(page, 'touchEnd', []);
    await page.waitForTimeout(600);
    const released = await page.evaluate(() => window.__dd.getState().players[1]!.h);
    expect(released).toBeGreaterThan(0.7); // analog: release springs back upright
  });

  test('digital mode from the debug panel: hold = upright, release = bent', async ({ page }) => {
    await openGame(page);
    await page.locator('#debug-toggle').click();
    await expect(page.locator('#debug')).toBeVisible();
    await page.getByTestId('mode-digital').click();
    expect(await page.evaluate(() => window.__dd.getSettings().posture)).toBe('digital');
    await page.locator('#debug-toggle').click();

    // Nobody touching → both bent.
    await page.waitForTimeout(700);
    const idle = await page.evaluate(() => window.__dd.getState().players.map((p) => p.h));
    expect(idle[0]).toBeLessThan(0.35);
    expect(idle[1]).toBeLessThan(0.35);

    // Dum holds → upright; Dee still bent → ladder tilts up toward Dum.
    await touch(page, 'touchStart', [{ x: 200, y: 300, id: 1 }]);
    await page.waitForTimeout(800);
    const held = await page.evaluate(() => {
      const s = window.__dd.getState();
      return { hA: s.players[0]!.h, hB: s.players[1]!.h, theta: s.ladder.theta };
    });
    expect(held.hA).toBeGreaterThan(0.7);
    expect(held.hB).toBeLessThan(0.35);
    expect(held.theta).toBeLessThan(-0.12);
    await touch(page, 'touchEnd', []);
  });

  test('keyboard mode: two players on one keyboard', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__dd.setSettings({ source: 'keyboard' }));
    const x0 = await page.evaluate(() => window.__dd.getState().players[0]!.x);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const s = window.__dd.getState();
      return { x: s.players[0]!.x, hB: s.players[1]!.h, inputs: window.__dd.lastInputs() };
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowDown');
    expect(r.x).toBeGreaterThan(x0 + 1);
    expect(r.inputs[0]!.push).toBeCloseTo(0.6, 1);
    expect(r.hB).toBeLessThan(0.4);
  });
});
