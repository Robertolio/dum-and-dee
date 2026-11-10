import { expect, test } from '@playwright/test';

test('boathouse: ?level=b1 and the Levels button start it; knocks damage the hull; the water ends the level', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('btn-levels').click();
  await page.getByTestId('btn-boathouse').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  expect(await page.evaluate(() => (window as any).__dd.levelId())).toBe('b1');
  expect(await page.evaluate(() => (window as any).__dd.getState().theme)).toBe('boathouse');

  await page.goto('/?level=b1');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => (window as any).__dd.getState().tick > 10);
  expect(await page.evaluate(() => (window as any).__dd.levelId())).toBe('b1');
  expect(await page.evaluate(() => localStorage.getItem('dd-progress'))).toBeNull();

  // Hull is the meter: damage from a knock, none from standing still.
  const hull = (): Promise<number> => page.evaluate(() => (window as any).__dd.getState().bucket.water);
  expect(await hull()).toBeGreaterThan(95);
  await page.evaluate(() => {
    const s = (window as any).__dd.getState();
    s.bucket.water = 20;
  });
  await page.waitForTimeout(600);
  expect(await hull()).toBeLessThanOrEqual(20);

  // Reaching the end: into the water, then the result screen (with Hull, not Water).
  await page.evaluate(() => {
    const s = (window as any).__dd.getState();
    s.players[0].x = s.levelLength - 2.6;
    s.players[1].x = s.levelLength - 0.2;
  });
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('result-screen')).toContainText('Hull');
});
