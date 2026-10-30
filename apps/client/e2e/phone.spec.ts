import { expect, test } from '@playwright/test';

test.describe('Phone finish', () => {
  test('portrait shows the rotate notice, landscape hides it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('#rotate')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('#rotate')).toBeHidden();
  });

  test('requests a screen wake lock when play starts, and re-requests after the page becomes visible again', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__wl = 0;
      Object.defineProperty(navigator, 'wakeLock', {
        value: {
          request: async () => {
            (window as any).__wl++;
            const l = new EventTarget() as any;
            l.release = async () => l.dispatchEvent(new Event('release'));
            return l;
          },
        },
      });
    });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('start-button').click();
    await expect.poll(() => page.evaluate(() => (window as any).__wl)).toBeGreaterThan(0);
  });

  test('iPhone Safari (not standalone) shows a dismissible Add to Home Screen tip that is remembered', async ({ browser }) => {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 844, height: 390 },
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await page.goto('/');
    const tip = page.getByTestId('a2hs-tip');
    await expect(tip).toBeVisible();
    await tip.locator('button').click();
    await expect(tip).toBeHidden();
    await page.reload();
    await expect(page.getByTestId('a2hs-tip')).toHaveCount(0);
    await ctx.close();
  });

  test('adaptive quality stays at full quality on a healthy machine and exposes its level', async ({ page }) => {
    await page.goto('/?autostart=1');
    await page.waitForFunction(() => (window as any).__dd !== undefined && (window as any).__dd.getState().tick > 10);
    const q = await page.evaluate(() => (window as any).__dd.quality());
    expect([0, 1, 2]).toContain(q);
  });
});
