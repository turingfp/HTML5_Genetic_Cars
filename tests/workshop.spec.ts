/**
 * The workshop, and the features being findable at all.
 */

import { expect, test, type Page } from '@playwright/test';

interface Debug {
  ready: boolean;
  mode: '2d' | '3d';
  generation: number;
}

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      (window as unknown as { __gcars?: { debug: () => Debug } }).__gcars?.debug().ready === true,
    null,
    { timeout: 60_000 },
  );
}

/** The workshop canvas box and its metres-to-pixels scale. */
async function stage(page: Page) {
  await page.locator('#workshop-canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('#workshop-canvas').boundingBox())!;
  // Matches the fixed extent the panel draws at: body reach plus a wheel.
  const scale = (Math.min(box.width, box.height) * 0.46) / 1.9;
  return { box, scale, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

const pixels = (page: Page) =>
  page.evaluate(() => (document.querySelector('#workshop-canvas') as HTMLCanvasElement).toDataURL().length);

test.describe('the workshop', () => {
  test('dragging a corner reshapes the body and leaves the wheels alone', async ({ page }) => {
    await open(page);
    const { cx, cy, scale } = await stage(page);
    const before = await pixels(page);
    const wheelsBefore = await page.locator('#workshop-wheels').inputValue();

    await page.mouse.move(cx + 0.3 * scale, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 1.15 * scale, cy - 0.25 * scale, { steps: 10 });
    await page.mouse.up();

    expect(await pixels(page)).not.toBe(before);
    // Measuring the tap against the corner rather than the pointer made every
    // drag silently add a wheel.
    expect(await page.locator('#workshop-wheels').inputValue()).toBe(wheelsBefore);
  });

  test('tapping a corner toggles a wheel there', async ({ page }) => {
    await open(page);
    const { cx, cy, scale } = await stage(page);
    // Put a corner somewhere known, then tap it twice.
    await page.mouse.move(cx + 0.3 * scale, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 1.1 * scale, cy, { steps: 8 });
    await page.mouse.up();

    const start = Number(await page.locator('#workshop-wheels').inputValue());
    await page.mouse.click(cx + 1.1 * scale, cy);
    const after = Number(await page.locator('#workshop-wheels').inputValue());
    expect(Math.abs(after - start)).toBe(1);

    await page.mouse.click(cx + 1.1 * scale, cy);
    expect(Number(await page.locator('#workshop-wheels').inputValue())).toBe(start);
  });

  test('never lets a car have too few or too many wheels', async ({ page }) => {
    await open(page);
    const count = page.locator('#workshop-wheels');
    await count.fill('2');
    expect(Number(await count.inputValue())).toBe(2);
    await count.fill('4');
    expect(Number(await count.inputValue())).toBe(4);
    // The slider itself is the guard, so its bounds are the contract.
    expect(await count.getAttribute('min')).toBe('2');
    expect(await count.getAttribute('max')).toBe('4');
  });

  test('a hand-built car reaches the next generation', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await page.waitForFunction(() => (window as any).__gcars.debug().mode === '2d');

    await page.locator('#workshop-race').click();
    await expect(page.locator('#workshop-note')).toContainText('queue');
    await expect(page.locator('#banner')).toContainText('Your car is in');

    // It has to actually arrive, not merely be promised.
    const gen = (await page.evaluate(() => (window as any).__gcars.debug() as Debug)).generation;
    await page.locator('#speeds button', { hasText: 'max' }).click();
    await page.waitForFunction(
      (was) => (window as any).__gcars.debug().generation > was,
      gen,
      { timeout: 120_000 },
    );
    await expect(page.locator('#fatal')).toHaveCount(0);
  });

  test('copying the leader needs something to copy', async ({ page }) => {
    await open(page);
    await page.locator('#workshop-copy').click();
    // Either it copied, or it said why not. Silence would be the bug.
    await expect(page.locator('#workshop-note')).not.toHaveText('');
  });
});

test.describe('finding the features', () => {
  test('the track editor, workshop and room are open on arrival', async ({ page }) => {
    await open(page);
    for (const id of ['track-editor', 'workshop', 'room-panel']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
  });

  test('the map of designs is on the page and counts its niches', async ({ page }) => {
    await open(page);
    await expect(page.locator('#archive')).toBeVisible();
    // The readouts may still say zero this early; the shape is the claim.
    await expect(page.locator('[data-readout=archive]')).toHaveText(/^\d+$/);
    await expect(page.locator('[data-readout=qd]')).toHaveText(/^\d+$/);
    // And the search toggle exists with both searches on offer.
    const options = page.locator('#search option');
    await expect(options).toHaveCount(2);
  });

  test('the controls sit near the top on a phone, not below everything', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await open(page);
    const { controls, page: pageHeight } = await page.evaluate(() => ({
      controls: document.querySelector('.controls-panel')!.getBoundingClientRect().top + scrollY,
      page: document.body.scrollHeight,
    }));
    // They used to be the very last panel. Now they follow the stage, which on
    // a phone means within the first screen or two rather than the tenth.
    expect(controls).toBeLessThan(pageHeight * 0.4);
  });
});
