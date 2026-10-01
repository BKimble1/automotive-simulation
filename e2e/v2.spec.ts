/**
 * V2 acceptance: what a visitor would notice, checked on real rendered frames and on the shared
 * model, not on triangle counts. Most tests drive the frame-stepped clock (every frame 1/30 s)
 * so results do not depend on how fast SwiftShader draws; one test runs on the browser's own
 * requestAnimationFrame. Heavier tests run on one or two of the four screen sizes.
 */
import { expect, test, type Page } from '@playwright/test';
import { app, frames, go, open } from './helpers';

const only = (names: string[]) => (_: unknown, info: { project: { name: string } }) => test.skip(!names.includes(info.project.name), `runs on ${names.join(', ')}`);

/** Draw one frame and measure it: mean and spread of luminance on a small copy of the canvas. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    window.__fabAdvance(1, true);
    const src = window.__fab.stage.renderer.domElement as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 54;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(src, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = 0;
    let s2 = 0;
    const n = c.width * c.height;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      s += l;
      s2 += l * l;
    }
    const mean = s / n;
    return { mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
  });

/** Where a part's centre is on screen (0 … 1 across the canvas), and whether it is in front of the camera. */
const onScreen = (page: Page, part: string) =>
  page.evaluate((name) => {
    const f = window.__fab;
    const n = f.car.rig.parts.get(name);
    const p = n.object.getWorldPosition(f.stage.camera.position.clone());
    const v = p.project(f.stage.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, front: v.z < 1 };
  }, part);

const beatStart = (page: Page, id: string) => page.evaluate((b) => window.__fab.player.beats.find((x: { beat: { id: string } }) => x.beat.id === b).start as number, id);

test.describe('V2: readiness, pause, isolation', () => {
  test('entering a buried part and a film chapter before the car is ready waits, then shows it from the start', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // the rest of the car is held back four seconds after the first picture
    await page.goto('./?virt=1&quality=low&prepdelay=4000&mode=watch&t=75');
    await page.waitForFunction(() => window.__fabStores?.useApp?.getState().ready, null, { timeout: 150_000 });
    const trace: { state: string; t: number; hood: number; cam: number[]; ready: boolean }[] = [];
    for (let i = 0; i < 200; i++) {
      await frames(page, 1);
      const r = await page.evaluate(() => ({
        state: window.__fab.director.state,
        t: window.__fab.player.t,
        hood: window.__fab.channels.get('body:hood'),
        cam: window.__fab.stage.camera.position.toArray(),
        ready: window.__fabStores.useApp.getState().carReady,
      }));
      trace.push(r);
      if (r.ready) break;
      await page.waitForTimeout(60);
    }
    const before = trace.filter((r) => !r.ready);
    expect(before.length).toBeGreaterThan(5);
    // while the car is not ready: the film holds at the chosen moment and nothing of the
    // destination happens (no bodywork fading, no camera move toward a subject not yet there)
    for (const r of before) {
      expect(r.t).toBeCloseTo(75, 3);
      expect(r.hood).toBe(0);
      expect(r.state === 'preparing' || r.state === 'paused' || r.state === 'idle').toBe(true);
    }
    expect(Math.hypot(...before[before.length - 1].cam.map((v, k) => v - before[0].cam[k]))).toBeLessThan(0.05);
    // once ready: it travels there and plays the step from where the link said
    await frames(page, 150);
    const after = await page.evaluate(() => ({ t: window.__fab.player.t, state: window.__fab.director.state, beat: window.__fab.player.beat.beat.id }));
    expect(after.t).toBeGreaterThan(75);
    expect(after.state).toBe('demonstrating');
    // the step at 75 s is the one played (not skipped while waiting)
    const at75 = await page.evaluate(() => window.__fab.player.beatAt(75).beat.id);
    expect([at75, await page.evaluate(() => window.__fab.player.beats[window.__fab.player.beatAt(75).index + 1]?.beat.id)]).toContain(after.beat);
    // the subject is in front of the camera and inside the picture
    const piston = await onScreen(page, 'piston-1');
    expect(piston.front).toBe(true);
    expect(piston.x).toBeGreaterThan(0.05);
    expect(piston.x).toBeLessThan(0.95);
    expect((await drawn(page)).std).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });

  test('a true pause holds the model, the motion, the camera and the narration for seconds, then resumes from the same state', async ({ page }, info) => {
    only(['desktop'])(null, info);
    const errors = await open(page, 'mode=watch');
    // cranking, a gear change, ABS working, the car coming apart, and sped-up heating
    for (const [id, into] of [['crank', 0.4], ['upshift', 0.45], ['with-abs', 0.2], ['explode', 0.3], ['thermostat-opens', 0.4]] as const) {
      const start = await beatStart(page, id);
      await page.evaluate((t) => window.__fab.seek(t), start + into * (await page.evaluate((b) => window.__fab.player.beats.find((x: { beat: { id: string } }) => x.beat.id === b).beat.duration, id)));
      for (let i = 0; i < 100 && (await page.evaluate(() => window.__fab.seekPending)); i++) {
        await frames(page, 1);
        await page.waitForTimeout(50);
      }
      await frames(page, 45);
      await page.evaluate(() => window.__fab.setPaused(true));
      await frames(page, 1);
      const snap = () =>
        page.evaluate(() => {
          const f = window.__fab;
          const s = f.model.s;
          const crank = f.car.rig.parts.get('crankshaft').object.quaternion.toArray();
          const wheel = f.car.rig.parts.get('wheel-RL')?.object.quaternion.toArray() ?? [];
          return { mt: s.t, crank: s.crank, coolant: s.coolantC, u: s.u, pt: f.player.t, cam: f.stage.camera.position.toArray(), ex: f.channels.get('explode:explode'), q: [...crank, ...wheel], narration: (window as unknown as { __fabNarration?: HTMLAudioElement }).__fabNarration?.paused ?? true };
        });
      const a = await snap();
      await frames(page, 150); // five seconds
      const b = await snap();
      expect(b, `${id}: frozen while paused`).toEqual(a);
      expect(b.narration).toBe(true);
      await page.evaluate(() => window.__fab.setPaused(false));
      await frames(page, 15);
      const c = await snap();
      expect(c.pt, `${id}: resumes`).toBeGreaterThan(a.pt);
      expect(c.mt).toBeGreaterThanOrEqual(a.mt);
      // from the same state: no jump in model time beyond what half a second of playback allows
      expect(c.pt - a.pt).toBeLessThan(0.6);
    }
    expect(errors).toEqual([]);
  });

  test('a run inherits nothing: gearing, braking, a fault, Explore, then a lab gives what a fresh visit gives', async ({ page, browser }, info) => {
    only(['desktop'])(null, info);
    // the baseline arrives from the worker while the car plays the same run (frames keep going)
    const results = async (p: Page) => {
      for (let i = 0; i < 200; i++) {
        const t = p.locator('.eng-results__title');
        if ((await t.count()) && /Baseline/.test((await t.first().textContent()) ?? '')) break;
        await frames(p, 3);
        await p.waitForTimeout(150);
      }
      await expect(p.locator('.eng-results__title')).toContainText('Baseline');
      return (await p.locator('.eng-results dd').allTextContents()).join(' | ');
    };
    const errors = await open(page, 'mode=engineer&lab=gearing');
    await results(page);
    await go(page, { lab: 'braking' });
    await results(page);
    await page.locator('.seg button', { hasText: 'Dry asphalt' }).click();
    await page.locator('.eng-actions .pbtn--accent').click();
    await frames(page, 60);
    await go(page, { mode: 'simulate', scenario: 'overheat' });
    await frames(page, 60);
    await page.getByRole('button', { name: 'Start the diagnosis' }).click();
    await go(page, { mode: 'explore', system: 'brakes' });
    await frames(page, 60);
    await go(page, { mode: 'engineer', lab: 'weight' });
    const after = await results(page);
    // a fresh page, straight into the same lab
    const fresh = await browser.newPage({ viewport: page.viewportSize()! });
    await open(fresh, 'mode=engineer&lab=weight');
    const first = await results(fresh);
    expect(after).toBe(first);
    expect(after).not.toMatch(/NaN|Infinity/);
    await fresh.close();
    expect(errors).toEqual([]);
  });
});

test.describe('V2: camera and continuity', () => {
  test('rapid reversals every 100–300 ms through car, engine, brakes, differential, cabin, exploded and opened: no clamp, no snap, exact baselines after', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors = await open(page, 'mode=explore');
    await frames(page, 60);
    const NODES = ['panel-hood', 'panel-doorFL', 'panel-trunk', 'cam-cover', 'cylinder-head', 'oil-pan', 'door-trim-FL', 'radiator', 'battery'];
    const pose = () => page.evaluate((names) => names.map((n) => { const o = window.__fab.car.rig.parts.get(n).object; return [...o.position.toArray(), ...o.quaternion.toArray()]; }), NODES);
    const base = await pose();
    await page.evaluate(() => {
      window.__fab.telemetry.on = true;
      window.__fab.telemetry.frames = [];
    });
    const clamps0 = await page.evaluate(() => window.__fab.camera.clamps.frames);
    const route: Record<string, unknown>[] = [{ system: 'power' }, { system: 'brakes' }, { system: 'driveline', part: 'differential' }, { system: 'cabin' }, { system: null, part: null }];
    // forward, reversing after 3–9 frames (100–300 ms) half the time
    let k = 0;
    for (let i = 0; i < route.length; i++) {
      await go(page, route[i]);
      await frames(page, 3 + (k++ % 7));
      if (i > 0) {
        await go(page, route[i - 1]);
        await frames(page, 3 + (k++ % 7));
        await go(page, route[i]);
      }
      await frames(page, 20);
    }
    // the whole car taken apart, interrupted by opened, then back to explained
    for (const v of ['Exploded', 'Opened', 'Exploded', 'Explained']) {
      await page.locator('.ex-views button', { hasText: v }).click();
      await frames(page, 5);
    }
    // a re-request of the view being approached does not restart it
    const move = await page.evaluate(() => window.__fab.camera.transitionId);
    await go(page, { system: null, part: null });
    await frames(page, 2);
    expect(await page.evaluate(() => window.__fab.camera.transitionId)).toBe(move);
    await frames(page, 150);
    const tel = await page.evaluate(() => window.__fab.telemetry.frames as { cam: number[] }[]);
    let worst = 0;
    for (let i = 2; i < tel.length; i++) {
      const [a, b, c] = [tel[i - 2].cam, tel[i - 1].cam, tel[i].cam];
      expect(c[1]).toBeGreaterThan(0.07);
      const d1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const d2 = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
      if (d2 > 0.02) worst = Math.max(worst, d2 / Math.max(d1, 0.01));
    }
    expect(worst).toBeLessThan(3);
    expect(await page.evaluate(() => window.__fab.camera.clamps.frames)).toBe(clamps0);
    // every panel and taken-apart part back exactly where it was built
    const end = await pose();
    for (let i = 0; i < NODES.length; i++) for (let j = 0; j < 7; j++) expect(Math.abs(end[i][j] - base[i][j]), `${NODES[i]}[${j}]`).toBeLessThan(1e-9);
    expect((await drawn(page)).std).toBeGreaterThan(8);
    expect(errors).toEqual([]);
  });

  test('Recentre appears once the visitor moves the camera, and brings the framing back', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors = await open(page, 'mode=explore&system=brakes');
    await frames(page, 90);
    await expect(page.locator('.recentre')).toHaveCount(0);
    const box = (await page.locator('canvas.stage').boundingBox())!;
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.3;
    await page.evaluate(([x, y]) => {
      const c = document.querySelector('canvas.stage')!;
      const fire = (type: string, dx: number) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x + dx, clientY: y, bubbles: true, isPrimary: true, pointerType: 'mouse', buttons: type === 'pointerup' ? 0 : 1 }));
      fire('pointerdown', 0);
      for (let i = 1; i <= 12; i++) fire('pointermove', i * 18);
      fire('pointerup', 216);
    }, [cx, cy]);
    await frames(page, 30);
    await expect(page.locator('.recentre')).toBeVisible();
    await page.locator('.recentre').click();
    await frames(page, 90);
    await expect(page.locator('.recentre')).toHaveCount(0);
    expect(await page.evaluate(() => window.__fab.camera.offFraming)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('intermediate frames of transitions are drawn, never blank, with the subject in the picture when it arrives', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors = await open(page, 'mode=explore');
    await frames(page, 30);
    for (const [place, part] of [[{ system: 'power', part: 'piston' }, 'piston-1'], [{ system: 'brakes', part: 'brake-caliper' }, 'caliper-FL'], [{ system: 'driveline', part: 'differential' }, 'diff-carrier']] as const) {
      await go(page, place);
      for (let i = 0; i < 8; i++) {
        await frames(page, 4);
        const f = await drawn(page);
        expect(f.std, `${part} frame ${i}`).toBeGreaterThan(6);
      }
      await frames(page, 60);
      const s = await onScreen(page, part);
      if (s.front) {
        expect(s.x).toBeGreaterThan(0.02);
        expect(s.x).toBeLessThan(0.98);
        expect(s.y).toBeGreaterThan(0.02);
        expect(s.y).toBeLessThan(0.98);
      }
    }
    expect(errors).toEqual([]);
  });

  test('no shader is compiled for the first time during a move, on any view', async ({ page }, info) => {
    only(['desktop'])(null, info);
    test.setTimeout(900_000);
    // a smaller canvas: the software renderer draws every sampled frame of every move
    await page.setViewportSize({ width: 960, height: 540 });
    const errors = await open(page, 'mode=explore');
    await frames(page, 30);
    await page.evaluate(() => window.__fabAdvance(1, true));
    const programs = () => page.evaluate(() => window.__fab.stage.renderer.info.programs?.length ?? 0);
    const p0 = await programs();
    // draw a frame every 0.2 s through each move
    const through = async (n: number) => {
      // (advancing several frames draws the last of them)
      for (let i = 0; i < n; i++) await page.evaluate(() => window.__fabAdvance(6, false));
    };
    for (const system of ['power', 'air', 'cooling', 'driveline', 'chassis', 'brakes', 'electrical', 'body', 'cabin', 'safety']) {
      await go(page, { system, part: null });
      await through(10);
      for (const v of ['Cutaway', 'Opened', 'Exterior']) {
        const b = page.locator('.ex-views button', { hasText: v });
        if (await b.count()) {
          await b.click();
          await through(8);
        }
      }
    }
    expect(await programs()).toBe(p0);
    expect(errors).toEqual([]);
  });
});

test.describe('V2: the driving workbench', () => {
  const car = (page: Page) =>
    page.evaluate(() => {
      const s = window.__fab.model.s;
      return { engine: s.engine, sel: s.selector, gear: s.gear, kmh: s.u * 3.6, steer: s.steerAngle[0], msg: window.__fab.driver.message, program: window.__fab.model.program };
    });

  test('keys: start, Drive, creep, accelerate, steer, refuse Reverse at speed, brake, reverse, Park, stop, reset', async ({ page }, info) => {
    only(['desktop', 'laptop'])(null, info);
    const errors = await open(page, 'mode=simulate&scenario=drive');
    await frames(page, 30);
    expect((await car(page)).engine).toBe('off');
    await page.keyboard.press('Shift+D');
    await frames(page, 2);
    expect((await car(page)).sel).toBe('P');
    expect((await car(page)).msg).toMatch(/brake/i);
    await page.locator('.wb-start').click();
    await frames(page, 75);
    expect((await car(page)).engine).toBe('running');
    await page.keyboard.down('s');
    await frames(page, 15);
    await page.keyboard.press('Shift+D');
    await frames(page, 5);
    await page.keyboard.up('s');
    expect((await car(page)).sel).toBe('D');
    await frames(page, 75);
    expect((await car(page)).kmh).toBeGreaterThan(0.5); // creep
    await page.keyboard.down('w');
    await frames(page, 150);
    const fast = await car(page);
    expect(fast.kmh).toBeGreaterThan(30);
    expect(fast.gear).toBeGreaterThanOrEqual(2);
    expect(fast.program).toBeNull(); // no script drives a manual run
    await page.keyboard.down('a');
    await frames(page, 30);
    expect((await car(page)).steer).toBeGreaterThan(0.01);
    await page.keyboard.up('a');
    await page.keyboard.press('r');
    await frames(page, 2);
    expect((await car(page)).sel).toBe('D');
    await page.keyboard.up('w');
    await page.keyboard.down(' ');
    await frames(page, 180);
    await page.keyboard.up(' ');
    expect(Math.abs((await car(page)).kmh)).toBeLessThan(1);
    await page.keyboard.down('s');
    await frames(page, 10);
    await page.keyboard.press('r');
    await frames(page, 5);
    await page.keyboard.up('s');
    expect((await car(page)).sel).toBe('R');
    await page.keyboard.down('w');
    await frames(page, 90);
    await page.keyboard.up('w');
    expect((await car(page)).kmh).toBeLessThan(-1); // backwards
    await page.keyboard.down('s');
    await frames(page, 90);
    await page.keyboard.press('p');
    await frames(page, 5);
    await page.keyboard.up('s');
    expect((await car(page)).sel).toBe('P');
    await page.keyboard.press('Enter');
    await frames(page, 30);
    expect((await car(page)).engine).toBe('off');
    // a search field keeps its keys
    await page.locator('.wb-start').click();
    await frames(page, 75);
    await page.getByRole('button', { name: 'Reset: parked, engine off' }).click();
    await frames(page, 5);
    const reset = await car(page);
    expect(reset.engine).toBe('off');
    expect(reset.sel).toBe('P');
    expect(Math.abs(reset.kmh)).toBeLessThan(0.01);
    expect(errors).toEqual([]);
  });

  test('touch: steering and throttle held together; leaving the window or a cancelled pointer lets go', async ({ page }, info) => {
    only(['phone', 'tablet'])(null, info);
    const errors = await open(page, 'mode=simulate&scenario=drive');
    await frames(page, 30);
    await page.locator('.wb-start').click();
    await frames(page, 75);
    await page.evaluate(() => {
      const d = window.__fab.driver;
      d.pads.brake = 1;
    });
    await frames(page, 10);
    await page.locator('.wb-selector button', { hasText: 'D' }).click();
    await page.evaluate(() => (window.__fab.driver.pads.brake = null));
    await frames(page, 10);
    expect((await car(page)).sel).toBe('D');
    const fire = (sel: string, type: string, id: number, fx: number, fy: number) =>
      page.evaluate(
        ([sel, type, id, fx, fy]) => {
          const el = document.querySelector(sel as string)!;
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new PointerEvent(type as string, { pointerId: id as number, clientX: r.x + r.width * (fx as number), clientY: r.y + r.height * (fy as number), bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
        },
        [sel, type, id, fx, fy] as const,
      );
    await fire('.pad--throttle', 'pointerdown', 1, 0.5, 0.3);
    await fire('.pad--steer', 'pointerdown', 2, 0.15, 0.5);
    await frames(page, 60);
    const both = await page.evaluate(() => ({ t: window.__fab.driver.throttle, s: window.__fab.driver.steer, cam: window.__fab.camera.isDragging }));
    expect(both.t).toBeGreaterThan(0.3);
    expect(Math.abs(both.s)).toBeGreaterThan(0.05);
    expect(both.cam).toBe(false); // the pads never orbit the camera
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await frames(page, 45);
    const released = await page.evaluate(() => ({ pads: window.__fab.driver.pads, t: window.__fab.driver.throttle }));
    expect(released.pads).toEqual({ throttle: null, brake: null, steer: null });
    expect(released.t).toBe(0);
    await fire('.pad--brake', 'pointerdown', 3, 0.5, 0.2);
    await frames(page, 5);
    await fire('.pad--brake', 'pointercancel', 3, 0.5, 0.2);
    await frames(page, 30);
    expect(await page.evaluate(() => window.__fab.driver.pads.brake)).toBeNull();
    expect(errors).toEqual([]);
  });
});

test.describe('V2: diagnosis, context loss, cancellation', () => {
  test('every fault case: a wrong and a right conclusion, the reveal, a repair whose consequences the model shows, and a clean restart', async ({ page }, info) => {
    only(['desktop'])(null, info);
    test.setTimeout(600_000);
    const errors = await open(page, 'mode=simulate');
    for (const id of ['misfire', 'overheat', 'charging', 'oil-pressure', 'bouncing', 'slow-crank']) {
      await go(page, { scenario: id });
      await frames(page, 45);
      await page.getByRole('button', { name: 'Start the diagnosis' }).click();
      const rows = page.locator('.checks .ex-row');
      await rows.nth(0).click();
      await rows.nth(1).click();
      await expect(page.locator('.finding').first()).toBeVisible();
      await page.getByRole('button', { name: 'Take measurements' }).click();
      await expect(page.locator('.ex-facts')).toBeVisible();
      await page.getByRole('button', { name: 'Decide the cause' }).click();
      const causes = page.locator('.cause');
      const n = await causes.count();
      // every answer, each judged; then the right one chosen
      let sawWrong = false;
      let right = -1;
      for (let i = 0; i < n; i++) {
        await causes.nth(i).click();
        if (await page.locator('.verdict--right').count()) right = i;
        else {
          await expect(page.locator('.verdict--wrong')).toBeVisible();
          sawWrong = true;
        }
      }
      expect(right, `${id}: one right answer`).toBeGreaterThanOrEqual(0);
      await causes.nth(right).click();
      expect(sawWrong, `${id}: a wrong answer was tried`).toBe(true);
      await page.getByRole('button', { name: 'Show what failed' }).click();
      await frames(page, 30);
      await page.getByRole('button', { name: 'Repair it' }).click();
      const faults = await page.evaluate(() => ({ ...window.__fab.model.faults }));
      // healthy: no flag set, no cylinder or corner named (−1)
      for (const [k, v] of Object.entries(faults)) expect(typeof v === 'number' ? v : v ? 1 : 0, `${id}: ${k} cleared`).toBe(typeof v === 'number' ? -1 : 0);
      const before = await page.evaluate(() => ({ c: window.__fab.model.s.coolantC, soc: window.__fab.model.s.soc }));
      await frames(page, 240);
      const s = await page.evaluate(() => {
        const s = window.__fab.model.s;
        return { comb: [...s.combustion], volts: s.volts, oil: s.oilBar, c: s.coolantC, soc: s.soc, engine: s.engine, thermostat: s.thermostat, battery: s.batteryAmps };
      });
      if (id === 'misfire') expect(s.comb).toEqual([1, 1, 1, 1]);
      // charging again: the run-down battery takes current (its voltage climbs as it fills)
      if (id === 'charging') {
        expect(s.battery).toBeLessThan(0);
        expect(s.volts).toBeGreaterThan(13);
      }
      if (id === 'oil-pressure') expect(s.oil).toBeGreaterThan(1);
      if (id === 'overheat') {
        // the thermostat opened and the coolant came down to regulated temperature
        expect(s.c).toBeLessThan(Math.max(95, before.c - 2));
      }
      if (id === 'slow-crank') expect(s.soc).toBeGreaterThan(0.9);
      // restart: the case from its beginning, its fault back, the steps cleared
      await page.getByRole('button', { name: 'Restart this case' }).click();
      await frames(page, 10);
      await expect(page.getByRole('button', { name: 'Start the diagnosis' })).toBeVisible();
      const again = await page.evaluate(() => Object.values(window.__fab.model.faults).some((v) => (typeof v === 'number' ? v >= 0 : !!v)));
      expect(again, `${id}: fault back after restart`).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('losing the graphics context while paused keeps the pause and the moment; during a lab the result still arrives', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors = await open(page, 'mode=watch&t=40');
    await frames(page, 30);
    await page.evaluate(() => window.__fab.setPaused(true));
    await frames(page, 1);
    const t0 = await page.evaluate(() => [window.__fab.player.t, window.__fab.model.s.t]);
    expect(await page.evaluate(() => window.__fab.stage.loseContext(500))).toBe(true);
    await expect.poll(async () => (await app(page)).contextLost).toBe(true);
    await frames(page, 30);
    await page.waitForTimeout(900);
    await frames(page, 5);
    await expect.poll(async () => (await app(page)).contextLost, { timeout: 20_000 }).toBe(false);
    await frames(page, 30);
    expect(await page.evaluate(() => [window.__fab.player.t, window.__fab.model.s.t])).toEqual(t0);
    expect(await page.evaluate(() => window.__fab.paused)).toBe(true);
    await page.evaluate(() => window.__fab.setPaused(false));
    await frames(page, 30);
    const t1 = await page.evaluate(() => window.__fab.player.t);
    // no catch-up after the outage: one second of film for one second of frames
    expect(t1 - t0[0]).toBeGreaterThan(0.5);
    expect(t1 - t0[0]).toBeLessThan(1.5);
    // a lab computed while the context is lost
    await go(page, { mode: 'engineer', lab: 'engine' });
    expect(await page.evaluate(() => window.__fab.stage.loseContext(400))).toBe(true);
    await page.waitForTimeout(800);
    await frames(page, 10);
    await expect(page.locator('.eng-results__title')).toContainText('Baseline', { timeout: 60_000 });
    await expect(page.locator('.eng-results')).not.toContainText('NaN');
    expect(errors.filter((e) => !/context/i.test(e))).toEqual([]);
  });

  test('leaving a lab while it computes cancels it; changing quality during a reveal finishes the move', async ({ page }, info) => {
    only(['desktop'])(null, info);
    const errors = await open(page, 'mode=engineer&lab=gearing');
    await go(page, { lab: 'engine' });
    await go(page, { mode: 'explore', system: 'power' });
    await frames(page, 4);
    await page.evaluate(() => window.__fabStores.useQuality.setState({ tier: 'medium' }));
    await frames(page, 6);
    await page.evaluate(() => window.__fabStores.useQuality.setState({ tier: 'low' }));
    await frames(page, 120);
    expect(['demonstrating', 'free-explore']).toContain(await page.evaluate(() => window.__fab.director.state));
    await page.waitForTimeout(1500);
    await frames(page, 10);
    // nothing of the abandoned lab arrived: no lab run, no lab panel
    expect(await page.evaluate(() => window.__fab.live?.id ?? null)).not.toMatch(/^lab:/);
    await expect(page.locator('.eng')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('V2: layout and endurance', () => {
  test('every mode on desktop, short laptop, tablets both ways and two phones: no overflow, 44 px targets, room for the car', async ({ browser }, info) => {
    only(['desktop'])(null, info);
    test.setTimeout(900_000);
    const sizes = [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'short laptop', width: 1366, height: 640 },
      { name: 'tablet portrait', width: 820, height: 1180, touch: true },
      { name: 'tablet landscape', width: 1180, height: 820, touch: true },
      { name: 'phone', width: 390, height: 844, touch: true, mobile: true },
      { name: 'small phone', width: 360, height: 640, touch: true, mobile: true },
    ];
    const places = ['', 'mode=watch&t=60', 'mode=explore&system=brakes&part=brake-caliper', 'mode=engineer&lab=braking', 'mode=simulate&scenario=drive', 'mode=simulate&scenario=overheat'];
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, hasTouch: !!s.touch, isMobile: !!s.mobile, deviceScaleFactor: s.mobile ? 2 : 1 });
      const page = await ctx.newPage();
      const errors = await open(page, places[0]);
      for (const q of places) {
        if (q) {
          await page.goto(`./?virt=1&quality=low&${q}`);
          await page.waitForFunction(() => window.__fabStores?.useApp?.getState().carReady, null, { timeout: 150_000 });
        }
        await frames(page, 45);
        const where = `${s.name} ${q || 'intro'}`;
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), where).toBeLessThanOrEqual(0);
        // every header control has a 44 px target: a point 21 px either side of its centre hits it
        const misses = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of Array.from(document.querySelectorAll('.top button, .top a, .tabs .tab'))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
            const cx = r.x + r.width / 2;
            const cy = r.y + r.height / 2;
            for (const [dx, dy] of [[0, -21], [0, 21], [-21, 0], [21, 0]]) {
              // (a point past the screen's edge is not a place a finger can be)
              if (cx + dx < 0 || cx + dx >= window.innerWidth || cy + dy < 0 || cy + dy >= window.innerHeight) continue;
              const hit = document.elementFromPoint(cx + dx, cy + dy);
              if (!hit || !(el === hit || el.contains(hit))) {
                // a neighbouring control may own that point; only a dead spot is a miss
                if (!hit?.closest('button, a')) out.push(`${el.getAttribute('aria-label') ?? el.textContent} ${dx},${dy}`);
              }
            }
          }
          return out;
        });
        expect(misses, where).toEqual([]);
        // the car keeps a usable part of the screen
        const free = await page.evaluate(() => window.__fab.camera.free as { l: number; t: number; r: number; b: number });
        expect((free.r - free.l) * (free.b - free.t), where).toBeGreaterThan(0.18);
      }
      expect(errors).toEqual([]);
      await ctx.close();
    }
  });

  test('ten minutes of mixed use: resources settle and nothing accumulates', async ({ page }, info) => {
    only(['desktop'])(null, info);
    test.setTimeout(1_200_000);
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const count = { listeners: 0, workers: 0, contexts: 0, audio: 0 };
      w.__count = count;
      const add = EventTarget.prototype.addEventListener;
      const rem = EventTarget.prototype.removeEventListener;
      const seen = new WeakMap<object, Set<unknown>>();
      EventTarget.prototype.addEventListener = function (type: string, fn: unknown, o?: unknown) {
        if (this === window || this === document) {
          const set = seen.get(this) ?? new Set();
          const key = `${type}:${String((fn as object)?.toString?.().length)}`;
          if (!set.has(fn)) count.listeners++;
          set.add(fn);
          seen.set(this, set);
          void key;
        }
        return add.call(this, type, fn as EventListener, o as AddEventListenerOptions);
      };
      EventTarget.prototype.removeEventListener = function (type: string, fn: unknown, o?: unknown) {
        if ((this === window || this === document) && seen.get(this)?.delete(fn)) count.listeners--;
        return rem.call(this, type, fn as EventListener, o as EventListenerOptions);
      };
      const W = window.Worker;
      window.Worker = class extends W {
        constructor(u: string | URL, o?: WorkerOptions) {
          super(u, o);
          count.workers++;
          const t = this.terminate.bind(this);
          this.terminate = () => {
            count.workers--;
            t();
          };
        }
      } as typeof Worker;
      const gc = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, o?: unknown) {
        if (id === 'webgl2' && !(this as unknown as { __c?: boolean }).__c) {
          (this as unknown as { __c?: boolean }).__c = true;
          count.contexts++;
        }
        return gc.call(this, id as '2d', o as CanvasRenderingContext2DSettings);
      } as typeof gc;
      const A = window.Audio;
      window.Audio = class extends A {
        constructor(s?: string) {
          super(s);
          count.audio++;
        }
      } as typeof Audio;
    });
    const errors = await open(page, 'mode=explore');
    const measure = () =>
      page.evaluate(() => {
        const r = window.__fab.stage.renderer.info;
        const c = (window as unknown as { __count: Record<string, number> }).__count;
        return { geometries: r.memory.geometries, textures: r.memory.textures, programs: r.programs?.length ?? 0, ...c, simT: window.__fab.counters.frames / 30 } as Record<string, number>;
      });
    const cycle = async () => {
      for (const system of ['power', 'brakes', 'driveline', null]) {
        await go(page, { mode: 'explore', system, part: null });
        await frames(page, 60);
      }
      await go(page, { mode: 'engineer', lab: 'braking' });
      await expect(page.locator('.eng-results__title')).toContainText('Baseline', { timeout: 60_000 });
      await frames(page, 300);
      await go(page, { mode: 'simulate', scenario: 'drive' });
      await frames(page, 20);
      await page.locator('.wb-start').click();
      await frames(page, 60);
      await page.keyboard.down('s');
      await page.keyboard.press('Shift+D');
      await page.keyboard.up('s');
      await page.keyboard.down('w');
      await frames(page, 150);
      await page.keyboard.up('w');
      await page.keyboard.down(' ');
      await frames(page, 90);
      await page.keyboard.up(' ');
      await go(page, { mode: 'simulate', scenario: 'overheat' });
      await frames(page, 150);
      await go(page, { mode: 'watch' });
      await page.evaluate(() => window.__fab.seek(120 + Math.random() * 200));
      await frames(page, 400);
      await page.evaluate(() => window.__fabAdvance(1, true));
      await go(page, { mode: 'intro' });
      await frames(page, 60);
    };
    // warm up: every step of the film drawn once (each view's parts reach the GPU the first
    // time they are drawn), then two cycles of everything else
    await go(page, { mode: 'watch' });
    const starts = await page.evaluate(() => window.__fab.player.beats.map((b: { start: number }) => b.start));
    for (const t of starts) {
      await page.evaluate((t) => window.__fab.seek(t + 0.5), t);
      for (let i = 0; i < 100 && (await page.evaluate(() => !!window.__fab.seekPending)); i++) {
        await frames(page, 1);
        await page.waitForTimeout(30);
      }
      await frames(page, 45);
    }
    await cycle();
    await cycle();
    const warm = await measure();
    while ((await measure()).simT < 600) await cycle();
    const end = await measure();
    expect(end.simT).toBeGreaterThanOrEqual(600);
    for (const k of ['geometries', 'textures', 'programs'] as const) expect(end[k], k).toBeLessThanOrEqual(warm[k] + 2);
    for (const k of ['listeners', 'workers', 'contexts', 'audio'] as const) expect(end[k], k).toBe(warm[k]);
    // the scene's context, and the start-up probe (released at once)
    expect(end.contexts).toBeLessThanOrEqual(2);
    expect(end.workers).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});

test.describe('V2: real time', () => {
  test('on the browser’s own frames the film keeps one clock, holds when paused and never catches up after a slow frame', async ({ page }, info) => {
    only(['desktop', 'phone'])(null, info);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // a small canvas: the software renderer draws several frames a second
    await page.setViewportSize({ width: 480, height: 300 });
    await page.goto('./?hooks=1&quality=low&mode=watch&t=30');
    await page.waitForFunction(() => window.__fabStores?.useApp?.getState().carReady, null, { timeout: 150_000 });
    await page.waitForFunction(() => !window.__fabStores.usePlayer.getState().holding, null, { timeout: 90_000 });
    // the film's time against the frames actually drawn: each frame moves it by its own
    // interval, capped at 1/15 s (a stall never jumps the film), and nothing else moves it
    const r = await page.evaluate(
      () =>
        new Promise<{ advance: number; expected: number; frames: number; held: boolean }>((resolve) => {
          const p = window.__fab.player;
          const t0 = p.t;
          let expected = 0;
          let frames = 0;
          let held = false;
          let last = performance.now();
          const start = last;
          const loop = (now: number) => {
            const raw = (now - last) / 1000;
            last = now;
            frames++;
            if (window.__fabStores.usePlayer.getState().holding) held = true;
            expected += Math.min(1 / 15, raw);
            if (now - start < 3000) requestAnimationFrame(loop);
            else resolve({ advance: p.t - t0, expected, frames, held });
          };
          requestAnimationFrame((now) => {
            last = now;
            requestAnimationFrame(loop);
          });
        }),
    );
    expect(r.frames).toBeGreaterThan(3);
    if (!r.held) expect(Math.abs(r.advance - r.expected)).toBeLessThan(0.25);
    expect(r.advance).toBeLessThanOrEqual(3.2);
    await page.getByRole('button', { name: 'Pause' }).click();
    const p0 = await page.evaluate(() => window.__fab.player.t);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__fab.player.t)).toBe(p0);
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__fab.player.t)).toBeGreaterThan(p0);
    expect(errors).toEqual([]);
  });
});
