import { expect, test, type Page } from '@playwright/test';
import { newPlayer, skipIdentity } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

const sample = (me = true) => ({
  entries: [
    { rank: 1, name: 'Ann & Ben', score: 5200, levels: 5, me: false, friend: true },
    { rank: 2, name: 'Cy & Di', score: 4100, levels: 1, me: false, friend: false },
  ],
  me: me ? { rank: 7, name: 'Mia & Rob', score: 900, levels: 2, me: true, friend: false } : null,
  total: 7,
  weekStart: 0,
});

/** A real solo run that really finishes: obstacles removed and the level cut to `length` so it ends after a fair time. */
async function finishLevel(page: Page, level: string, length: number): Promise<void> {
  await page.goto(`/?autostart=1&level=${level}`);
  await page.waitForFunction(() => (window as any).__dd !== undefined && (window as any).__dd.getState().tick > 10);
  await page.evaluate((len) => {
    const s = (window as any).__dd.getState();
    s.steps.length = 0;
    s.lamps.length = 0;
    s.softs.length = 0;
    s.beams.length = 0;
    s.levelLength = len;
    (window as any).__dd.setInputOverride([{ push: 0.9, hTarget: 0.8 }, { push: 0.9, hTarget: 0.8 }]);
  }, length);
}

const phone = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } as const;

test.describe('Leaderboard screen', () => {
  test('two tabs only (Duos, Solo), one list, own row marked, friends starred, fits the landscape screen; Back returns home', async ({ browser }) => {
    const ctx = await browser.newContext(phone);
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    const urls: string[] = [];
    await page.route('**/api/leaderboard?*', async (route) => {
      urls.push(route.request().url());
      await route.fulfill({ json: sample() });
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-leaderboard').click();
    await expect(page.getByTestId('leaderboard-screen')).toBeVisible();
    await expect(page.getByTestId('lb-row').first()).toContainText('Ann & Ben');
    await expect(page.getByTestId('lb-row').first()).toContainText('5 levels');
    await expect(page.getByTestId('lb-row').first()).toContainText('★');
    await expect(page.getByTestId('lb-row-me')).toContainText('#7');
    await expect(page.getByTestId('lb-row-me')).toContainText('2 levels');
    for (const gone of ['lb-kind-player', 'lb-range-week', 'lb-range-all', 'lb-env-overall', 'lb-env-rowing']) await expect(page.getByTestId(gone)).toHaveCount(0);
    const box = await page.locator('#leaderboard .card').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(390);
    await page.getByTestId('lb-kind-solo').click();
    await expect.poll(() => urls.at(-1)).toContain('kind=solo');
    expect(urls.at(-1)).toContain('range=all');
    await page.getByTestId('lb-back').click();
    await expect(page.getByTestId('btn-leaderboard')).toBeVisible();
    await expect(page.getByTestId('leaderboard-screen')).toBeHidden();
    await ctx.close();
  });

  test('from the ☰ menu in a running game: Back and the ☰ icon both return to that menu; empty state is short', async ({ browser }) => {
    const ctx = await browser.newContext(phone);
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    await page.route('**/api/leaderboard?*', (route) => route.fulfill({ json: { entries: [], me: null, total: 0, weekStart: 0 } }));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-play').click();
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('panel-leaderboard').click();
    await expect(page.getByTestId('lb-empty')).toHaveText('Play a level to get on the board.');
    await page.getByTestId('lb-back').click();
    await expect(page.getByTestId('panel-resume')).toBeVisible();
    await page.getByTestId('panel-leaderboard').click();
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('leaderboard-screen')).toBeHidden();
    await expect(page.getByTestId('panel-resume')).toBeVisible();
    await ctx.close();
  });

  test('API: read-only, no name search, bad parameters fall back', async ({ request }) => {
    const r = await request.get('/api/leaderboard?kind=duo&env=overall&range=all');
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/"id"|token/);
    expect((await request.get('/api/leaderboard?kind=x&env=zzz&range=zzz&name=Rob')).status()).toBe(200);
    expect((await request.post('/api/leaderboard')).status()).toBe(405);
  });

  test('after an online level the result shows the rank once the server has registered the run', async ({ browser }) => {
    const ctx = await browser.newContext(phone);
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
    await ctx.close();
  });

  test('a real solo run with a real identity ends on the list; a run that is too fast says "Unexpected score" and stays off it', async ({ browser }) => {
    test.setTimeout(120_000);
    const P = await newPlayer(browser, 'Solofin');
    const page = P.page;
    await finishLevel(page, 'f0', 100);
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('solo-rank')).toContainText('You are #', { timeout: 15_000 });
    await page.getByTestId('btn-menu').click();
    await page.getByTestId('btn-leaderboard').click();
    await page.getByTestId('lb-kind-solo').click();
    await expect(page.getByTestId('lb-row-me')).toContainText('Solofin', { timeout: 10_000 });
    await expect(page.getByTestId('lb-row-me')).toContainText('1 level');
    await expect(page.getByTestId('lb-note')).toContainText('You are #');
    const first = await page.getByTestId('lb-row-me').textContent();
    // Too fast to be true: finished in about a second.
    await finishLevel(page, 'f1', 20);
    await expect(page.getByTestId('solo-rank')).toContainText('Unexpected score', { timeout: 15_000 });
    await page.getByTestId('btn-menu').click();
    await page.getByTestId('btn-leaderboard').click();
    await page.getByTestId('lb-kind-solo').click();
    await expect(page.getByTestId('lb-row-me')).toContainText('1 level');
    expect(await page.getByTestId('lb-row-me').textContent()).toBe(first);
    await P.ctx.close();
  });

  test('leaving a Rowing race early (menu, then Leaderboard) still sends the score so far', async ({ browser }) => {
    test.setTimeout(120_000);
    const P = await newPlayer(browser, 'Rowleave');
    const page = P.page;
    await page.goto('/?autostart=1&level=r1');
    await page.waitForFunction(() => (window as any).__dd !== undefined && (window as any).__dd.getState().tick > 420, null, { timeout: 30_000 });
    await page.evaluate(() => {
      (window as any).__dd.getState().score = 1828;
    });
    await page.getByTestId('menu-button').click();
    await page.getByTestId('panel-leaderboard').click();
    await expect
      .poll(
        async () => {
          await page.getByTestId('lb-kind-duo').click();
          await page.getByTestId('lb-kind-solo').click();
          return (await page.getByTestId('lb-row-me').allTextContents()).join(' ');
        },
        { timeout: 20_000 },
      )
      .toContain('1828');
    await expect(page.getByTestId('lb-note')).toContainText('You are #');
    await P.ctx.close();
  });

  test('no name yet: the end screen asks for one, validates it, registers and still sends the score just played', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext(phone);
    await skipIdentity(ctx);
    const page = await ctx.newPage();
    await finishLevel(page, 'f0', 100);
    await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('solo-name')).toBeVisible();
    await page.getByTestId('solo-name').fill('shit');
    await page.getByTestId('solo-name-save').click();
    await expect(page.getByTestId('solo-name-error')).toContainText('friendlier');
    await page.getByTestId('solo-name').fill('Namer');
    await page.getByTestId('solo-name-save').click();
    await expect(page.getByTestId('solo-rank')).toContainText('You are #', { timeout: 15_000 });
    await expect(page.getByTestId('solo-name')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dd-id')!).name)).toBe('Namer');
    await ctx.close();
  });

  test('a server error is shown on the end screen instead of nothing', async ({ browser }) => {
    test.setTimeout(120_000);
    const P = await newPlayer(browser, 'Errplay');
    await P.page.route('**/api/leaderboard/solo', (route) => route.fulfill({ status: 500, json: { error: 'x' } }));
    await finishLevel(P.page, 'f0', 100);
    await expect(P.page.getByTestId('solo-rank')).toContainText('did not accept', { timeout: 60_000 });
    await P.ctx.close();
  });
});
