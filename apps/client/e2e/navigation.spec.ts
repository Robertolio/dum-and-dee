import { expect, test, type Page } from '@playwright/test';
import { newPlayer } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

const tick = (p: Page): Promise<number> => p.evaluate(() => (window as any).__dd.getState().tick);

async function playing(p: Page): Promise<void> {
  const t0 = await tick(p);
  await expect.poll(() => tick(p), { timeout: 5000 }).toBeGreaterThan(t0 + 10);
}

async function startGame(p: Page): Promise<void> {
  await p.goto('/');
  await p.waitForFunction(() => (window as any).__dd !== undefined);
  await p.getByTestId('btn-play').click();
  await playing(p);
}

async function nothingOpen(p: Page): Promise<void> {
  for (const id of ['settings-screen', 'menu-screen', 'friends-screen', 'result-screen']) await expect(p.getByTestId(id)).toBeHidden();
}

test.describe('Back always returns to the previous screen or the game', () => {
  test('gear in the game: Done resumes, gear again closes, Developer tools closes', async ({ page }) => {
    await startGame(page);
    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('settings-done').click();
    await nothingOpen(page);
    await playing(page);

    await page.getByTestId('settings-button').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('settings-button').click();
    await nothingOpen(page);
    await playing(page);

    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-dev').click();
    await nothingOpen(page);
    await playing(page);
  });

  test('menu > Settings > Done returns to the menu, and Resume continues the game', async ({ page }) => {
    await startGame(page);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('panel-settings').click();
    await expect(page.getByTestId('settings-screen')).toBeVisible();
    await page.getByTestId('settings-done').click();
    await expect(page.getByTestId('settings-screen')).toBeHidden();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await page.getByTestId('panel-resume').click();
    await nothingOpen(page);
    await playing(page);
  });

  test('menu > Privacy > Close returns to the menu (never a blank paused screen)', async ({ page }) => {
    await startGame(page);
    await page.getByTestId('menu-button').click();
    await page.getByTestId('panel-privacy').click();
    await expect(page.getByTestId('privacy-close')).toBeVisible();
    await page.getByTestId('privacy-close').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await expect(page.getByTestId('friends-screen')).toBeHidden();
  });

  test('gear on the home screen returns to the home screen', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('settings-button').click();
    await page.getByTestId('settings-done').click();
    await expect(page.getByTestId('btn-play')).toBeVisible();
    await expect(page.getByTestId('settings-screen')).toBeHidden();
  });

  test('Friends > Settings > Back > Back, from the home screen and from the menu', async ({ browser }) => {
    const A = await newPlayer(browser, 'Nia');
    const p = A.page;
    // newPlayer leaves us on the Friends screen opened from the home screen.
    await p.getByTestId('friends-settings').click();
    await expect(p.getByTestId('set-name')).toBeVisible();
    await p.getByTestId('set-back').click();
    await expect(p.getByTestId('friends-my-code')).toBeVisible();
    await p.getByTestId('friends-back').click();
    await expect(p.getByTestId('btn-play')).toBeVisible();
    await expect(p.getByTestId('friends-screen')).toBeHidden();

    await p.getByTestId('btn-play').click();
    await playing(p);
    await p.getByTestId('menu-button').click();
    await p.getByTestId('btn-friends').click();
    await expect(p.getByTestId('friends-my-code')).toBeVisible();
    await p.getByTestId('friends-settings').click();
    await p.getByTestId('set-back').click();
    await p.getByTestId('friends-back').click();
    await expect(p.getByTestId('friends-screen')).toBeHidden();
    await expect(p.getByTestId('panel-resume')).toBeVisible();

    // The gear while Friends is open opens the Friends settings and Back returns to Friends.
    await p.getByTestId('btn-friends').click();
    await p.getByTestId('settings-button').click();
    await expect(p.getByTestId('set-name')).toBeVisible();
    await expect(p.getByTestId('settings-screen')).toBeHidden();
    await p.getByTestId('set-back').click();
    await expect(p.getByTestId('friends-my-code')).toBeVisible();
    // The menu icon always leaves.
    await p.getByTestId('menu-button').click();
    await expect(p.getByTestId('friends-screen')).toBeHidden();
    await expect(p.getByTestId('menu-screen')).toBeVisible();
    await A.ctx.close();
  });

  test('Friends > Privacy > Close returns to Friends', async ({ browser }) => {
    const A = await newPlayer(browser, 'Nia');
    const p = A.page;
    await p.getByTestId('friends-privacy').click();
    await p.getByTestId('privacy-close').click();
    await expect(p.getByTestId('friends-my-code')).toBeVisible();
    await A.ctx.close();
  });
});
