import { expect, test } from '@playwright/test';

test.describe('Menu, level select, game over and level complete', () => {
  test('TV Studio levels are selectable and run without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('btn-levels').click();
    await expect(page.getByTestId('level-s1')).toBeVisible();
    await page.getByTestId('level-s1').click();
    await page.evaluate(() => (window as any).__dd.setInputOverride([{ push: 0.7, hTarget: 0.8 }, { push: 0.7, hTarget: 0.8 }]));
    await page.waitForTimeout(3000);
    expect(await page.evaluate(() => (window as any).__dd.getState().theme)).toBe('studio');
    expect(errors).toEqual([]);
  });

  test('Play starts the first level; the menu icon holds Endless, Levels, Friends, Settings, Privacy; stars are remembered', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await expect(page.getByTestId('btn-play')).toContainText('Play');
    await expect(page.getByTestId('btn-endless')).toHaveCount(0);
    await page.getByTestId('menu-button').click();
    for (const id of ['btn-endless', 'btn-levels', 'btn-friends', 'panel-settings', 'panel-privacy']) await expect(page.getByTestId(id), id).toBeVisible();
    await expect(page.getByTestId('panel-resume')).toHaveCount(0);
    await expect(page.getByTestId('level-f0')).toHaveCount(0);
    await page.getByTestId('btn-levels').click();
    await expect(page.getByTestId('level-f0')).toBeVisible();
    await page.getByTestId('level-f1').click();
    await expect(page.getByTestId('menu-screen')).toBeHidden();
    const id = await page.evaluate(() => (window as any).__dd.getState().levelLength);
    expect(id).toBeGreaterThan(100);
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 20);
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('panel-resume')).toBeVisible();
    await page.getByTestId('panel-resume').click();
    await expect(page.getByTestId('menu-screen')).toBeHidden();
  });

  test('Continue resumes the campaign at the first unfinished level; Endless starts the mixed run', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('dd-progress', JSON.stringify({ levels: { f0: { stars: 3, best: 9 }, f1: { stars: 2, best: 9 } }, endless: {} })));
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await expect(page.getByTestId('btn-play')).toContainText('Continue');
    await expect(page.getByTestId('btn-play')).toContainText('TV studio 1');
    await page.getByTestId('menu-button').click();
    await page.getByTestId('btn-endless').click();
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 20);
    expect(await page.evaluate(() => (window as any).__dd.getState().mixed)).toBe(true);
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
