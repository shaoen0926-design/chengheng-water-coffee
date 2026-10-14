// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-15T12:00:00+08:00') });
  const url = process.env.TEST_URL || 'http://127.0.0.1:4326';
  const key = 'qinheng-water-coffee-v1';
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const text = id => page.locator(`#${id}`).innerText();
  const click = selector => page.locator(selector).click();
  const settings = () => click('.top-actions [data-open="settings-dialog"]');
  const close = id => click(`#${id} .dialog-heading [data-close]`);
  const backupFile = data => ({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  try {
    await page.goto(url);
    assert.equal(await page.title(), '澄衡-水咖紀錄');
    assert.equal(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute('content'), '澄衡-水咖紀錄');
    assert.equal((await page.locator('body').innerText()).includes('沁'), false);
    const manifestURL = new URL(await page.locator('link[rel="manifest"]').getAttribute('href'), page.url()).href;
    const manifestResponse = await page.request.get(manifestURL);
    assert.equal(manifestResponse.status(), 200);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, '澄衡-水咖紀錄');
    assert.equal(manifest.short_name, manifest.name);
    assert.equal(manifest.display, 'standalone');
    assert.equal(new URL(manifest.start_url, manifestURL).pathname, new URL('./', page.url()).pathname);
    assert.equal(manifest.icons.some(i => i.purpose === 'maskable'), true);
    const iconSources = [...manifest.icons.map(i => ({ src: new URL(i.src, manifestURL).href, size: Number(i.sizes.split('x')[0]) }))];
    for (const link of await page.locator('link[type="image/png"], link[rel="apple-touch-icon"]').all()) {
      iconSources.push({ src: new URL(await link.getAttribute('href'), page.url()).href, size: Number((await link.getAttribute('sizes')).split('x')[0]) });
    }
    for (const image of iconSources) {
      const response = await page.request.get(image.src);
      assert.equal(response.status(), 200, image.src);
      const png = await response.body();
      assert.equal(png.readUInt32BE(16), image.size, `icon width: ${image.src}`);
      assert.equal(png.readUInt32BE(20), image.size, `icon height: ${image.src}`);
      assert.equal(png[25], 2, `icon must have an opaque RGB background: ${image.src}`);
    }
    console.log('PASS: consistent display names, project-relative manifest, iPhone/iPad/Android icons and PNG dimensions.');
    assert.equal(await text('water-total'), '0');
    assert.equal(await text('badge-count'), '0 / 4');
    assert.equal(await page.locator('#date-label').getAttribute('datetime'), '2026-10-15');
    assert.match(await text('today-records'), /第一筆/);
    await click('.preset[data-add="water"][data-ml="250"]');
    assert.equal(await text('water-total'), '250');
    assert.equal(await text('badge-count'), '1 / 4');
    await click('#toast-undo');
    assert.equal(await text('water-total'), '0');
    assert.equal(await text('badge-count'), '0 / 4');
    for (let i = 0; i < 4; i++) await click('.preset[data-add="water"][data-ml="500"]');
    assert.equal(await text('water-percent'), '100%');
    assert.equal(await text('badge-count'), '2 / 4');
    for (let i = 0; i < 3; i++) await click('.preset[data-add="coffee"][data-ml="240"]');
    assert.equal(await text('coffee-total'), '3');
    assert.equal(await text('coffee-tag'), '超過自訂上限');
    assert.equal(await text('water-total'), '2,000');
    await page.reload();
    assert.equal(await text('water-total'), '2,000');
    assert.equal(await text('coffee-total'), '3');
    console.log('PASS: one-tap logging, undo, awards, coffee limit, separate totals, persistence, Taipei date.');

    await click('#open-custom');
    await page.locator('#drink-label').fill('自己的杯子');
    await page.locator('#drink-volume').fill('750');
    await page.locator('#drink-date').fill('2026-10-14');
    await page.locator('#drink-time').fill('09:20');
    await click('#record-form [type="submit"]');
    assert.equal((await read()).entries.at(-1).date, '2026-10-14');
    assert.equal(await text('water-total'), '2,000');
    await settings();
    await page.locator('#goal-water').fill('1000');
    await page.locator('#goal-coffee').fill('0');
    await click('#settings-form [type="submit"]');
    assert.equal((await read()).dayGoals['2026-10-14'].water, 2000);
    assert.equal((await read()).dayGoals['2026-10-15'].water, 1000);
    assert.equal(await text('water-percent'), '200%');
    await click('#open-custom');
    await page.locator('#drink-date').fill('2026-10-15');
    await page.locator('#drink-time').fill('23:59');
    await click('#record-form [type="submit"]');
    assert.match(await text('record-error'), /現在或之前/);
    assert.equal((await read()).entries.length, 8);
    await close('record-dialog');
    await click('.records-card [data-open="history-dialog"]');
    await click('#all-records .record-row:first-child [data-delete]');
    assert.equal((await read()).entries.length, 7);
    await close('history-dialog');
    await click('#toast-undo');
    assert.equal((await read()).entries.length, 8);
    console.log('PASS: backdated records, historical goal preservation, future-time rejection, history delete/restore.');

    const goals = { water: 2000, coffee: 2 };
    const fixture = { version: 1, goals, dayGoals: {}, entries: [] };
    for (const date of ['2026-10-13', '2026-10-14', '2026-10-15']) {
      fixture.dayGoals[date] = { ...goals };
      fixture.entries.push({ id: `water-${date}`, kind: 'water', ml: 2000, label: '測試喝水', date, time: '09:00' });
    }
    await settings();
    const beforeRestore = await read();
    await page.locator('#import-file').setInputFiles(backupFile(fixture));
    await page.locator('#restore-dialog').waitFor({ state: 'visible' });
    assert.deepEqual(await read(), beforeRestore);
    await close('restore-dialog');
    assert.deepEqual(await read(), beforeRestore);
    await settings();
    await page.locator('#import-file').setInputFiles(backupFile(fixture));
    await click('#confirm-restore');
    assert.equal(await text('badge-count'), '4 / 4');
    assert.match(await text('streak-message'), /連續 3 天/);
    await settings();
    const [download] = await Promise.all([page.waitForEvent('download'), click('#export-data')]);
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported, fixture);
    const corrupt = structuredClone(fixture);
    corrupt.entries.push(corrupt.entries[0]);
    await page.locator('#import-file').setInputFiles(backupFile(corrupt));
    await page.locator('#import-error').waitFor({ state: 'visible' });
    assert.deepEqual(await read(), fixture);
    await close('settings-dialog');
    await page.clock.setSystemTime(new Date('2026-10-16T00:01:00+08:00'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await text('water-total'), '0');
    assert.equal(await text('coffee-total'), '0');
    assert.match(await text('streak-message'), /連續 3 天/);
    console.log('PASS: validated backup round trip, cancel, corrupt-data rejection, streaks, completed-day award, midnight rollover.');

    // Use an isolated test session to capture populated UI; no user storage is touched.
    for (let i = 0; i < 2; i++) await click('.preset[data-add="water"][data-ml="500"]');
    await click('.preset[data-add="water"][data-ml="250"]');
    await click('.preset[data-add="coffee"][data-ml="240"]');
    await page.clock.fastForward(9000);
    const out = path.join(__dirname, '..', 'verification');
    await fs.mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `horizontal overflow at ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await click('.mobile-quick [data-add="water"]');
    assert.equal(await text('water-total'), '1,500');
    await click('#mobile-coffee');
    assert.equal(await page.locator('[data-kind="coffee"]').getAttribute('aria-pressed'), 'true');
    await close('record-dialog');
    await page.clock.fastForward(9000);
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: mobile shortcuts, 320–1440px layouts, no uncaught browser errors.');
    console.log('All browser checks passed. Screenshots saved in verification/.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
