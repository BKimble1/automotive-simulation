import { expect, test } from '@playwright/test';
import { app, frames, go, open } from './helpers';

test('opens on the car, with the four ways in and no errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('AUTOMOTIVE / ONE');
  for (const m of ['Watch', 'Explore', 'Engineer', 'Simulate']) await expect(page.locator('.card', { hasText: m }).first()).toBeVisible();
  await frames(page, 30);
  expect(await page.evaluate(() => window.__fab.stage.stats.calls)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('deep link into a part, then Back up the hierarchy, with the address following', async ({ page }) => {
  await open(page, 'mode=explore&system=brakes&part=brake-caliper');
  await frames(page, 90);
  await expect(page.locator('.ex h2')).toHaveText('Brake calipers');
  expect((await app(page)).part).toBe('brake-caliper');
  await page.locator('.ex-back').click();
  await frames(page, 60);
  await expect(page.locator('.ex h2')).toHaveText('Wheel brakes');
  expect(page.url()).toContain('part=wheel-brakes');
  await page.locator('.ex-back').click();
  await frames(page, 60);
  await expect(page.locator('.ex h2')).toHaveText('Brakes');
  expect(page.url()).not.toContain('part=');
  await page.locator('.ex-back').click();
  await frames(page, 60);
  await expect(page.locator('.ex h2')).toHaveText('The car');
  expect(page.url()).not.toContain('system=');
});

test('search finds a part by another name and goes there', async ({ page }) => {
  await open(page, 'mode=explore');
  await page.locator('.ex-search input').fill('crown wheel');
  await page.locator('.ex-row', { hasText: 'Ring gear' }).first().click();
  await frames(page, 90);
  await expect(page.locator('.ex h2')).toHaveText('Ring gear');
  expect((await app(page)).system).toBe('driveline');
});

test('the film starts where a shared link says, with chapters and captions', async ({ page }) => {
  await open(page, 'mode=watch&t=120');
  await frames(page, 10);
  const t = await page.evaluate(() => window.__fab.player.t);
  expect(t).toBeGreaterThanOrEqual(120);
  expect(await page.evaluate(() => window.__fab.player.seq.id)).toBe('film');
  await expect(page.locator('.captions')).toBeVisible();
  await page.locator('.lesson__chapter').click();
  await expect(page.locator('.chapters li')).toHaveCount(11);
  await page.locator('.chapters button', { hasText: 'Braking' }).click();
  const t2 = await page.evaluate(() => window.__fab.player.t);
  expect(t2).toBeGreaterThan(250);
});

test('a lab runs its baseline, compares a change, and the car ends where the chart does', async ({ page }) => {
  await open(page, 'mode=engineer&lab=braking');
  await expect(page.locator('.eng h2')).toHaveText('Stopping distance');
  // the baseline (design values) runs at once: its numbers, and the same run on the car
  await expect(page.locator('.eng-results')).toContainText('Stopping distance');
  await expect(page.locator('.eng-results__title')).toContainText('Baseline');
  expect(await page.evaluate(() => window.__fab.live?.id)).toBe('lab:braking');
  // a change: dry asphalt
  await page.locator('.seg button', { hasText: 'Dry asphalt' }).click();
  await page.locator('.eng-actions .pbtn--accent').click();
  await expect(page.locator('.eng-results__title')).toContainText('Dry asphalt');
  await expect(page.locator('.chart__run')).toHaveCount(2);
  // play the live run to its end: the car stops where the chart says it does
  for (let i = 0; i < 20; i++) {
    await frames(page, 30);
    if ((await page.evaluate(() => window.__fabStores.useRun.getState().status)) === 'ended') break;
  }
  expect(await page.evaluate(() => window.__fabStores.useRun.getState().status)).toBe('ended');
  const chart = Number((await page.locator('.eng-results dd').first().textContent())!.replace(/[^0-9.]/g, ''));
  const car = await page.evaluate(() => window.__fab.model.s.stopDistance);
  expect(Math.abs(car - chart)).toBeLessThan(0.1);
});

test('a fault can be diagnosed from complaint to repair', async ({ page }) => {
  await open(page, 'mode=simulate&scenario=overheat');
  await frames(page, 30);
  await page.getByRole('button', { name: 'Start the diagnosis' }).click();
  await page.locator('.ex-row__name', { hasText: 'Radiator hoses' }).click();
  await page.locator('.ex-row__name', { hasText: 'Coolant level' }).click();
  await expect(page.locator('.finding').first()).toBeVisible();
  await page.getByRole('button', { name: 'Take measurements' }).click();
  await page.getByRole('button', { name: 'Decide the cause' }).click();
  await page.locator('.cause', { hasText: 'A coolant leak' }).click();
  await expect(page.locator('.verdict--wrong')).toBeVisible();
  await page.locator('.cause', { hasText: 'The thermostat stuck shut' }).click();
  await page.getByRole('button', { name: 'Show what failed' }).click();
  await page.getByRole('button', { name: 'Repair it' }).click();
  expect(await page.evaluate(() => window.__fab.model.faults.thermostatStuckClosed)).toBe(false);
});

test('camera continuity: no jumps, no blank frames, never under the floor', async ({ page }) => {
  await open(page, 'mode=explore');
  await page.evaluate(() => {
    window.__fab.telemetry.on = true;
    window.__fab.telemetry.frames = [];
  });
  const route: Record<string, unknown>[] = [{ system: 'power' }, { system: 'brakes' }, { system: 'driveline', part: 'differential' }, { system: 'body' }, { system: null, part: null }];
  for (const r of route) {
    await go(page, r);
    await frames(page, 25);
    // interrupt mid-move with the next request half the time
  }
  await frames(page, 90);
  const tel = await page.evaluate(() => window.__fab.telemetry.frames as { cam: number[]; fov: number; state: string }[]);
  expect(tel.length).toBeGreaterThan(200);
  let maxJumpRatio = 0;
  for (let i = 2; i < tel.length; i++) {
    const [a, b, c] = [tel[i - 2].cam, tel[i - 1].cam, tel[i].cam];
    for (const v of c) expect(Number.isFinite(v)).toBe(true);
    expect(c[1]).toBeGreaterThan(0.07);
    const d1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const d2 = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    // a frame's step is never wildly larger than the one before (a snap)
    if (d2 > 0.02) maxJumpRatio = Math.max(maxJumpRatio, d2 / Math.max(d1, 0.01));
  }
  expect(maxJumpRatio).toBeLessThan(3);
  // a drawn frame is never empty
  const pixels = await page.evaluate(() => {
    window.__fabAdvance(1, true);
    return window.__fab.stage.stats.triangles;
  });
  expect(pixels).toBeGreaterThan(1000);
});

test('survives losing the graphics context', async ({ page }) => {
  await open(page);
  await frames(page, 10);
  expect(await page.evaluate(() => window.__fab.stage.loseContext(400))).toBe(true);
  await expect.poll(async () => (await app(page)).contextLost).toBe(true);
  await expect(page.locator('.notice[role=alert]')).toBeVisible();
  await page.waitForTimeout(800);
  await frames(page, 5);
  await expect.poll(async () => (await app(page)).contextLost, { timeout: 20_000 }).toBe(false);
  await frames(page, 5);
  expect(await page.evaluate(() => window.__fab.stage.stats.calls)).toBeGreaterThan(10);
});

test('says plainly when 3D is not available', async ({ page }) => {
  await page.goto('./?nowebgl=1');
  await expect(page.getByText('This simulation needs 3D graphics (WebGL 2).')).toBeVisible();
});

test('respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  expect(await page.evaluate(() => window.__fabStores.useApp.getState().reducedMotion)).toBe(true);
  expect(await page.evaluate(() => window.__fab.camera.reducedMotion)).toBe(true);
});

test('the layout keeps the controls usable and nothing overflows', async ({ page }, info) => {
  await open(page, 'mode=explore&system=power');
  await frames(page, 30);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // the mode tabs are reachable on every size
  await expect(page.locator('.tabs .tab', { hasText: 'Watch' })).toBeVisible();
  const panel = await page.locator('.ex').boundingBox();
  expect(panel).not.toBeNull();
  if (info.project.name === 'phone') {
    // a bottom sheet across the screen
    expect(panel!.width).toBeGreaterThan(330);
    expect(panel!.y).toBeGreaterThan(300);
  }
});
