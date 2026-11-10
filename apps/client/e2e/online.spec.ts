import { expect, test } from '@playwright/test';
import { skipIdentity, twoFriends } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

test.describe('Play with a friend: no lobby, no codes', () => {
  test('Play with B -> banner -> Join -> automatic countdown, Dum/Dee, play, reconnect, leave', async ({ browser }) => {
    test.setTimeout(120_000);
    const { A, B } = await twoFriends(browser);
    const a = A.page;
    const b = B.page;

    await a.getByTestId('play-Mia').click();
    await expect(a.getByTestId('wait-title')).toContainText('Waiting for Mia');
    await expect(a.getByTestId('wait-cancel')).toBeVisible();
    await expect(a.locator('[data-testid="lobby-code"], [data-testid="lobby-qr"], [data-testid="online-code-input"]')).toHaveCount(0);

    await expect(b.getByTestId('invite-banner')).toContainText('Rob is waiting');
    await b.getByTestId('invite-join').click();

    // No further taps: both get the countdown and the game starts by itself.
    await expect(a.getByTestId('online-count')).toBeVisible({ timeout: 10_000 });
    await expect(b.getByTestId('online-count')).toBeVisible({ timeout: 10_000 });
    for (const p of [a, b]) await p.waitForFunction(() => (window as any).__dd.getState().tick > 30, null, { timeout: 15_000 });
    expect(await a.evaluate(() => (window as any).__online.client.seat)).toBe(0);
    expect(await b.evaluate(() => (window as any).__online.client.seat)).toBe(1);
    expect(await a.evaluate(() => (window as any).__dd.getState().levelLength)).toBeGreaterThan(100);

    const hold = [{ push: 0.7, hTarget: 0.8 }, { push: 0.7, hTarget: 0.8 }];
    for (const p of [a, b]) await p.evaluate((h) => (window as any).__dd.setInputOverride(h), hold);
    await a.waitForTimeout(4000);
    const snap = (p: typeof a) => p.evaluate(() => { const s = (window as any).__dd.getState(); return { tick: s.tick, x: s.players.map((q: any) => q.x) }; });
    const sa = await snap(a);
    const sb = await snap(b);
    expect(sa.tick).toBeGreaterThan(150);
    expect(Math.abs(sa.x[0] - sb.x[0])).toBeLessThan(1.2);
    expect(Math.abs(sa.x[1] - sb.x[1])).toBeLessThan(1.2);

    const tickBefore = sa.tick;
    await b.evaluate(() => ((window as any).__online.client as any).ws.close());
    await expect(a.getByTestId('online-pause')).toBeVisible({ timeout: 5000 });
    await expect(a.getByTestId('online-pause')).toBeHidden({ timeout: 15_000 });
    await a.waitForFunction((t) => (window as any).__dd.getState().tick > t + 60, tickBefore, { timeout: 15_000 });

    await a.getByTestId('menu-button').click();
    await a.getByTestId('online-leave').click();
    await expect(b.getByTestId('online-closed')).toBeVisible({ timeout: 8000 });
    await A.ctx.close();
    await B.ctx.close();
  });

  test('cancel while waiting returns to the menu', async ({ browser }) => {
    const { A, B } = await twoFriends(browser, 'Ann', 'Ben');
    await A.page.getByTestId('play-Ben').click();
    await expect(A.page.getByTestId('wait-title')).toContainText('Waiting for Ben');
    await A.page.getByTestId('wait-cancel').click();
    await expect(A.page.getByTestId('menu-screen')).toBeVisible();
    await A.ctx.close();
    await B.ctx.close();
  });

  test('a dead room link gives a clear message', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await skipIdentity(ctx);
    const p = await ctx.newPage();
    await p.goto('/?room=ZZZZZZ');
    await p.waitForFunction(() => (window as any).__dd !== undefined);
    await p.getByTestId('btn-play').click();
    await expect(p.getByTestId('online-error')).toContainText('does not exist', { timeout: 8000 });
    await ctx.close();
  });

  test('an old ?room= link joins through the simple flow, never a lobby', async ({ browser }) => {
    test.setTimeout(90_000);
    const { A, B } = await twoFriends(browser);
    await A.page.getByTestId('play-Mia').click();
    await expect(A.page.getByTestId('wait-title')).toBeVisible();
    const code = await A.page.evaluate(() => (window as any).__online.client.code as string);
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await skipIdentity(ctx);
    const p = await ctx.newPage();
    await p.goto(`/?room=${code}`);
    await p.waitForFunction(() => (window as any).__dd !== undefined);
    await p.getByTestId('btn-play').click();
    await expect(p.getByTestId('online-count')).toBeVisible({ timeout: 10_000 });
    await expect(p.locator('[data-testid^="lobby-"]:not([data-testid="lobby-nudge"]), .qr, [data-testid="online-ready"]')).toHaveCount(0);
    await ctx.close();
  });
});
