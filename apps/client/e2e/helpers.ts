import type { BrowserContext } from '@playwright/test';

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
