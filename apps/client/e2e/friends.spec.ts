import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { addByCode, twoFriends } from './helpers';

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
  await page.getByTestId('btn-friend').click();
  await page.getByTestId('onb-name').fill(name);
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('friends-my-code')).toBeVisible();
}

test.describe('Identity and friends', () => {
  test('name filter, skip, and identity survives a reload', async ({ browser }) => {
    const { ctx, page } = await fresh(browser);
    await page.getByTestId('btn-friend').click();
    await page.getByTestId('onb-name').fill('fuck');
    await page.getByTestId('onb-create').click();
    await expect(page.getByTestId('onb-error')).toContainText('friendlier');
    await page.getByTestId('onb-name').fill('Rob');
    await page.getByTestId('onb-create').click();
    await expect(page.getByTestId('friends-screen')).toBeVisible();
    await expect(page.getByTestId('friends-my-code')).toHaveText(/^ROB-[2-9A-Z]{3}$/);
    const code = (await page.getByTestId('friends-my-code').textContent())!;
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-friend').click();
    await expect(page.getByTestId('friends-my-code')).toHaveText(code);
    await ctx.close();

    const s = await fresh(browser);
    await s.page.getByTestId('btn-friend').click();
    await s.page.getByTestId('onb-skip').click();
    await expect(s.page.getByTestId('menu-screen')).toBeVisible();
    await s.ctx.close();
  });

  test('A creates identity, B enters the code, A accepts, A plays with B, B joins from the invite', async ({ browser }) => {
    test.setTimeout(120_000);
    const A = await fresh(browser);
    const B = await fresh(browser);
    const a = A.page;
    const b = B.page;

    await register(a, 'Rob');
    const codeA = (await a.getByTestId('friends-my-code').textContent())!;
    expect(codeA).toMatch(/^ROB-[2-9A-Z]{3}$/);
    const href = (await a.getByTestId('friends-share').getAttribute('data-wa'))!;
    expect(decodeURIComponent(href.split('text=')[1]!)).toBe(`Play Dum & Dee with me: ${new URL(a.url()).origin}/?invite=${codeA} — my code is ${codeA}`);

    await register(b, 'Mia');
    await addByCode(b, codeA.toLowerCase());
    await expect(b.getByTestId('outgoing-Rob')).toBeVisible();

    await expect(a.getByTestId('request-Mia')).toBeVisible();
    await a.getByTestId('accept-Mia').click();
    await expect(a.getByTestId('friend-Mia')).toBeVisible();
    await expect(b.getByTestId('friend-Rob')).toBeVisible();
    await expect(a.getByTestId('online-Mia')).toHaveClass(/on/);
    await expect(b.getByTestId('online-Rob')).toHaveClass(/on/);
    await expect(a.getByTestId('friend-Mia')).toContainText('Rob & Mia');

    await expect(a.getByTestId('friends-screen')).not.toContainText(/team name/i);
    await expect(a.getByTestId('set-renew')).toHaveCount(0);

    await a.getByTestId('play-Mia').click();
    await expect(a.getByTestId('wait-title')).toContainText('Waiting for Mia');
    await expect(a.getByTestId('wait-invite-note')).toContainText('sees your invite');

    await expect(b.getByTestId('invite-banner')).toContainText('Rob is waiting');
    await b.getByTestId('invite-join').click();
    await expect(b.getByTestId('online-count')).toBeVisible({ timeout: 10_000 });
    await expect(a.getByTestId('online-count')).toBeVisible({ timeout: 10_000 });

    await A.ctx.close();
    await B.ctx.close();
  });

  test('no friends-of-friends: a stranger code from a third player only works with a request', async ({ browser }) => {
    const A = await fresh(browser);
    const B = await fresh(browser);
    await register(A.page, 'Ann');
    await register(B.page, 'Ben');
    await addByCode(B.page, 'ZZZ-222');
    await expect(B.page.getByTestId('friends-error')).toContainText('No player with that code');
    await A.ctx.close();
    await B.ctx.close();
  });

  test('delete me wipes the identity from the device and returns to the menu', async ({ browser }) => {
    const A = await fresh(browser);
    await register(A.page, 'Dora');
    await A.page.getByTestId('friends-settings').click();
    await A.page.getByTestId('set-delete').click();
    await A.page.getByTestId('set-delete-yes').click();
    await expect(A.page.getByTestId('menu-screen')).toBeVisible();
    expect(await A.page.evaluate(() => localStorage.getItem('dd-id'))).toBeNull();
    await A.ctx.close();
  });
});

test.describe('Settings', () => {
  test('rename works with feedback; no renew or notification button; controls present', async ({ browser }) => {
    const A = await fresh(browser);
    const B = await fresh(browser);
    await register(A.page, 'Rob');
    await register(B.page, 'Mia');
    const code = (await A.page.getByTestId('friends-my-code').textContent())!;
    await addByCode(B.page, code);
    await A.page.getByTestId('accept-Mia').click();
    await expect(B.page.getByTestId('friend-Rob')).toBeVisible();

    await A.page.getByTestId('friends-settings').click();
    await expect(A.page.getByTestId('set-renew')).toHaveCount(0);
    await expect(A.page.getByTestId('push-on')).toHaveCount(0);
    await expect(A.page.getByTestId('set-touch')).toBeVisible();
    await expect(A.page.getByTestId('set-keyboard')).toBeVisible();

    await A.page.getByTestId('set-name').fill('R');
    await A.page.getByTestId('set-rename').click();
    await expect(A.page.getByTestId('set-error')).toContainText('2 to 16');
    await A.page.getByTestId('set-name').fill('Robert');
    await A.page.getByTestId('set-rename').click();
    await expect(A.page.getByTestId('set-ok')).toContainText('Name changed');
    await expect(B.page.getByTestId('friend-Robert')).toBeVisible();
    expect(await A.page.evaluate(() => JSON.parse(localStorage.getItem('dd-id') ?? '{}').name)).toBe('Robert');

    await A.page.getByTestId('set-name').fill('Mia');
    await A.page.getByTestId('set-rename').click();
    await A.page.getByTestId('set-name').fill('shit');
    await A.page.getByTestId('set-rename').click();
    await expect(A.page.getByTestId('set-error')).not.toHaveText('');

    await A.page.getByTestId('set-back').click();
    await expect(A.page.getByTestId('friends-me-name')).toHaveText('Mia');
    await A.ctx.close();
    await B.ctx.close();
  });
});

test.describe('Invite landing', () => {
  test('iPhone Safari, new player: explains Add to Home Screen and the code', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, '/?invite=ROB-7K2', { userAgent: IPHONE_UA });
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('invite-ios-new')).toContainText('Add to Home Screen');
    await expect(page.getByTestId('invite-ios-new')).toContainText('ROB-7K2');
    await page.getByTestId('invite-ios-have').click();
    await expect(page.getByTestId('invite-ios-app')).toContainText('Open the Dum & Dee app');
    await ctx.close();
  });

  test('invite param with trailing text still yields the code and the simple flow, no lobby', async ({ browser }) => {
    const raw = encodeURIComponent('ROB-JJ2 \u2014 my code is ROB-JJ2');
    const { ctx, page } = await fresh(browser, `/?invite=${raw}`);
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('onb-invite')).toHaveValue('ROB-JJ2');
    await expect(page.locator('[data-testid^="lobby-"], [data-testid="online-ready"]')).toHaveCount(0);
    await ctx.close();
  });

  test('desktop/Android with ?invite: first start prefills the invite code', async ({ browser }) => {
    const { ctx, page } = await fresh(browser, '/?invite=ROB-7K2');
    await page.getByTestId('btn-play').click();
    await expect(page.getByTestId('onb-invite')).toHaveValue('ROB-7K2');
    await ctx.close();
  });
});

test.describe('Friends screen layout', () => {
  test('one title, big Share + Copy, no system share, name prominent, list reachable and clear of the corner buttons', async ({ browser }) => {
    const { A, B } = await twoFriends(browser, 'Rob', 'Mia');
    const page = A.page;
    await page.addInitScript(() => {
      (window as any).__shared = [];
      (navigator as any).share = (d: unknown) => ((window as any).__shared.push(d), Promise.resolve());
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-friend').click();
    await expect(page.getByTestId('friends-my-code')).toBeVisible();
    const card = page.locator('#friends .card');
    await expect(card.locator('h2')).toHaveText('Invite a Friend');
    await expect(card.locator('h3', { hasText: /^Invite a friend$/i })).toHaveCount(0);
    await expect(page.getByTestId('friends-share')).toHaveText('Share');
    await expect(page.getByTestId('friends-copy')).toBeVisible();
    await page.getByTestId('friends-share').click();
    const shared = await page.evaluate(() => (window as any).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].text).toContain('?invite=');
    expect(shared[0].text).toContain(await page.getByTestId('friends-my-code').innerText());
    await expect(card).not.toContainText('WhatsApp');
    const nameSize = await page.getByTestId('friends-me-name').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const codeSize = await page.getByTestId('friends-my-code').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(nameSize).toBeGreaterThan(codeSize);
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(390);
    const row = page.getByTestId('friend-Mia');
    await row.scrollIntoViewIfNeeded();
    await expect(row).toBeVisible();
    const r = (await row.boundingBox())!;
    expect(r.y + r.height).toBeLessThanOrEqual(390 - 40);
    const gear = page.getByTestId('settings-button');
    const gb = await gear.boundingBox();
    if (gb) expect(r.x + r.width <= gb.x || gb.x + gb.width <= r.x || r.y + r.height <= gb.y || gb.y + gb.height <= r.y).toBe(true);
    await page.getByTestId('friends-back').scrollIntoViewIfNeeded();
    await page.getByTestId('friends-back').click();
    await expect(page.getByTestId('menu-screen')).toBeVisible();
    await A.ctx.close();
    await B.ctx.close();
  });

  test('without a system share menu, Share opens the WhatsApp link', async ({ browser }) => {
    const P = await (await import('./helpers')).newPlayer(browser, 'Wal');
    const page = P.page;
    await page.addInitScript(() => {
      (navigator as any).share = undefined;
      (window as any).__opened = [];
      window.open = ((u: string) => ((window as any).__opened.push(u), {})) as any;
    });
    await page.reload();
    await page.waitForFunction(() => (window as any).__dd !== undefined);
    await page.getByTestId('btn-friend').click();
    await page.getByTestId('friends-share').click();
    const opened = await page.evaluate(() => (window as any).__opened);
    expect(opened[0]).toMatch(/^https:\/\/wa\.me\/\?text=/);
    await P.ctx.close();
  });
});
