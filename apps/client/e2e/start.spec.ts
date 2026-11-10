import { expect, test } from '@playwright/test';

test.describe('Opening (iPhone landscape 844x390)', () => {
  test('home is one big Play button: no intro text, no overlapping controls, Play starts the first level with a coach mark', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    const home = page.getByTestId('menu-screen');
    await expect(home).toBeVisible();
    await expect(page.getByTestId('btn-play')).toContainText('Play');
    await expect(page.getByTestId('btn-friend')).toContainText('Play with a friend');
    await expect(home).not.toContainText('Solo');
    await expect(home).not.toContainText('thumb');
    await expect(page.locator('#start')).toHaveCount(0);
    await expect(page.locator('#sound-hint')).toHaveCount(0);

    const vp = page.viewportSize()!;
    const boxes = [];
    for (const sel of ['[data-testid="btn-play"]', '[data-testid="btn-friend"]', '#menu-btn', '#audio-buttons', '#debug-toggle']) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.y + b!.height).toBeLessThanOrEqual(vp.height);
      boxes.push({ sel, ...b! });
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${a.sel} overlaps ${b.sel}`).toBe(false);
      }
    expect(boxes[0]!.height).toBeGreaterThanOrEqual(44);

    await page.getByTestId('btn-play').click();
    await expect(home).toBeHidden();
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 20);
    expect(await page.evaluate(() => (window as any).__dd.getSettings())).toMatchObject({ source: 'touch', posture: 'analog' });
    await expect(page.getByTestId('coach')).toContainText('Left thumb = Dum', { timeout: 8000 });
  });

  test('coach marks follow what the player does and are not shown again once done', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-play').click();
    const coach = page.getByTestId('coach');
    await expect(coach).toContainText('walk', { timeout: 8000 });
    await page.evaluate(() => (window as any).__dd.setInputOverride([{ push: 0.9, hTarget: 0.8 }, { push: 0.9, hTarget: 0.8 }]));
    await expect(coach).toContainText('bend', { timeout: 8000 });
    await page.evaluate(() => (window as any).__dd.setInputOverride([{ push: 0.5, hTarget: 0.3 }, { push: 0.5, hTarget: 0.3 }]));
    await expect(coach).toContainText('jump', { timeout: 8000 });
    await page.evaluate(() => (window as any).__dd.setInputOverride([{ push: 0.5, hTarget: 0.8, jump: true }, { push: 0.5, hTarget: 0.8 }]));
    await expect(coach).toBeHidden({ timeout: 5000 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dd-coach') ?? '[]'))).toEqual(['move', 'bend', 'jump']);
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-play').click();
    await page.waitForTimeout(3500);
    await expect(coach).toBeHidden();
  });

  test('settings (gear) override the automatic controls and are remembered', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('set-digital').click();
    await page.getByTestId('set-keyboard').click();
    expect(await page.evaluate(() => (window as any).__dd.getSettings().source)).toBe('keyboard');
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    expect(await page.evaluate(() => (window as any).__dd.getSettings().source)).toBe('keyboard');
  });

  test('developer tools stay reachable via settings', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-dev').click();
    await expect(page.locator('#debug')).toBeVisible();
  });

  test('portrait shows only the rotate notice, nothing through it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#rotate')).toBeVisible();
    for (const sel of ['[data-testid="btn-play"]', '[data-testid="btn-friend"]', '#menu-btn', '#audio-buttons', '#debug-toggle', '[data-testid="menu-screen"]']) {
      await expect(page.locator(sel), sel).toBeHidden();
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#rotate')).toBeHidden();
    await expect(page.getByTestId('btn-play')).toBeVisible();
  });
});

test.describe('Desktop', () => {
  test.use({ viewport: { width: 1100, height: 700 }, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
  test('desktop picks the keyboard and shows keyboard hints only', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-play').click();
    await page.waitForFunction(() => (window as any).__dd.getState().tick > 20);
    expect(await page.evaluate(() => (window as any).__dd.getSettings().source)).toBe('keyboard');
    await expect(page.getByTestId('coach')).toContainText('W A S D', { timeout: 8000 });
    await expect(page.getByTestId('coach')).not.toContainText('thumb');
  });
});
