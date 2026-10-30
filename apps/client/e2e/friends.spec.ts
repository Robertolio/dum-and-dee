import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.use({ baseURL: process.env.E2E_BASE ?? 'http://localhost:4600' });

const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } as const;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function fresh(browser: import('@playwright/test').Browser, url = '/', extra = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...PHONE, storageState: { cookies: [], origins: [] }, ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  return { ctx, page };
}

async function register(page: Page, name: string): Promise<void> {
  await page.getByTestId('start-button').click();
  await page.getByTestId('onb-name').fill(name);
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('menu-screen')).toBeVisible();
}

test.describe('Identity and friends', () => {
  test('name filter, skip, and identity survives a reload', async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await page.getByTestId('start-button').click();
    await page.getByTestId('onb-name').fill('fuck');
    await page.getByTestId('onb-create').click();
    await expect(page.getByTestId('onb-error')).toContainText('friendlier');
    await page.getByTestId('onb-name').fill('Rob');
    await page.getByTestId('onb-create').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await page.getByTestId('btn-friends').click();
    await expect(page.getByTestId('friends-my-code')).toHaveText(/^ROB-[2-9A-Z]{3}$/);
    const code = (await page.getByTestId('friends-my-code').textContent())!;
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('start-button').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await page.getByTestId('btn-friends').click();
    await expect(page.getByTestId('friends-my-code')).toHaveText(code);
    await ctx.close();

    const s = await fresh(browser);
    await s.page.getByTestId('start-button').click();
    await s.page.getByTestId('onb-skip').click();
    await expect(s.page.getByTestId('menu-screen')).toBeVisible();
    await s.ctx.close();
  });

  test('A creates identity, B enters the code, A accepts, team name, A plays with B, B joins from the invite', async ({ browser }) => {
    test.setTimeout(120_000);
    const A = await fresh(browser);
    const B = await fresh(browser);
    const a = A.page;
    const b = B.page;

    await register(a, 'Rob');
    await a.getByTestId('btn-friends').click();
    const codeA = (await a.getByTestId('friends-my-code').textContent())!;
    expect(codeA).toMatch(/^ROB-[2-9A-Z]{3}$/);
    const href = (await a.getByTestId('friends-wa').getAttribute('href'))!;
    expect(decodeURIComponent(href.split('text=')[1]!)).toBe(`Play Dum & Dee with me: http://localhost:4600/?invite=${codeA} — my code is ${codeA}`);

    await register(b, 'Mia');
    await b.getByTestId('btn-friends').click();
    await b.getByTestId('friends-add-input').fill(codeA.toLowerCase());
    await b.getByTestId('friends-add-go').click();
    await expect(b.getByTestId('outgoing-Rob')).toBeVisible();

    await expect(a.getByTestId('request-Mia')).toBeVisible();
    await a.getByTestId('accept-Mia').click();
    await expect(a.getByTestId('friend-Mia')).toBeVisible();
    await expect(b.getByTestId('friend-Rob')).toBeVisible();
    await expect(a.getByTestId('online-Mia')).toHaveClass(/on/);
    await expect(b.getByTestId('online-Rob')).toHaveClass(/on/);
    await expect(a.getByTestId('friend-Mia')).toContainText('Rob & Mia');

    await a.getByTestId('more-Mia').click();
    await a.getByTestId('team-input-Mia').fill('Ladder Pros');
    await a.getByTestId('team-set-Mia').click();
    await expect(b.getByTestId('teamreq-Rob')).toContainText('Ladder Pros');
    await expect(a.getByTestId('teamwait-Mia')).toBeVisible();
    await b.getByTestId('team-yes-Rob').click();
    await expect(a.getByTestId('friend-Mia')).toContainText('Ladder Pros');
    await expect(b.getByTestId('friend-Rob')).toContainText('Ladder Pros');

    await a.getByTestId('play-Mia').click();
    const codeEl = a.getByTestId('lobby-code');
    await expect(codeEl).toHaveText(/^[A-Z2-9]{6}$/);
    const room = (await codeEl.textContent())!;
    await expect(a.getByTestId('lobby-invite-note')).toContainText('sees your invite');

    await expect(b.getByTestId('invite-banner')).toContainText('Rob is waiting');
    await b.getByTestId('invite-join').click();
    await expect(b.getByTestId('lobby-code')).toHaveText(room);
    await expect(a.getByTestId('lobby-seat-1')).toContainText('Partner');

    await A.ctx.close();
    await B.ctx.close();
  });

  test('no friends-of-friends: a stranger code from a third player only works with a request', async ({ browser }) => {
    const A = await fresh(browser);
    const B = await fresh(browser);
    await register(A.page, 'Ann');
    await register(B.page, 'Ben');
    await B.page.getByTestId('btn-friends').click();
    await B.page.getByTestId('friends-add-input').fill('ZZZ-222');
    await B.page.getByTestId('friends-add-go').click();
    await expect(B.page.getByTestId('friends-error')).toContainText('No player with that code');
    await A.ctx.close();
    await B.ctx.close();
  });

  test('delete me wipes the identity from the device and returns to the menu', async ({ browser }) => {
    const A = await fresh(browser);
    await register(A.page, 'Dora');
    await A.page.getByTestId('btn-friends').click();
    await A.page.getByTestId('friends-settings').click();
    await A.page.getByTestId('set-delete').click();
    await A.page.getByTestId('set-delete-yes').click();
    await expect(A.page.getByTestId('menu-screen')).toBeVisible();
    expect(await A.page.evaluate(() => localStorage.getItem('dd-id'))).toBeNull();
    await A.ctx.close();
  });
});

test.describe('Invite landing', () => {
  test('iPhone Safari, new player: explains Add to Home Screen and the code', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, '/?invite=ROB-7K2', { userAgent: IPHONE_UA });
    await page.getByTestId('start-button').click();
    await expect(page.getByTestId('invite-ios-new')).toContainText('Add to Home Screen');
    await expect(page.getByTestId('invite-ios-new')).toContainText('ROB-7K2');
    await page.getByTestId('invite-ios-have').click();
    await expect(page.getByTestId('invite-ios-app')).toContainText('Open the Dum & Dee app');
    await ctx.close();
  });

  test('desktop/Android with ?invite: first start prefills the invite code', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, '/?invite=ROB-7K2');
    await page.getByTestId('start-button').click();
    await expect(page.getByTestId('onb-invite')).toHaveValue('ROB-7K2');
    await ctx.close();
  });
});
