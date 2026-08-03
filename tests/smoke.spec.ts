import { expect, test, type Page } from '@playwright/test';

interface Debug {
  generation: number;
  frame: number;
  alive: number;
  bestX: number;
  stepsPerSecond: number;
  paused: boolean;
  speed: number | string;
  seed: string;
  replaying: boolean;
  hallOfFame: number;
  trackSignature: number;
  mode: '2d' | '3d';
  ready: boolean;
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __gcars: { debug: () => Debug } }).__gcars.debug());

/**
 * The page opens in 3D, and Box3D has to compile its WebAssembly before there
 * is a world at all, so every test waits for that rather than for the app
 * object alone.
 */
async function open(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(() => (window as any).__gcars?.debug().ready === true, null, {
    timeout: 60_000,
  });
}

/**
 * Make sure one of the sidebar sections is open.
 *
 * They are `details` elements, and a `summary` is not exposed as a button, so
 * this goes by its text. Idempotent on purpose: several of them open by
 * default now, and a helper called "open" that toggles would close them.
 */
async function openSection(page: Page, name: string): Promise<void> {
  const summary = page.locator('summary', { hasText: name });
  const details = summary.locator('xpath=..');
  if (await details.evaluate((el) => (el as HTMLDetailsElement).open)) return;
  await summary.click();
  await details.evaluate((el) => (el as HTMLDetailsElement).open);
}

/** Drop to the flat mode, which is instant and much cheaper to drive. */
async function goFlat(page: Page): Promise<void> {
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '2d');
}

/** Fail the test on any console error or uncaught exception. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test('opens in 3D and drives cars forward', async ({ page }) => {
  const errors = watchForErrors(page);
  await open(page);

  await expect(page.locator('h1')).toHaveText('BoxCar3D');

  const initial = await debug(page);
  expect(initial.mode).toBe('3d');
  expect(initial.alive).toBe(20);
  expect(initial.seed).toMatch(/^[a-z0-9]+$/);

  await page.waitForFunction(() => (window as any).__gcars.debug().frame > 60, null, {
    timeout: 20_000,
  });
  expect((await debug(page)).bestX).toBeGreaterThan(0);

  // The 3D canvas is the one on screen; the flat one waits behind it.
  await expect(page.locator('#view3d')).toBeVisible();
  await expect(page.locator('#view')).toBeHidden();
  await expect(page.locator('#view3d-controls')).toBeVisible();
  expect(errors).toEqual([]);
});

test('renders a changing scene', async ({ page }) => {
  await open(page);
  const canvas = page.locator('#view3d');
  await expect(canvas).toBeVisible();

  const first = await canvas.screenshot();
  await page.waitForTimeout(900);
  const second = await canvas.screenshot();

  expect(Buffer.compare(first, second)).not.toBe(0);
});

test('draws the driver network and the gene pool', async ({ page }) => {
  await open(page);
  await goFlat(page);

  const brain = page.locator('#brain');
  await expect(brain).toBeVisible();
  await expect(page.locator('#genepool')).toBeVisible();

  // The network belongs to whoever the camera is on, and says so.
  await expect(page.locator('[data-readout="brain-target"]')).toContainText('leader');

  // Picking a car out of the health strip moves the panel onto that car.
  await page.locator('#health').click({ position: { x: 100, y: 8 } });
  await expect(page.locator('[data-readout="brain-target"]')).toHaveText('car 0');

  // And it is live: activations move as the car does.
  const first = await brain.screenshot();
  await page.waitForTimeout(700);
  expect(Buffer.compare(first, await brain.screenshot())).not.toBe(0);
});

test('max speed reaches a new generation quickly', async ({ page }) => {
  const errors = watchForErrors(page);
  await open(page);
  // Measured in the flat mode: it is the cheap one, and it is what the budget
  // in the loop was tuned against.
  await goFlat(page);

  await page.getByRole('button', { name: 'max' }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().generation >= 1, null, {
    timeout: 45_000,
  });

  expect((await debug(page)).generation).toBeGreaterThanOrEqual(1);

  // The rate counter publishes one figure per second, and a window that
  // happens to contain a generation changeover pays for tearing down twenty
  // cars and rebuilding them, so a single sample understates the sustained
  // rate by a third. Take the best of several windows.
  let peak = 0;
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1000);
    peak = Math.max(peak, (await debug(page)).stepsPerSecond);
  }
  expect(peak).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test('pause halts the simulation and resume restarts it', async ({ page }) => {
  await open(page);
  const pause = page.getByRole('button', { name: 'Pause' });
  await pause.click();

  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  const stopped = await debug(page);
  expect(stopped.paused).toBe(true);

  await page.waitForTimeout(400);
  const stillStopped = await debug(page);
  expect(stillStopped.frame).toBe(stopped.frame);

  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForFunction(
    (frame) => (window as any).__gcars.debug().frame > frame,
    stopped.frame,
    { timeout: 10_000 },
  );
});

test('building a track from a seed updates the URL and restarts', async ({ page }) => {
  await open(page);
  // Seeds are restricted to letters and digits now, because they travel inside
  // track codes and URLs.
  await page.fill('#seed-input', 'moonbuggy');
  await page.getByRole('button', { name: 'Drive this track' }).click();

  await expect(page).toHaveURL(/seed=moonbuggy/);
  const state = await debug(page);
  expect(state.seed).toBe('moonbuggy');
  expect(state.generation).toBe(0);

  // The same seed must rebuild the same course after a reload.
  const before = state.trackSignature;
  await open(page, '/?seed=moonbuggy');
  const after = await debug(page);
  expect(after.seed).toBe('moonbuggy');
  expect(after.trackSignature).toBe(before);

  // A different seed must produce a different course.
  await page.fill('#seed-input', 'icerink');
  await page.getByRole('button', { name: 'Drive this track' }).click();
  expect((await debug(page)).trackSignature).not.toBe(before);
});

test('settings persist across a reload', async ({ page }) => {
  await open(page);
  await openSection(page, 'Evolution');
  await page.locator('#elites').fill('6');
  await page.locator('#mutation-rate').fill('30');
  await page.waitForTimeout(100);

  await open(page);
  await openSection(page, 'Evolution');
  await expect(page.locator('#elites')).toHaveValue('6');
  await expect(page.locator('#mutation-rate')).toHaveValue('30');
});

test('switches to the flat mode and back', async ({ page }) => {
  const errors = watchForErrors(page);
  await open(page);

  // Let 3D run long enough to bury a few cars.
  await page.getByRole('button', { name: 'max' }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().generation >= 1, null, {
    timeout: 90_000,
  });

  const deaths = Number((await page.locator('[data-readout="deaths"]').textContent()) ?? '0');
  expect(deaths).toBeGreaterThanOrEqual(20);

  await page.getByRole('button', { name: 'Survey the graveyard' }).click();
  await page.locator('#toggle-graveyard').uncheck();
  await page.locator('#toggle-trails').uncheck();
  await page.waitForTimeout(300);

  await goFlat(page);
  await expect(page.locator('#view')).toBeVisible();
  await expect(page.locator('#view3d')).toBeHidden();
  await expect(page.locator('#view3d-controls')).toBeHidden();

  // And back again, without reloading the engine.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '3d', null, {
    timeout: 20_000,
  });
  await expect(page.locator('#view3d')).toBeVisible();

  expect(errors).toEqual([]);
});

test('keeps each mode’s records to itself', async ({ page }) => {
  await open(page);
  await goFlat(page);

  // Build up a flat hall of fame first.
  await page.getByRole('button', { name: 'max' }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().hallOfFame >= 1, null, {
    timeout: 60_000,
  });
  const flat = await debug(page);
  expect(flat.hallOfFame).toBeGreaterThanOrEqual(1);

  // Switching to 3D must not inherit them: it is a different problem on a
  // different scale, so a 2D score standing as the 3D record is meaningless.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '3d', null, {
    timeout: 20_000,
  });
  expect((await debug(page)).hallOfFame).toBe(0);

  // And going back restores the flat records rather than losing them.
  await goFlat(page);
  expect((await debug(page)).hallOfFame).toBe(flat.hallOfFame);
});

test('is usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await open(page);

  // Nothing should overflow horizontally.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#view3d')).toBeVisible();
  await expect(page.locator('#brain')).toBeVisible();
});
