import { expect, test } from '@playwright/test';

test.describe('Menu, level select, game over and level complete', () => {
  test('TV Studio levels are selectable and run without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('start-button').click();
    await expect(page.getByTestId('level-s1')).toBeVisible();
    await expect(page.getByTestId('level-endless-studio')).toBeVisible();
    await page.getByTestId('level-s1').click();
    await page.evaluate(() => (window as any).__dd.setInputOverride([{ push: 0.7, hTarget: 0.8 }, { push: 0.7, hTarget: 0.8 }]));
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => (window as any).__dd.getState().theme)).toBe('studio');
    expect(errors).toEqual([]);
  });

  test('Start opens the level select; choosing a level starts it; stars are remembered', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('start-button').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await expect(page.getByTestId('level-f0')).toBeVisible();
    await expect(page.getByTestId('level-endless-factory')).toBeVisible();
    await page.getByTestId('level-f1').click();
    await expect(page.getByTestId('menu-screen')).toBeHidden();
    const id = await page.evaluate(() => (window as any).__dd.getState().levelLength);
    expect(id).toBeGreaterThan(100);
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 20);
  });

  test('game over shows score with Play again and Menu', async ({ page }) => {
    await page.goto('/?autostart=1');
    await page.waitForFunction(() => (window as any).__dd !== undefined && (window as any).__dd.getState().tick > 10);
    await page.evaluate(() => {
      const s = (window as any).__dd.getState();
      s.lives = 1;
      s.score = 321;
      s.bucket.water = 0;
    });
    const res = page.getByTestId('result-screen');
    await expect(res).toBeVisible({ timeout: 5000 });
    await expect(res).toContainText('Game over');
    await expect(res).toContainText('321');
    await page.getByTestId('btn-again').click();
    await expect(res).toBeHidden();
    expect(await page.evaluate(() => (window as any).__dd.getState().lives)).toBe(3);
    await page.evaluate(() => {
      const s = (window as any).__dd.getState();
      s.lives = 1;
      s.bucket.water = 0;
    });
    await expect(res).toBeVisible({ timeout: 5000 });
    await page.getByTestId('btn-menu').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
  });

  test('reaching the end of a level shows stars and Next level, and saves progress', async ({ page }) => {
    await page.goto('/?autostart=1&level=f0');
    await page.waitForFunction(() => (window as any).__dd !== undefined && (window as any).__dd.getState().tick > 10);
    await page.evaluate(() => {
      const s = (window as any).__dd.getState();
      s.steps.length = 0;
      s.lamps.length = 0;
      s.softs.length = 0;
      s.beams.length = 0;
      s.levelLength = 20;
      (window as any).__dd.setInputOverride([{ push: 0.9, hTarget: 0.8 }, { push: 0.9, hTarget: 0.8 }]);
    });
    const res = page.getByTestId('result-screen');
    await expect(res).toBeVisible({ timeout: 15000 });
    await expect(res).toContainText('Level complete');
    await expect(page.getByTestId('btn-next')).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dd-progress')!));
    expect(saved.levels.f0.stars).toBeGreaterThanOrEqual(1);
  });
});
