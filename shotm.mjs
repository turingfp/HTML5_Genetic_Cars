import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
await p.goto('http://127.0.0.1:4173/');
await p.waitForFunction(() => window.__gcars?.debug().ready === true, null, { timeout: 60000 });
await p.click('#speeds button:last-child');
await p.waitForTimeout(25000);
// The order of panels as a phone sees them.
console.log(await p.evaluate(() =>
  [...document.querySelectorAll('.app > *, .column-main > *, .column-side > *')]
    .filter((el) => !el.classList.contains('column-main') && !el.classList.contains('column-side'))
    .map((el) => ({ name: el.className.split(' ')[0] || el.tagName, top: Math.round(el.getBoundingClientRect().top + scrollY) }))
    .sort((a, b) => a.top - b.top).map((e) => `${e.name}@${e.top}`).join(' ')));
// First tap on a lit cell should preview, not race.
await p.locator('.archive-panel').scrollIntoViewIfNeeded();
const box = await p.locator('#archive').boundingBox();
const G = 16;
let armed = false;
for (let r = 0; r < 12 && !armed; r++) for (let c = 0; c < 12 && !armed; c++) {
  await p.touchscreen.tap(box.x + G + ((c + 0.5) / 12) * (box.width - G), box.y + ((r + 0.5) / 12) * (box.height - G));
  await p.waitForTimeout(40);
  armed = await p.locator('.archive-preview').isVisible();
}
console.log('tap preview:', armed, '| banner after first tap:', await p.locator('#banner').isHidden());
await p.locator('.archive-panel').screenshot({ path: '/tmp/mobile-map.png' });
await b.close();
