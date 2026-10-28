import { expect, test } from '@playwright/test';

test.describe('Audio', () => {
  test('context is created only after the first tap; mute is remembered', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.__ctxCount = 0;
      const Orig = w.AudioContext;
      w.AudioContext = class extends Orig {
        constructor(...a: unknown[]) {
          super(...a);
          w.__ctxCount++;
          w.__ctx = this;
        }
      };
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    expect(await page.evaluate(() => (window as any).__ctxCount)).toBe(0);
    await page.getByTestId('start-button').click();
    expect(await page.evaluate(() => (window as any).__ctxCount)).toBe(1);
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowRight');
    await page.keyboard.press('Space');
    await page.waitForTimeout(4500);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowRight');
    expect(await page.evaluate(() => (window as any).__ctx.state)).toBe('running');
    expect(errors).toEqual([]);
    await page.locator('#btn-sound').click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dd-audio') ?? '{}'));
    expect(stored.sfx).toBe(false);
    await page.reload();
    await expect(page.locator('#btn-sound')).toHaveClass(/off/);
    await page.locator('#btn-music').click();
    const stored2 = await page.evaluate(() => JSON.parse(localStorage.getItem('dd-audio') ?? '{}'));
    expect(stored2.music).toBe(false);
  });
});
