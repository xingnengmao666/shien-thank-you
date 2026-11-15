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
  await page.clock.install();
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
async function hint(page, animated = true) {
  await page.clock.fastForward(800);
  await page.locator('#theme-hint').waitFor();
  const animations = await page.locator('#theme-hint').evaluate(el => el.getAnimations().map(animation => ({
    name: animation.animationName, frames: animation.effect.getKeyframes(), duration: animation.effect.getTiming().duration
  })));
  if (animated) {
    assert.ok(animations.some(animation => animation.name === 'theme-hint-enter' && animation.frames.some(frame => frame.transform === 'translateY(4px) scale(1.025)')), 'The hint must spring past its resting position');
    assert.ok(animations.some(animation => animation.frames[0].opacity === '0' && animation.frames.at(-1).opacity === '1'), 'The hint must fade in');
  } else assert.deepEqual(animations, [], 'Reduced motion must show the hint without animation');
  await page.locator('#theme-hint').evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
  const box = await page.locator('#theme-hint').boundingBox(), viewport = page.viewportSize();
  assert.ok(Math.abs(box.x + box.width / 2 - viewport.width / 2) < 1, 'The hint must be horizontally centered');
  assert.ok(box.y >= 80 && box.y < viewport.height / 4 && box.width <= 360 && box.height <= 160, 'Keep the hint small and near the top');
}
try {
  const page = await open(context);
  assert.ok(await page.locator('#theme-hint').isHidden(), 'Do not show the hint immediately');
  await hint(page);
  assert.equal(await page.locator('#theme-hint').evaluate(el => el.contains(document.activeElement)), false, 'The hint must not steal focus');
  await page.screenshot({ path: 'test-results/local-theme-hint-desktop.png' });
  await page.locator('.theme-hint-close').hover();
  await page.clock.fastForward(9000);
  assert.ok(await page.locator('#theme-hint').isVisible(), 'Hovering pauses automatic dismissal');
  await page.locator('.theme-hint-action').focus();
  await page.mouse.move(0, 0);
  await page.clock.fastForward(9000);
  assert.ok(await page.locator('#theme-hint').isVisible(), 'Keyboard focus pauses automatic dismissal');
  await page.locator('.theme-hint-action').click();
  await page.waitForFunction(() => document.activeElement.matches('[data-theme-select]'));
  const fadeOut = await page.locator('#theme-hint').evaluate(el => el.getAnimations().some(animation => animation.effect.getKeyframes().at(-1).opacity === '0'));
  assert.ok(fadeOut, 'Dismissal must fade out');
  await page.clock.fastForward(200);
  await page.locator('#theme-hint').waitFor({ state: 'hidden' });
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
  await hint(page);
  await page.clock.fastForward(8200);
  await page.locator('#theme-hint').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--school-original').trim()), '#67d027');
  const codeget = await open(context, '/codeget');
  assert.equal(await codeget.locator('#theme-hint').count(), 0);
  await theme(codeget, 'campus');
  await codeget.locator('[data-theme-select]').selectOption('sakura');
  await theme(codeget, 'sakura');
  await theme(page, 'sakura');
  await background(codeget);
  const admin = await open(context, '/admin');
  assert.equal(await admin.locator('#theme-hint').count(), 0);
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
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await hint(page);
  await page.screenshot({ path: 'test-results/local-theme-hint-mobile.png' });
  for (const width of [320, 390, 768, 1365]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('#theme-hint').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `Theme hint overflow at ${width}px`);
    const header = await page.locator('.site-header').boundingBox();
    assert.ok(box.y >= header.y + header.height, `Theme hint must leave navigation available at ${width}px`);
  }
  await page.locator('.theme-hint-close').click();
  await page.clock.fastForward(200);
  await page.locator('#theme-hint').waitFor({ state: 'hidden' });
  assert.ok(await page.locator('[data-theme-select]').evaluate(el => el === document.activeElement), 'Closing a focused hint returns focus to the theme picker');

  const unavailable = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await unavailable.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage disabled', 'SecurityError'); } }));
    const quiet = await open(unavailable);
    await theme(quiet, 'sakura');
    await hint(quiet, false);
    await quiet.locator('[data-theme-select]').selectOption('campus');
    await theme(quiet, 'campus');
    assert.ok(await quiet.locator('#theme-hint').isHidden(), 'Switching themes dismisses the hint');
    await quiet.locator('[data-theme-select]').selectOption('sakura');
    await theme(quiet, 'sakura');
    assert.equal(await quiet.locator('.heart-outline path').evaluate(el => getComputedStyle(el).animationName), 'none');
  } finally { await unavailable.close(); }
  assert.deepEqual(errors, []);
  console.log('主题验收通过：原图背景、主题记忆与跨页同步、存储回退、320–1365px 排版；首页提示延迟、弹簧/淡入淡出、自动/手动关闭、悬停/焦点暂停、切换入口与减少动态效果。仅本地检查，不写业务数据。');
} finally { await context.close(); await browser.close(); }
