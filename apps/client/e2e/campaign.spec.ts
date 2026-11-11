import { expect, test } from '@playwright/test';

const levelId = (p: import('@playwright/test').Page): Promise<string> => p.evaluate(() => (window as any).__dd.levelId());

test('menu has all four environment shortcuts; each starts the current level of its environment', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('dd-id')) localStorage.setItem('dd-skip', '1');
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('dd-progress', JSON.stringify({ levels: { f0: { stars: 3, best: 9 }, s1: { stars: 2, best: 9 } }, endless: {} }));
    }
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await expect(page.getByTestId('btn-play')).toContainText('Continue');
  await expect(page.getByTestId('btn-play')).toContainText('Boathouse 1');
  const open = async (id: string): Promise<void> => {
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId(id)).toBeVisible();
    await page.getByTestId(id).click();
  };
  await page.getByTestId('btn-play').click();
  expect(await levelId(page)).toBe('b1');
  await open('panel-factory');
  expect(await levelId(page)).toBe('f3');
  await open('panel-tvstudio');
  expect(await levelId(page)).toBe('s3');
  await open('panel-boathouse');
  expect(await levelId(page)).toBe('b1');
  await open('panel-rowing');
  expect(await levelId(page)).toBe('r1');
  await page.getByTestId('menu-button').click();
  await page.getByTestId('btn-levels').click();
  for (const id of ['btn-factory', 'btn-tvstudio', 'btn-boathouse', 'btn-rowing', 'level-f0', 'level-r3', 'level-b3', 'level-f1']) await expect(page.getByTestId(id), id).toBeVisible();
  const order = await page.locator('[data-testid^="level-"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
  expect(order.slice(0, 12)).toEqual(['f0', 's1', 'b1', 'r1', 'f3', 's3', 'b2', 'r2', 'f5', 's5', 'b3', 'r3'].map((i) => `level-${i}`));
  await page.getByTestId('btn-factory').click();
  expect(await levelId(page)).toBe('f3');
  // Old progress of players is untouched (keyed by unchanged ids).
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dd-progress')!));
  expect(saved.levels.f0.stars).toBe(3);
});
