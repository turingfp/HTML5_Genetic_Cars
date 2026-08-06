/**
 * What happens when 3D cannot run.
 *
 * These exist because of a bug report that said only "doesn't run on iPhone".
 * There was nothing to go on, because every one of these failures used to end
 * in a dark canvas behind a "warming up" banner with nothing in the page to
 * say why. The point of each test is not that 3D works, it is that when 3D
 * does not work the page still does, and says so.
 */

import { devices, expect, test, type Page } from '@playwright/test';

interface Debug {
  mode: '2d' | '3d';
  ready: boolean;
  frame: number;
  bestX: number;
}

const debug = (page: Page): Promise<Debug> =>
  page.evaluate(() => (window as unknown as { __gcars: { debug: () => Debug } }).__gcars.debug());

/** Wait until the app has a running world, in whichever mode it settled on. */
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as unknown as { __gcars?: { debug: () => Debug } }).__gcars?.debug().ready === true,
    null,
    { timeout: 60_000 },
  );
}

test.describe('falling back to the flat mode', () => {
  test('a browser with no WebGL gets 2D instead of a dark canvas', async ({ page }) => {
    // Refuse every WebGL context, which is what an iOS tab that has run out of
    // them looks like from script.
    await page.addInitScript(() => {
      const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        type: string,
        ...rest: unknown[]
      ) {
        if (type.includes('webgl') || type.includes('experimental')) return null;
        return (real as (...a: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof real;
    });

    await page.goto('/');
    await ready(page);

    const state = await debug(page);
    expect(state.mode).toBe('2d');

    // Not merely present: actually simulating.
    await page.waitForFunction(() => {
      const d = (window as unknown as { __gcars: { debug: () => Debug } }).__gcars.debug();
      return d.frame > 60 && d.bestX > 1;
    });
  });

  test('a 3D chunk that never arrives still leaves a working page', async ({ page }) => {
    await page.route('**/renderer3d-*.js', (route) => route.abort());

    await page.goto('/');
    await ready(page);

    expect((await debug(page)).mode).toBe('2d');
    // A preload that fails is recoverable, so it must not raise the fatal
    // panel; the whole point is that this path ends in a usable page.
    await expect(page.locator('#fatal')).toHaveCount(0);
  });
});

test('an uncaught error is reported in the page, not just the console', async ({ page }) => {
  await page.goto('/');
  await ready(page);

  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('synthetic boom') }));
  });

  const fatal = page.locator('#fatal');
  await expect(fatal).toBeVisible();
  await expect(fatal).toContainText('synthetic boom');
});

test.describe('on a phone', () => {
  // Viewport, pixel ratio, touch and user agent only. The descriptor also asks
  // for WebKit, which would fork a second worker, and this project runs one
  // browser. So this exercises the mobile code path, not Safari itself.
  const { defaultBrowserType: _webkit, ...iphone } = devices['iPhone 14 Pro'];
  test.use(iphone);

  test('boots into 3D with no horizontal scroll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.goto('/');
    await ready(page);

    expect((await debug(page)).mode).toBe('3d');
    await expect(page.locator('#fatal')).toHaveCount(0);
    expect(errors).toEqual([]);

    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // The mobile quality tier caps the backing store at 1.5x rather than the
    // device's own 3x, so a phone is not asked to shade nine times the pixels.
    const scale = await page.evaluate(() => {
      const c = document.getElementById('view3d') as HTMLCanvasElement;
      return c.width / Math.max(1, Math.round(c.getBoundingClientRect().width));
    });
    expect(scale).toBeLessThanOrEqual(1.5);
  });
});
