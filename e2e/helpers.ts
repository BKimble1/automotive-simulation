import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __fab: any;
    __fabStores: any;
    __fabAdvance: (n?: number, render?: boolean) => void;
  }
}

/** Open the app on the virtual clock and wait until the car is built and compiled. */
export async function open(page: Page, query = '', quality = 'low') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./?virt=1&quality=${quality}${query ? `&${query}` : ''}`);
  await page.waitForFunction(() => window.__fabStores?.useApp?.getState().ready, null, { timeout: 150_000 });
  for (let i = 0; i < 120; i++) {
    await page.evaluate(() => window.__fabAdvance(1, false));
    if (await page.evaluate(() => window.__fabStores.useApp.getState().carReady)) break;
    await page.waitForTimeout(250);
  }
  return errors;
}

/** Advance the virtual clock by n frames (1/30 s each), drawing only the last. */
export const frames = (page: Page, n: number) => page.evaluate((k) => window.__fabAdvance(k, false), n);

export const app = (page: Page) => page.evaluate(() => {
  const s = window.__fabStores.useApp.getState();
  return { mode: s.mode, system: s.system, part: s.part, lesson: s.lesson, lab: s.lab, scenario: s.scenario, director: s.director, contextLost: s.contextLost };
});

export const go = (page: Page, p: Record<string, unknown>) => page.evaluate((q) => window.__fabStores.useApp.getState().go(q), p);
