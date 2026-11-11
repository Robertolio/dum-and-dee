import { expect, test } from '@playwright/test';
import { twoFriends } from './helpers';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

const levelId = (p: import('@playwright/test').Page): Promise<string> => p.evaluate(() => (window as any).__dd.levelId());

test.describe('Online: the server decides the level for both players', () => {
  test('a switch by either player switches both (also rowing); solo choices do not leak online', async ({ browser }) => {
    test.setTimeout(150_000);
    const { A, B } = await twoFriends(browser);
    const a = A.page;
    const b = B.page;

    // A solo choice made before going online must not decide the online level.
    await a.evaluate(() => (window as any).__dd.startLevel('s3'));
    expect(await levelId(a)).toBe('s3');
    await a.evaluate(() => (window as any).__dd.reset());

    await a.getByTestId('play-Mia').click();
    await expect(b.getByTestId('invite-join')).toBeVisible({ timeout: 10_000 });
    await b.getByTestId('invite-join').click();
    for (const p of [a, b]) await p.waitForFunction(() => (window as any).__dd.getState().tick > 30 && (window as any).__online.client.sync, null, { timeout: 20_000 });
    await expect.poll(() => levelId(a)).toBe('f0');
    await expect.poll(() => levelId(b)).toBe('f0');

    // The client never starts a local level while online.
    await b.evaluate(() => (window as any).__dd.startLevel('s3'));
    expect(await levelId(b)).toBe('f0');

    // A picks the rowing race: both are in it.
    await a.getByTestId('menu-button').click();
    await a.getByTestId('online-switch-rowing').click();
    await expect.poll(() => levelId(a), { timeout: 15_000 }).toBe('r1');
    await expect.poll(() => levelId(b), { timeout: 15_000 }).toBe('r1');
    await expect(b.getByTestId('online-toast')).toContainText('Switched to Rowing race 1');
    for (const p of [a, b]) await p.waitForFunction(() => !!(window as any).__dd.getState().row && (window as any).__dd.getState().tick > 20, null, { timeout: 15_000 });

    // B picks the TV studio: A follows.
    await b.getByTestId('menu-button').click();
    await b.getByTestId('online-switch-tvstudio').click();
    await expect.poll(() => levelId(a), { timeout: 15_000 }).toBe('s1');
    await expect.poll(() => levelId(b), { timeout: 15_000 }).toBe('s1');
    await expect(a.getByTestId('online-toast')).toContainText('Switched to TV studio 1');

    // A picks a specific level from the list; B picks the factory again: last switch wins.
    await a.getByTestId('menu-button').click();
    await a.getByTestId('online-levels-toggle').click();
    await a.getByTestId('online-level-b2').click();
    await expect.poll(() => levelId(b), { timeout: 15_000 }).toBe('b2');
    await b.getByTestId('menu-button').click();
    await b.getByTestId('online-switch-factory').click();
    await expect.poll(() => levelId(a), { timeout: 15_000 }).toBe('f0');
    await expect.poll(() => levelId(b), { timeout: 15_000 }).toBe('f0');

    // Leaving: the solo menu is untouched by what was chosen online.
    await a.getByTestId('menu-button').click();
    await a.getByTestId('online-leave').click();
    await expect(a.getByTestId('menu-screen')).toBeVisible();
    await a.evaluate(() => (window as any).__dd.startLevel('f1'));
    expect(await levelId(a)).toBe('f1');
    await A.ctx.close();
    await B.ctx.close();
  });
});
