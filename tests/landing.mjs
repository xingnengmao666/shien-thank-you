import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const remote = Boolean(process.env.TEST_BASE_URL), base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}), ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(error.message));
mkdirSync('test-results', { recursive: true });
const prefix = `test-results/${remote ? 'remote' : 'local'}-landing`;
async function ready(target) {
  await target.goto(base);
  await target.waitForFunction(() => document.querySelector('#sync-status').textContent.includes('已同步') && !document.documentElement.classList.contains('is-loading'));
  await target.evaluate(async () => { await Promise.all([...document.querySelectorAll('.heart-note')].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))); });
}
async function state(target) {
  return target.locator('#write-reveal').evaluate(el => ({ opacity: Number(getComputedStyle(el).opacity), inert: el.inert, visibility: getComputedStyle(el).visibility }));
}
async function scrollProgress(target, amount) {
  await target.evaluate(amount => {
    const section = document.querySelector('#write-section');
    scrollTo({ top: section.getBoundingClientRect().top + scrollY - innerHeight + Math.min(280, innerHeight * .4) * amount, behavior: 'instant' });
  }, amount);
  await target.waitForFunction(amount => Math.abs(Number(getComputedStyle(document.querySelector('#write-reveal')).opacity) - amount) < .02, amount);
}
async function hit(target, selector) {
  assert.ok(await target.locator(selector).evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), `${selector}: an overlay intercepts interaction`);
}
async function noOverflow(target) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
}
try {
  await ready(page);
  assert.deepEqual(await state(page), { opacity: 0, inert: true, visibility: 'hidden' });
  const hero = await page.locator('#heart-stage').boundingBox();
  assert.ok(hero.y > 72 && hero.y < 900, 'Heart must start in the first viewport');
  if (await page.locator('.heart-note').count() === 0) assert.ok(hero.y + hero.height < 900, 'An empty heart must fit in the first viewport');
  assert.equal(await page.locator('main > section').first().getAttribute('id'), 'heart-wall');
  assert.match(await page.locator('.original-label').textContent(), /原校/);
  assert.match(await page.locator('.new-label').textContent(), /新校/);
  await noOverflow(page);
  await page.screenshot({ path: `${prefix}-balanced.png` });
  for (const [school, x, color] of [['original', 120, '#67d027'], ['new', 1245, '#94070a']]) {
    await page.mouse.move(x, 270);
    await page.waitForFunction(school => document.body.dataset.activeSchool === school, school);
    assert.equal(await page.locator('body').evaluate((el, school) => getComputedStyle(el).getPropertyValue(`--school-${school}`).trim(), school), color);
    assert.equal(await page.locator('.school-atmosphere').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await hit(page, 'nav a[href="#write-section"]');
    await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.school-atmosphere span,.heart-outline stop')].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))); });
    await page.screenshot({ path: `${prefix}-${school}.png` });
  }
  await scrollProgress(page, .3);
  assert.ok((await state(page)).inert, 'A nearly transparent entrance must not be interactive');
  const first = (await state(page)).opacity;
  await scrollProgress(page, .6);
  assert.ok((await state(page)).opacity > first, 'Entrance must reveal with scroll progress');
  await page.screenshot({ path: `${prefix}-revealing.png` });
  await scrollProgress(page, 1);
  assert.equal((await state(page)).inert, false);
  await page.locator('#write-reveal').scrollIntoViewIfNeeded();
  await hit(page, '#write-button');
  await page.screenshot({ path: `${prefix}-writing.png` });

  // Checking native form interaction needs no student or production database changes.
  await page.mouse.move(120, 270);
  await page.waitForFunction(() => document.body.dataset.activeSchool === 'original');
  await page.evaluate(() => document.querySelector('#write-dialog').showModal());
  await page.locator('#write-dialog input[name="real_name"]').fill('交互检查');
  await page.mouse.move(1245, 270);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator('body').getAttribute('data-active-school'), 'original', 'An open dialog must keep its palette');
  await hit(page, '#write-dialog input[name="real_name"]');
  await hit(page, '#write-dialog .dialog-close');
  await page.locator('#write-dialog .dialog-close').click();
  await page.waitForFunction(() => !document.querySelector('#write-dialog').open);
  await page.waitForFunction(() => document.body.dataset.activeSchool === 'new');

  const keyboard = await context.newPage();
  keyboard.on('pageerror', error => errors.push(error.message));
  await ready(keyboard);
  await keyboard.locator('nav a[href="#write-section"]').focus();
  await keyboard.keyboard.press('Enter');
  await keyboard.waitForFunction(() => !document.querySelector('#write-reveal').inert);
  assert.equal((await state(keyboard)).opacity, 1, 'Keyboard navigation must reach the writing entrance');
  await keyboard.close();

  const mobileContext = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const mobile = await mobileContext.newPage();
    mobile.on('pageerror', error => errors.push(error.message));
    await ready(mobile);
    assert.equal((await state(mobile)).opacity, 0);
    await mobile.touchscreen.tap(25, 270);
    assert.equal(await mobile.locator('body').getAttribute('data-active-school'), 'balanced', 'Touch must retain both campuses');
    await mobile.screenshot({ path: `${prefix}-mobile.png` });
    await scrollProgress(mobile, 1);
    await mobile.locator('#write-reveal').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: `${prefix}-mobile-writing.png` });
    for (const width of [320, 390, 700, 768]) {
      await mobile.setViewportSize({ width, height: 844 });
      await noOverflow(mobile);
    }
  } finally { await mobileContext.close(); }

  const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  try {
    const quiet = await reduced.newPage();
    quiet.on('pageerror', error => errors.push(error.message));
    await ready(quiet);
    assert.equal((await state(quiet)).opacity, 0);
    await quiet.locator('.scroll-invitation').click();
    await quiet.waitForFunction(() => !document.querySelector('#write-reveal').inert);
    assert.equal((await state(quiet)).opacity, 1);
    assert.equal(await quiet.locator('#write-reveal').evaluate(el => getComputedStyle(el).transform), 'matrix(1, 0, 0, 1, 0, 0)');
    assert.equal(await quiet.locator('.school-atmosphere span').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  } finally { await reduced.close(); }
  assert.deepEqual(errors, []);
  console.log('首页验收通过：首屏爱心、绿原校/红新校、左右鼠标感应、滚动渐显、弹窗与键盘可用、触摸保留双色、320–768px 无溢出、减少动态效果。全程不写入业务数据。');
} finally { await context.close(); await browser.close(); }
