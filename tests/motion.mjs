import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const remote = Boolean(process.env.TEST_BASE_URL), base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const account = JSON.parse(readFileSync(`.local/${remote ? 'production' : 'local'}-admin.json`, 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}), ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function testDialogs(ids) {
  for (const id of ids) {
    const open = await page.evaluate(id => {
      const dialog = document.getElementById(id);
      dialog.showModal();
      getComputedStyle(dialog).opacity;
      return dialog.getAnimations().map(a => ({ duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing }));
    }, id);
    assert.ok(open.length > 0, `${id} did not animate opening`);
    assert.ok(open.every(a => a.duration > 0 && a.easing === 'linear'), `${id} did not use linear opening`);
    await page.evaluate(async id => { await Promise.all(document.getElementById(id).getAnimations().map(a => a.finished.catch(() => {}))); }, id);
    const clickable = await page.evaluate(id => {
      const button = document.getElementById(id).querySelector('[data-close]');
      if (!button) return true;
      const rect = button.getBoundingClientRect();
      return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('button') === button;
    }, id);
    assert.ok(clickable, `${id}: close button is covered by another element`);
    const close = await page.evaluate(id => {
      const dialog = document.getElementById(id); dialog.close();
      return { display: getComputedStyle(dialog).display, effects: dialog.getAnimations().map(a => a.effect.getTiming().easing) };
    }, id);
    assert.equal(close.display, 'block', `${id} disappeared before its exit transition`);
    assert.ok(close.effects.length > 0 && close.effects.every(easing => easing === 'linear'), `${id}: ${JSON.stringify(close.effects)}`);
    await page.waitForFunction(id => getComputedStyle(document.getElementById(id)).display === 'none', id);
    await page.evaluate(id => document.getElementById(id).showModal(), id);
    await page.keyboard.press('Escape');
    await page.waitForFunction(id => !document.getElementById(id).open && getComputedStyle(document.getElementById(id)).display === 'none', id);
  }
}
try {
  await page.goto(base); await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  await testDialogs(['write-dialog', 'read-dialog']);
  await page.goto(`${base}/admin`); await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  await testDialogs(['edit-dialog', 'import-dialog', 'confirm-dialog']);

  await page.route('**/api/admin/login', async route => { await delay(450); await route.continue(); });
  await page.locator('#login-form [name=username]').fill(account.username);
  await page.locator('#login-form [name=password]').fill(account.password);
  await page.locator('#login-form button').click();
  assert.equal(await page.locator('#login-form button').getAttribute('aria-busy'), 'true');
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('is-loading')));
  assert.equal(await page.locator('#login-form button').evaluate(button => getComputedStyle(button, '::after').animationTimingFunction), 'linear');
  await page.locator('#admin-shell').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  assert.equal(await page.locator('#login-form button').getAttribute('aria-busy'), null);
  await page.route('**/api/admin/dashboard', async route => { await delay(450); await route.continue(); });
  await page.locator('#refresh-dashboard').click();
  assert.equal(await page.locator('#view-dashboard').getAttribute('aria-busy'), 'true');
  await page.waitForFunction(() => !document.getElementById('view-dashboard').hasAttribute('aria-busy'));
  await page.locator('#logout-button').click(); await page.locator('#login-shell').waitFor({ state: 'visible' });

  // No database response is fabricated: deliberately fail a real request to check cleanup.
  await page.route('**/api/site', async route => { await delay(350); await route.abort('failed'); });
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('sync-status').textContent.includes('30 秒后重试'));
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
  await page.unroute('**/api/site');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.getElementById('read-dialog').showModal());
  assert.equal(await page.locator('#read-dialog').evaluate(dialog => dialog.getAnimations().length), 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#read-dialog').evaluate(dialog => getComputedStyle(dialog).display), 'none');
  assert.deepEqual(errors, []);
  console.log('动画验收通过：5 类弹窗线性进入/退出、Esc、真实登录与刷新加载、失败请求清理、减少动态效果。');
} finally { await context.close(); await browser.close(); }
