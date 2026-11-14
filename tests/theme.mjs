import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';

assert.ok(!process.env.TEST_BASE_URL, 'Theme checks run only against the local Worker');
const base = 'http://127.0.0.1:8787';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const errors = [];
mkdirSync('test-results', { recursive: true });
async function open(context, path = '/') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  assert.equal((await page.goto(base + path)).status(), 200);
  await page.locator('[data-theme-select]:visible').waitFor();
  return page;
}
async function theme(page, value) {
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, value);
  assert.ok((await page.locator('[data-theme-select]').evaluateAll(selects => selects.map(select => select.value))).every(selected => selected === value));
}
async function background(page) {
  assert.match(await page.locator('body').evaluate(el => getComputedStyle(el, '::before').backgroundImage), /\/images\/sakura-classroom\.png/);
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el, '::before').pointerEvents), 'none');
}
try {
  const page = await open(context);
  await theme(page, 'sakura');
  await background(page);
  const artwork = await context.request.get(base + '/images/sakura-classroom.png');
  assert.equal(artwork.status(), 200);
  assert.match(artwork.headers()['content-type'], /image\/png/);
  assert.deepEqual(await artwork.body(), readFileSync('public/images/sakura-classroom.png'), 'Serve the exact supplied illustration');
  await page.waitForFunction(() => document.querySelector('#sync-status').textContent.includes('已同步'));
  await page.screenshot({ path: 'test-results/local-theme-desktop.png' });
  for (const x of [120, 1245]) {
    await page.mouse.move(x, 270);
    await page.waitForFunction(school => document.body.dataset.activeSchool === school, x < 680 ? 'original' : 'new');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--blue').trim()), '#2f6771', 'The artwork palette must stay stable on both sides');
  }
  await page.locator('[data-theme-select]').selectOption('campus');
  await theme(page, 'campus');
  await page.reload();
  await theme(page, 'campus');
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--school-original').trim()), '#67d027');
  const codeget = await open(context, '/codeget');
  await theme(codeget, 'campus');
  await codeget.locator('[data-theme-select]').selectOption('sakura');
  await theme(codeget, 'sakura');
  await theme(page, 'sakura');
  await background(codeget);
  const admin = await open(context, '/admin');
  await theme(admin, 'sakura');
  await background(admin);
  await admin.locator('[data-theme-select]:visible').selectOption('campus');
  await theme(admin, 'campus');
  await theme(page, 'campus');
  await page.locator('[data-theme-select]').selectOption('sakura');
  await theme(admin, 'sakura');
  for (const target of [page, codeget, admin]) {
    for (const width of [320, 390, 768, 1365]) {
      await target.setViewportSize({ width, height: 844 });
      assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${target.url()}: overflow at ${width}px`);
    }
  }
  await codeget.screenshot({ path: 'test-results/local-theme-codeget.png' });
  await admin.screenshot({ path: 'test-results/local-theme-login.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/local-theme-mobile.png' });
  await page.locator('.scroll-invitation').click();
  await page.waitForFunction(() => !document.querySelector('#write-reveal').inert);
  await page.locator('#write-reveal').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/local-theme-writing.png' });
  await page.evaluate(() => document.querySelector('#write-dialog').showModal());
  await page.locator('#write-dialog input[name="real_name"]').fill('交互检查');
  await page.locator('#write-dialog .dialog-close').click();
  await page.waitForFunction(() => !document.querySelector('#write-dialog').open);
  await page.evaluate(() => localStorage.setItem('shien-theme', 'invalid'));
  await page.reload();
  await theme(page, 'sakura');

  const unavailable = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await unavailable.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }));
    const quiet = await open(unavailable);
    await theme(quiet, 'sakura');
    await quiet.locator('[data-theme-select]').selectOption('campus');
    await theme(quiet, 'campus');
    await quiet.locator('[data-theme-select]').selectOption('sakura');
    await theme(quiet, 'sakura');
    assert.equal(await quiet.locator('.heart-outline path').evaluate(el => getComputedStyle(el).animationName), 'none');
  } finally { await unavailable.close(); }
  assert.deepEqual(errors, []);
  console.log('主题验收通过：原图同源背景、默认水彩配色、旧主题可选、刷新与跨页/标签同步、存储禁用回退、320–1365px 无溢出、弹窗交互与减少动态效果。仅本地检查，不写业务数据。');
} finally { await context.close(); await browser.close(); }
