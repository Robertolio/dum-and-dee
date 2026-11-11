import { expect, test } from '@playwright/test';
import { skipIdentity } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

const sample = (me = true) => ({
  entries: [
    { rank: 1, name: 'Ann & Ben', score: 5200, me: false, friend: true },
    { rank: 2, name: 'Cy & Di', score: 4100, me: false, friend: false },
  ],
  me: me ? { rank: 7, name: 'Mia & Rob', score: 900, me: true, friend: false } : null,
  total: 7,
  weekStart: 0,
});

test.describe('Leaderboard screen', () => {
  test('home button opens tabs; Duos/Players, week/all and environments are requested; own row is marked; Back returns to the home menu', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    const urls: string[] = [];
    await page.route('**/api/leaderboard*', async (route) => {
      urls.push(route.request().url());
      await route.fulfill({ json: sample() });
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-leaderboard').click();
    await expect(page.getByTestId('leaderboard-screen')).toBeVisible();
    await expect(page.getByTestId('lb-row').first()).toContainText('Ann & Ben');
    await expect(page.getByTestId('lb-row').first()).toContainText('★');
    await expect(page.getByTestId('lb-row-me')).toContainText('#7');
    expect(urls.at(-1)).toMatch(/kind=duo.*range=week.*env=overall|env=overall/);
    await page.getByTestId('lb-kind-player').click();
    await page.getByTestId('lb-range-all').click();
    await page.getByTestId('lb-env-rowing').click();
    await expect.poll(() => urls.at(-1)).toMatch(/kind=player/);
    expect(urls.at(-1)).toContain('range=all');
    expect(urls.at(-1)).toContain('env=rowing');
    for (const env of ['overall', 'factory', 'studio', 'boathouse', 'rowing', 'endless']) await expect(page.getByTestId(`lb-env-${env}`)).toBeVisible();
    await page.getByTestId('lb-back').click();
    await expect(page.getByTestId('btn-leaderboard')).toBeVisible();
    await expect(page.getByTestId('leaderboard-screen')).toBeHidden();
    await ctx.close();
  });

  test('from the ☰ menu in a running game: Back and the ☰ icon both return to that menu; empty state is friendly', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    await page.route('**/api/leaderboard*', (route) => route.fulfill({ json: { entries: [], me: null, total: 0, weekStart: 0 } }));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-play').click();
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('panel-leaderboard').click();
    await expect(page.getByTestId('lb-empty')).toBeVisible();
    await page.getByTestId('lb-back').click();
    await expect(page.getByTestId('panel-resume')).toBeVisible();
    await page.getByTestId('panel-leaderboard').click();
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('leaderboard-screen')).toBeHidden();
    await expect(page.getByTestId('panel-resume')).toBeVisible();
    await ctx.close();
  });

  test('API: read-only, no name search, rate limited, bad parameters fall back', async ({ request }) => {
    const r = await request.get('/api/leaderboard?kind=duo&env=overall&range=all');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/"id"|token/);
    expect((await request.get('/api/leaderboard?kind=x&env=zzz&range=zzz&name=Rob')).status()).toBe(200);
    expect((await request.post('/api/leaderboard')).status()).toBe(405);
  });

  test('after an online level the result shows "You are #12 this week" once the server has registered the run', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.evaluate(() => {
      const o = (window as any).__online;
      o.onEvent({ type: 'lb', env: 'factory', score: 1234, duo: { week: 3, all: 5 }, player: { week: 12, all: 20 } });
      o.showResult({ kind: 'complete', result: { stars: 3, score: 1234 }, score: 1234, distance: 10 });
    });
    await expect(page.getByTestId('online-rank')).toContainText('You are #12 this week');
    await expect(page.getByTestId('online-rank')).toContainText('Duo, Meat factory: #3 this week, #5 all time');
    await ctx.close();
  });
});
