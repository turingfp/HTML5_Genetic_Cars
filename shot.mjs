import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4330/');
await page.waitForFunction(() => window.__gcars?.debug().ready === true, null, { timeout: 60000 });

// Leap Of Faith: gaps are the most legible new thing in a still image.
await page.selectOption('#campaign', { label: 'Leap Of Faith' });
// Run it forward so there is a real population, a chart and a medal bar.
await page.locator('#speeds button', { hasText: 'max' }).click();
await page.waitForFunction(() => window.__gcars.debug().generation >= 4, null, { timeout: 120000 });
await page.locator('#speeds button', { hasText: '1×' }).click();
await page.waitForTimeout(4000);

console.log('debug:', JSON.stringify(await page.evaluate(() => window.__gcars.debug())));
console.log('medal:', await page.locator('.medal-caption').textContent());
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: 'docs/screenshot-3d.png', clip: { x: 0, y: 0, width: 1480, height: 900 } });
await browser.close();
