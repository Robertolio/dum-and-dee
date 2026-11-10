import { expect, test, type Page } from '@playwright/test';

const row = (page: Page) => page.evaluate(() => (window as any).__dd.getState().row);

/** Both rowers stroke with the given phase shift (ms) between them. */
async function stroke(page: Page, shiftMs: number): Promise<void> {
  await page.evaluate((shift) => {
    const w = window as any;
    clearInterval(w.__rowTimer);
    const t0 = performance.now();
    w.__rowTimer = setInterval(() => {
      const t = performance.now() - t0;
      const one = (ms: number) => ({ push: Math.floor(ms / 500) % 2 === 0 ? 1 : -0.3, hTarget: 0.8, jump: false });
      w.__dd.setInputOverride([one(t), one(t + shift)]);
    }, 16);
  }, shiftMs);
}

test('rowing race: menu, levels and ?level=r1 all start it; the shot, synchrony and the finish time work', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('panel-rowing').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  expect(await page.evaluate(() => (window as any).__dd.levelId())).toBe('r1');
  expect(await page.evaluate(() => (window as any).__dd.getState().theme)).toBe('rowing');

  await page.getByTestId('menu-button').click();
  await page.getByTestId('btn-levels').click();
  await expect(page.getByTestId('btn-rowing')).toBeVisible();
  await expect(page.getByTestId('level-r1')).toBeVisible();

  await page.goto('/?level=r1');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  expect(await page.evaluate(() => (window as any).__dd.levelId())).toBe('r1');
  expect(await page.evaluate(() => localStorage.getItem('dd-progress'))).toBeNull();

  // Before the shot nothing moves; after it the race clock runs.
  expect((await row(page)).started).toBe(false);
  await stroke(page, 0);
  await expect.poll(async () => (await row(page)).started, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await row(page)).v, { timeout: 20_000 }).toBeGreaterThan(1.5);
  expect((await row(page)).sync).toBeGreaterThan(0.7);
  expect((await row(page)).raceTime).toBeGreaterThan(0);

  // Out of phase: the synchrony meter drops and the boat is slower than a synchronised one.
  await stroke(page, 250);
  await expect.poll(async () => (await row(page)).sync, { timeout: 15_000 }).toBeLessThan(0.4);
  const slow = (await row(page)).v;
  await stroke(page, 0);
  await expect.poll(async () => (await row(page)).sync, { timeout: 15_000 }).toBeGreaterThan(0.8);
  await expect.poll(async () => (await row(page)).v, { timeout: 15_000 }).toBeGreaterThan(slow);

  // Hull damage works and the finish shows the race time.
  await page.evaluate(() => {
    (window as any).__dd.setInputOverride(null);
    clearInterval((window as any).__rowTimer);
    const s = (window as any).__dd.getState();
    s.row.x = s.levelLength - 3;
    s.row.v = 3;
  });
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('result-screen')).toContainText('Hull');
  await expect(page.getByTestId('result-screen')).toContainText(/Time \d+:\d\d\.\d/);
});

test('rowing race: a duck, a buoy and a bridge cost hull or points', async ({ page }) => {
  await page.goto('/?level=r1');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  await page.evaluate(() => {
    const s = (window as any).__dd.getState();
    s.row.started = true;
    s.row.x = 32.5;
    s.row.v = 3.2;
  });
  await expect.poll(async () => (await row(page)).ducks[0].done, { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__dd.getState().bucket.water)).toBeLessThan(100);

  await page.evaluate(() => {
    const s = (window as any).__dd.getState();
    s.row.x = 46;
    s.row.v = 3.6;
  });
  await expect.poll(async () => (await row(page)).buoys[0].done, { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__dd.getState().score)).toBeGreaterThan(0);
});

test('rowing race: keyboard strokes (D and the right arrow) row the skiff forward, W/S set a persistent oar height', async ({ page }) => {
  await page.goto('/?level=r1');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  await page.evaluate(() => (window as any).__dd.setSettings({ source: 'keyboard' }));
  await expect.poll(async () => (await row(page)).started, { timeout: 20_000 }).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(450);
  }
  const r = await row(page);
  expect(r.strokes[0]).toBeGreaterThanOrEqual(3);
  expect(r.strokes[1]).toBeGreaterThanOrEqual(3);
  expect(r.x).toBeGreaterThan(8);

  await page.keyboard.down('KeyS');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyS');
  await page.waitForTimeout(500);
  const lifted = (await row(page)).rowers[0].lift;
  expect(lifted).toBeGreaterThan(0.2);
  expect(lifted).toBeLessThan(0.9);
  expect((await row(page)).rowers[1].lift).toBeLessThan(0.1);
});
