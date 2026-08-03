/**
 * Designing a track, sharing it, and the room staying off until asked.
 */

import { expect, test, type Page } from '@playwright/test';

interface Debug {
  mode: '2d' | '3d';
  ready: boolean;
  seed: string;
  generation: number;
  trackSignature: number;
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __gcars: { debug: () => Debug } }).__gcars.debug());

async function open(page: Page, url = '/'): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(
    () =>
      (window as unknown as { __gcars?: { debug: () => Debug } }).__gcars?.debug().ready === true,
    null,
    { timeout: 60_000 },
  );
}

/** The editor's sliders, in the order the spec declares them. */
const knob = (page: Page, index: number) =>
  page.locator('#track-editor input[type=range]').nth(index);
const GAPS = 3;
const HILLS = 1;

test.describe('the track editor', () => {
  test('shows a code that changes with the design', async ({ page }) => {
    await open(page);
    const before = await page.locator('#track-code').inputValue();
    expect(before).toMatch(/^t1/);

    await knob(page, GAPS).fill('0.15');
    const after = await page.locator('#track-code').inputValue();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^t1/);
    // Short enough to paste into a chat message without it wrapping.
    expect(after.length).toBeLessThanOrEqual(24);
  });

  test('describes what makes the track distinctive', async ({ page }) => {
    await open(page);
    await knob(page, GAPS).fill('0.15');
    await expect(page.locator('.track-summary')).toContainText('gappy');
  });

  test('leaves the running simulation alone until asked', async ({ page }) => {
    await open(page);
    const before = (await debug(page)).trackSignature;

    // Moving sliders only redraws the preview. Rebuilding on every input event
    // would throw away the run mid-drag.
    await knob(page, HILLS).fill('2.4');
    await knob(page, GAPS).fill('0.2');
    await page.waitForTimeout(300);
    expect((await debug(page)).trackSignature).toBe(before);

    await page.getByRole('button', { name: 'Drive this track' }).click();
    expect((await debug(page)).trackSignature).not.toBe(before);
  });

  test('a code builds the same track it came from', async ({ page }) => {
    await open(page);
    await knob(page, GAPS).fill('0.18');
    await knob(page, HILLS).fill('1.85');
    const code = await page.locator('#track-code').inputValue();
    await page.getByRole('button', { name: 'Drive this track' }).click();
    const mine = (await debug(page)).trackSignature;

    // A different track first, so loading the code has something to change.
    await open(page, '/?seed=elsewhere');
    expect((await debug(page)).trackSignature).not.toBe(mine);

    await page.fill('#track-code', code);
    await page.getByRole('button', { name: 'Load a code' }).click();
    expect((await debug(page)).trackSignature).toBe(mine);
  });

  test('a link carries the whole design, not just the seed', async ({ page }) => {
    await open(page);
    await knob(page, GAPS).fill('0.22');
    await page.getByRole('button', { name: 'Drive this track' }).click();
    const mine = (await debug(page)).trackSignature;

    const shared = page.url();
    expect(shared).toContain('track=t1');

    await open(page, shared);
    expect((await debug(page)).trackSignature).toBe(mine);
  });

  test('refuses a code that is not one, without wrecking the run', async ({ page }) => {
    await open(page);
    const before = (await debug(page)).trackSignature;

    await page.fill('#track-code', 'not-a-code');
    await page.getByRole('button', { name: 'Load a code' }).click();

    await expect(page.locator('#banner')).toContainText('does not look like a track code');
    expect((await debug(page)).trackSignature).toBe(before);
  });

  test('building a track restarts the generation count', async ({ page }) => {
    await open(page);
    await knob(page, HILLS).fill('0.5');
    await page.getByRole('button', { name: 'Drive this track' }).click();
    expect((await debug(page)).generation).toBe(0);
  });
});

test.describe('medals', () => {
  test('report progress along the course', async ({ page }) => {
    await open(page);
    await page.waitForTimeout(2500);
    // Distance is meaningless without a course to measure it against; the bar
    // is what makes the number mean something.
    await expect(page.locator('.medal-caption')).toContainText('%');
    await expect(page.locator('.medal-mark')).toHaveCount(4);
  });
});

test.describe('the room', () => {
  test('stays off until somebody joins', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));

    await open(page);
    await expect(page.locator('#room-status')).toHaveText('Not connected.');
    // The point of opt-in: nothing should have reached for a relay, and the
    // transport should not even have been downloaded.
    expect(requests.filter((url) => url.includes('trystero') || url.startsWith('wss:'))).toEqual(
      [],
    );
  });

  test('offers a name and a migration setting before connecting', async ({ page }) => {
    await open(page);
    await expect(page.locator('#room-name')).not.toHaveValue('');
    await expect(page.locator('#room-join')).toHaveText('Join the room');
    // Migration is a knob you can see before you commit to anything.
    await expect(page.locator('#migrants')).toBeVisible();
  });
});
