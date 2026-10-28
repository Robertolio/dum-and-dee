import { expect, test } from '@playwright/test';

test.describe('Start screen (iPhone landscape 844x390)', () => {
  test('shows Solo mode, explanation, defaults to analog, and Start reveals the game', async ({ page }) => {
    await page.goto('/');
    const start = page.getByTestId('start-screen');
    await expect(start).toBeVisible();
    await expect(start).toContainText('Solo (two fingers)');
    await expect(start).toContainText('Left thumb = Dum, right thumb = Dee');
    await expect(page.locator('#start-hint')).toContainText(/Home Screen|fullscreen/i);
    await expect(page.getByTestId('start-analog')).toHaveClass(/active/);

    const btn = page.getByTestId('start-button');
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const vp = page.viewportSize()!;
    const s = await start.boundingBox();
    expect(s!.width).toBeLessThanOrEqual(vp.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);

    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('start-digital').click();
    await btn.click();
    await expect(start).toBeHidden();
    const posture = await page.evaluate(() => (window as any).__dd.getSettings().posture);
    expect(posture).toBe('digital');
  });

  test('debug panel stays reachable on the start screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('#debug-toggle').click();
    await expect(page.locator('#debug')).toBeVisible();
  });
});
