/**
 * The daily track, in a real browser.
 *
 * Two things worth checking that a unit test cannot: that opening the page with
 * no link lands on the daily rather than on a course nobody else is driving,
 * and that the daily's code is the room code, since that is the only reason
 * everyone ends up in the same room.
 */

import { expect, test, type Page } from '@playwright/test';

interface Debug {
  ready: boolean;
  mode: '2d' | '3d';
  generation: number;
}

async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(
    () =>
      (window as unknown as { __gcars?: { debug: () => Debug } }).__gcars?.debug().ready === true,
    null,
    { timeout: 60_000 },
  );
}

const today = () => new Date().toISOString().slice(0, 10);

test.describe('the daily track', () => {
  test('is what you get when you arrive with no link', async ({ page }) => {
    await open(page);
    await expect(page.locator('#daily-note')).toHaveText(`Driving the daily for ${today()}.`);
  });

  test('a shared link still wins over it', async ({ page }) => {
    // Somebody who followed a link asked for that course, not for today's.
    await open(page);
    const dailyCode = await page.locator('#track-code').inputValue();

    await open(page, '/?seed=classic');
    const code = await page.locator('#track-code').inputValue();
    expect(code).not.toBe(dailyCode);
    await expect(page.locator('#daily-note')).toContainText('A new one every day');
  });

  test('the button comes back to it', async ({ page }) => {
    await open(page);
    const dailyCode = await page.locator('#track-code').inputValue();

    await page.locator('#seed-input').fill('elsewhere');
    await expect(page.locator('#track-code')).not.toHaveValue(dailyCode);

    await page.locator('#daily-track').click();
    await expect(page.locator('#track-code')).toHaveValue(dailyCode);
    await expect(page.locator('#daily-note')).toHaveText(`Driving the daily for ${today()}.`);
  });

  test('everyone driving it would land in the same room', async ({ page }) => {
    // The room is keyed to the track code, so this is the matchmaking: two
    // browsers that agree on the daily agree on the room without being told.
    await open(page);
    const first = await page.locator('#track-code').inputValue();
    await open(page);
    const second = await page.locator('#track-code').inputValue();
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(8);
  });
});
