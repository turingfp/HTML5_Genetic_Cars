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
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __gcars: { debug: () => Debug } }).__gcars.debug());

/** Fail the test on any console error or uncaught exception. */
function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test('loads, simulates, and drives cars forward', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  await expect(page.locator('h1')).toHaveText('Genetic Cars');
  await page.waitForFunction(() => 'exists' in window || (window as any).__gcars);

  const initial = await debug(page);
  expect(initial.alive).toBe(20);
  expect(initial.seed).toMatch(/^[a-z0-9]+$/);

  // The simulation should advance on its own.
  await page.waitForFunction(() => (window as any).__gcars.debug().frame > 60, null, {
    timeout: 10_000,
  });
  const running = await debug(page);
  expect(running.bestX).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('renders a changing scene', async ({ page }) => {
  await page.goto('/');
  const canvas = page.locator('#view');
  await expect(canvas).toBeVisible();

  const first = await canvas.screenshot();
  await page.waitForTimeout(700);
  const second = await canvas.screenshot();

  expect(Buffer.compare(first, second)).not.toBe(0);
});

test('max speed reaches a new generation quickly', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'max' }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().generation >= 1, null, {
    timeout: 45_000,
  });

  expect((await debug(page)).generation).toBeGreaterThanOrEqual(1);

  // The rate counter only publishes once a second, so wait for a sample.
  await page.waitForFunction(() => (window as any).__gcars.debug().stepsPerSecond > 0, null, {
    timeout: 5000,
  });
  expect((await debug(page)).stepsPerSecond).toBeGreaterThan(200);
  expect(errors).toEqual([]);
});

test('pause halts the simulation and resume restarts it', async ({ page }) => {
  await page.goto('/');
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
    { timeout: 5000 },
  );
});

test('building a track from a seed updates the URL and restarts', async ({ page }) => {
  await page.goto('/');
  await page.fill('#seed-input', 'moon-buggy');
  await page.getByRole('button', { name: 'Build this track' }).click();

  await expect(page).toHaveURL(/seed=moon-buggy/);
  const state = await debug(page);
  expect(state.seed).toBe('moon-buggy');
  expect(state.generation).toBe(0);

  // The same seed must rebuild the same course after a reload.
  const before = state.trackSignature;
  await page.reload();
  await page.waitForFunction(() => (window as any).__gcars);
  const after = await debug(page);
  expect(after.seed).toBe('moon-buggy');
  expect(after.trackSignature).toBe(before);

  // A different seed must produce a different course.
  await page.fill('#seed-input', 'ice-rink');
  await page.getByRole('button', { name: 'Build this track' }).click();
  expect((await debug(page)).trackSignature).not.toBe(before);
});

test('settings persist across a reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('#elites').fill('6');
  await page.locator('#mutation-rate').fill('30');
  await page.waitForTimeout(100);

  await page.reload();
  await page.waitForFunction(() => (window as any).__gcars);

  await expect(page.locator('#elites')).toHaveValue('6');
  await expect(page.locator('#mutation-rate')).toHaveValue('30');
});

test('switches to the 3D mode and keeps evolving', async ({ page }) => {
  const errors = watchForErrors(page);
  await page.goto('/');

  expect((await debug(page)).mode).toBe('2d');
  await page.getByRole('button', { name: '3D', exact: true }).click();

  // Box3D compiles WebAssembly and three.js is fetched on demand.
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '3d', null, {
    timeout: 45_000,
  });

  const started = await debug(page);
  expect(started.alive).toBe(20);

  await page.getByRole('button', { name: 'max' }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().generation >= 1, null, {
    timeout: 60_000,
  });

  const evolved = await debug(page);
  expect(evolved.bestX).toBeGreaterThanOrEqual(0);
  expect(evolved.generation).toBeGreaterThanOrEqual(1);

  // The 3D canvas should be the visible one now.
  await expect(page.locator('#view3d')).toBeVisible();
  await expect(page.locator('#view')).toBeHidden();

  // The graveyard should have accumulated a marker per car that has died.
  const deaths = Number((await page.locator('[data-readout="deaths"]').textContent()) ?? '0');
  expect(deaths).toBeGreaterThanOrEqual(20);

  // View controls belong to 3D only.
  await expect(page.locator('#view3d-controls')).toBeVisible();
  await page.getByRole('button', { name: 'Survey the graveyard' }).click();
  await page.locator('#toggle-graveyard').uncheck();
  await page.locator('#toggle-trails').uncheck();
  await page.waitForTimeout(300);

  // And switching back restores the flat simulation.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '2d');
  await expect(page.locator('#view')).toBeVisible();
  await expect(page.locator('#view3d-controls')).toBeHidden();

  expect(errors).toEqual([]);
});

test('keeps each mode’s records to itself', async ({ page }) => {
  await page.goto('/');
  // Build up a 2D hall of fame first.
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
    timeout: 45_000,
  });
  expect((await debug(page)).hallOfFame).toBe(0);

  // And going back restores the 2D records rather than losing them.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '2d');
  expect((await debug(page)).hallOfFame).toBe(flat.hallOfFame);
});

test('is usable on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto('/');

  // Nothing should overflow horizontally.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#view')).toBeVisible();
});
