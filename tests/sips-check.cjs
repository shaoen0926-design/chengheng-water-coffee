const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-10-15T12:00:00+08:00') });
  const key = 'qinheng-water-coffee-v1';
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
  const text = id => page.locator(`#${id}`).innerText();
  const click = selector => page.locator(selector).click();
  const close = id => click(`#${id} .dialog-heading [data-close]`);
  const submit = () => click('#record-form [type="submit"]');
  const settings = () => click('.top-actions [data-open="settings-dialog"]');
  try {
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:4326');
    for (const ml of [10, 30, 50]) await click(`.sip-btn[data-add="water"][data-ml="${ml}"]`);
    assert.equal(await text('water-total'), '90');
    for (let i = 0; i < 8; i++) {
      await click('#open-coffee-sip');
      assert.equal(await page.locator('#drink-volume').inputValue(), '30');
      assert.equal(await page.locator('#coffee-cup-volume').inputValue(), '240');
      assert.match(await text('record-kind-note'), /0\.125 杯/);
      await submit();
      assert.equal(await text('coffee-total'), String((i + 1) / 8));
    }
    assert.equal(await text('coffee-total'), '1');
    assert.match(await text('coffee-volume'), /240 ml/);
    assert.equal(await text('water-total'), '90');
    await page.reload();
    assert.equal(await text('coffee-total'), '1');
    assert.equal((await read()).entries.filter(e => e.kind === 'coffee').every(e => e.cupMl === 240), true);
    console.log('PASS: small water increments; eight 30 ml portions of a 240 ml coffee count as one cup, persisted after reload.');

    // Repeating thirds must not produce a false over-limit result.
    await settings();
    await page.locator('#goal-coffee').fill('2');
    await click('#settings-form [type="submit"]');
    for (let i = 0; i < 3; i++) {
      await click('#open-coffee-sip');
      if (!i) await click('[data-cup="60"]');
      assert.equal(await page.locator('#coffee-cup-volume').inputValue(), '60');
      await page.locator('#drink-volume').fill('20');
      await submit();
    }
    assert.equal(await text('coffee-total'), '2');
    assert.equal(await text('coffee-tag'), '今天先到這裡');
    await click('#open-coffee-sip');
    await page.locator('#drink-volume').fill('10');
    await submit();
    assert.equal(await text('coffee-total'), '2.1667');
    assert.equal(await text('coffee-tag'), '超過自訂上限');
    await click('#toast-undo');
    assert.equal(await text('coffee-total'), '2');
    assert.equal(await text('coffee-tag'), '今天先到這裡');
    console.log('PASS: mixed cup sizes, remembered cup reference, fractional limits, floating-point boundary and undo.');

    await click('#mobile-sip');
    assert.equal(await page.locator('#drink-volume').inputValue(), '30');
    await click('[data-kind="coffee"]');
    assert.equal(await page.locator('#coffee-cup-volume').inputValue(), '60');
    await page.locator('#drink-volume').fill('70');
    const beforeInvalid = await read();
    await submit();
    assert.match(await text('record-error'), /不能大於整杯/);
    assert.deepEqual(await read(), beforeInvalid);
    await click('[data-volume="10"]');
    assert.equal(await page.locator('#record-error').isVisible(), false);
    await fs.mkdir(path.join(__dirname, '..', 'verification'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'verification', 'small-sip-mobile.png') });
    await close('record-dialog');
    const previousWater = Number((await text('water-total')).replaceAll(',', ''));
    await click('#mobile-sip');
    await click('[data-volume="10"]');
    await submit();
    assert.equal(await text('water-total'), String(previousWater + 10));
    console.log('PASS: mobile small-portion dialog, amount selection, volume validation, and water/coffee separation.');

    // Load a genuine v1-format dataset. Each old coffee remains exactly one cup.
    const old = { version: 1, goals: { water: 500, coffee: 2 }, dayGoals: { '2026-10-14': { water: 500, coffee: 2 } }, entries: [
      { id: 'old-water', kind: 'water', ml: 500, label: '喝水', date: '2026-10-14', time: '09:00' },
      { id: 'old-coffee-60', kind: 'coffee', ml: 60, label: '濃縮', date: '2026-10-14', time: '09:10' },
      { id: 'old-coffee-360', kind: 'coffee', ml: 360, label: '拿鐵', date: '2026-10-14', time: '09:20' }
    ] };
    await page.evaluate(({ key, old }) => localStorage.setItem(key, JSON.stringify(old)), { key, old });
    await page.reload();
    assert.equal(await page.locator('#storage-warning').isVisible(), false);
    assert.match(await page.locator('[data-day="2026-10-14"]').getAttribute('aria-label'), /2 杯咖啡/);
    assert.equal(await text('badge-count'), '3 / 4');
    await click('#open-coffee-sip');
    assert.equal(await page.locator('#coffee-cup-volume').inputValue(), '360');
    await page.locator('#drink-volume').fill('180');
    await page.locator('#drink-date').fill('2026-10-14');
    await submit();
    const migrated = await read();
    assert.equal(migrated.version, 2);
    assert.equal(migrated.entries.find(e => e.id === 'old-coffee-60').cupMl, 60);
    assert.equal(migrated.entries.find(e => e.id === 'old-coffee-360').cupMl, 360);
    assert.equal(await text('badge-count'), '2 / 4'); // Historical balance award is revoked at 2.5 cups.
    await settings();
    const [download] = await Promise.all([page.waitForEvent('download'), click('#export-data')]);
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported, migrated);
    await page.locator('#import-file').setInputFiles({ name: 'new-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await click('#confirm-restore');
    assert.deepEqual(await read(), migrated);
    await settings();
    const malformed = structuredClone(exported);
    malformed.entries.find(e => e.kind === 'coffee').cupMl = 0;
    await page.locator('#import-file').setInputFiles({ name: 'bad-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(malformed)) });
    await page.locator('#import-error').waitFor({ state: 'visible' });
    assert.deepEqual(await read(), migrated);
    await close('settings-dialog');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: legacy record migration, past-day fractional achievement, backup round trip, corrupt cup reference rejection, responsive layouts.');
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
