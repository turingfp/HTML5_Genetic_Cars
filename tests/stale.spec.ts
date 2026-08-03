/**
 * A hall of fame written by an older build must not take the page down.
 *
 * Reported from a phone as "BoxCar3D could not start. TypeError: undefined is
 * not an object (evaluating 'e.wheels.map')": records saved before the genome
 * grew its current shape reached the thumbnail renderer, which throws inside
 * the application's constructor, before a single frame is drawn.
 */

import { expect, test, type Page } from '@playwright/test';

interface Debug {
  ready: boolean;
  hallOfFame: number;
}

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __gcars?: { debug: () => Debug } }).__gcars?.debug().ready === true,
    null,
    { timeout: 60_000 },
  );
}

/** Plant records of a given shape before any of the app's code runs. */
async function plant(page: Page, entries: unknown[]): Promise<void> {
  await page.addInitScript((saved) => {
    for (const mode of ['2d', '3d']) {
      localStorage.setItem(`boxcar3d:hall-of-fame:${mode}:v1`, JSON.stringify(saved));
    }
  }, entries);
}

const entry = (def: unknown) => ({
  def,
  score: 120,
  distance: 118,
  generation: 4,
  trackSeed: 'old',
  recordedAt: 1,
});

test('a car saved before wheels existed does not stop the page', async ({ page }) => {
  // Exactly the shape the original genome had: a body and nothing else.
  await plant(page, [entry({ vertices: [{ x: 1, y: 0 }], chassisDensity: 80 })]);

  await page.goto('/');
  await ready(page);

  await expect(page.locator('#fatal')).toHaveCount(0);
  // The unusable record is dropped rather than kept and drawn.
  expect((await page.evaluate(() => (window as any).__gcars.debug() as Debug)).hallOfFame).toBe(0);
});

test('survives every shape of nonsense in the saved records', async ({ page }) => {
  await plant(page, [
    entry(null),
    entry({}),
    entry({ wheels: [1, 2], spokes: [] }),
    entry({ wheels: null, spokes: null, brain: null }),
    'not an entry',
    null,
    42,
  ]);

  await page.goto('/');
  await ready(page);
  await expect(page.locator('#fatal')).toHaveCount(0);
});

test('a record this version wrote still comes back', async ({ page }) => {
  // Earn a real record, reload, and check it survived. The fix must not throw
  // away the good ones along with the bad.
  await page.goto('/');
  await ready(page);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().hallOfFame > 0, null, {
    timeout: 120_000,
  });

  await page.goto('/');
  await ready(page);
  await expect(page.locator('#fatal')).toHaveCount(0);

  // Records are kept per mode and the page opens in 3D, so the 2D board has
  // to be on screen before it can be counted.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.waitForFunction(() => (window as any).__gcars.debug().mode === '2d');
  expect((await page.evaluate(() => (window as any).__gcars.debug() as Debug)).hallOfFame)
    .toBeGreaterThan(0);
});
