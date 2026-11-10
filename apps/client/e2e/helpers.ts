import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Anonymous mode: the first-start name prompt is skipped so older flows stay unchanged. */
export async function skipIdentity(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    try {
      if (!localStorage.getItem('dd-id')) localStorage.setItem('dd-skip', '1');
    } catch {
      /* ignore */
    }
  });
}

const PHONE = { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true } as const;

export async function newPlayer(browser: Browser, name: string): Promise<{ ctx: BrowserContext; page: Page; code: string }> {
  const ctx = await browser.newContext({ ...PHONE, storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__dd !== undefined);
  await page.getByTestId('btn-friend').click();
  await page.getByTestId('onb-name').fill(name);
  await page.getByTestId('onb-create').click();
  await expect(page.getByTestId('friends-my-code')).toHaveText(/^[A-Z]{3}-[2-9A-Z]{3}$/);
  return { ctx, page, code: (await page.getByTestId('friends-my-code').textContent())! };
}

/** Two phones that are already friends, both on their Friends screen. */
export async function twoFriends(browser: Browser, nameA = 'Rob', nameB = 'Mia') {
  const A = await newPlayer(browser, nameA);
  const B = await newPlayer(browser, nameB);
  await addByCode(B.page, A.code);
  await A.page.getByTestId(`accept-${nameB}`).click();
  await expect(A.page.getByTestId(`friend-${nameB}`)).toBeVisible();
  await expect(B.page.getByTestId(`friend-${nameA}`)).toBeVisible();
  return { A, B, nameA, nameB };
}

export async function addByCode(page: Page, code: string): Promise<void> {
  if (!(await page.getByTestId('friends-add-input').isVisible())) await page.getByTestId('friends-have').click();
  await page.getByTestId('friends-add-input').fill(code);
  await page.getByTestId('friends-add-go').click();
}
