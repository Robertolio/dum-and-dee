import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { skipIdentity } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

async function open(ctx: BrowserContext, url: string): Promise<Page> {
  await skipIdentity(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('start-button').click();
  return page;
}

test.describe('Online: two devices in one room', () => {
  test('create, join by link, ready, countdown, play together, drop and reconnect, leave', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctxA = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const ctxB = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });

    const a = await open(ctxA, '/');
    await expect(a.getByTestId('btn-together')).toBeVisible();
    await a.getByTestId('btn-together').click();
    await a.getByTestId('online-new').click();
    const codeEl = a.getByTestId('lobby-code');
    await expect(codeEl).toHaveText(/^[A-Z2-9]{6}$/);
    const code = (await codeEl.textContent())!;
    await expect(a.getByTestId('lobby-qr')).toBeVisible();
    await expect(a.getByTestId('lobby-share-wa')).toHaveAttribute('href', new RegExp(`^https://wa.me/\\?text=.*room%3D${code}`));
    await expect(a.getByTestId('lobby-copy')).toBeVisible();

    const b = await open(ctxB, `/?room=${code}`);
    await expect(b.getByTestId('lobby-code')).toHaveText(code);
    await expect(a.getByTestId('lobby-seat-1')).toContainText('Partner');
    await expect(b.getByTestId('lobby-seat-1')).toContainText('You');
    await a.getByTestId('lobby-level-endless').click();
    await expect(b.getByTestId('lobby-level')).toHaveText('Endless');

    await a.getByTestId('lobby-ready').click();
    await b.getByTestId('lobby-ready').click();
    await expect(a.getByTestId('lobby-count')).toBeVisible();
    await expect(b.getByTestId('lobby-count')).toBeVisible();
    await expect(a.getByTestId('lobby-code')).toBeHidden({ timeout: 10_000 });
    await expect(b.getByTestId('lobby-code')).toBeHidden({ timeout: 10_000 });

    const hold = [{ push: 0.7, hTarget: 0.8 }, { push: 0.7, hTarget: 0.8 }];
    for (const p of [a, b]) {
      await p.waitForFunction(() => (window as any).__dd.getState().tick > 30, null, { timeout: 15_000 });
      await p.evaluate((h) => (window as any).__dd.setInputOverride(h), hold);
    }
    await a.waitForTimeout(4000);
    const sa = await a.evaluate(() => { const s = (window as any).__dd.getState(); return { tick: s.tick, x: s.players.map((p: any) => p.x), theta: s.ladder.theta }; });
    const sb = await b.evaluate(() => { const s = (window as any).__dd.getState(); return { tick: s.tick, x: s.players.map((p: any) => p.x), theta: s.ladder.theta }; });
    console.log('A', JSON.stringify(sa), 'B', JSON.stringify(sb));
    expect(sa.tick).toBeGreaterThan(150);
    expect(sb.tick).toBeGreaterThan(150);
    expect(sa.x[1]).toBeGreaterThan(sa.x[0]);
    expect(Math.abs(sa.x[0] - sb.x[0])).toBeLessThan(1.2);
    expect(Math.abs(sa.x[1] - sb.x[1])).toBeLessThan(1.2);

    // Connection of B drops: A gets the pause overlay, B reconnects by itself and play resumes.
    const tickBefore = sa.tick;
    await b.evaluate(() => ((window as any).__online.client as any).ws.close());
    await expect(a.getByTestId('online-pause')).toBeVisible({ timeout: 5000 });
    await expect(a.getByTestId('online-pause')).toContainText('Waiting for partner');
    await expect(a.getByTestId('online-pause')).toBeHidden({ timeout: 15_000 });
    await a.waitForFunction((t) => (window as any).__dd.getState().tick > t + 60, tickBefore + 0, { timeout: 15_000 });
    await b.waitForFunction((t) => (window as any).__dd.getState().tick > t + 60, tickBefore, { timeout: 15_000 });

    // A leaves: B is told nicely.
    await a.getByTestId('menu-button').click();
    await a.getByTestId('online-leave').click();
    await expect(b.getByTestId('online-closed')).toBeVisible({ timeout: 8000 });
    await ctxA.close();
    await ctxB.close();
  });

  test('a wrong room code gives a clear message', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const p = await open(ctx, '/?room=ZZZZZZ');
    await expect(p.getByTestId('online-error')).toContainText('does not exist', { timeout: 8000 });
    await ctx.close();
  });
});
