import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const remote = Boolean(process.env.TEST_BASE_URL), base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}), ...(process.env.BROWSER_PROXY ? { proxy: { server: process.env.BROWSER_PROXY, bypass: '127.0.0.1,localhost' } } : {}) });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage(), errors = [], classIds = [], studentIds = [], logNames = [];
const admin = await browser.newContext();
let csrf, loggedIn = false;
page.on('pageerror', error => errors.push(error.message));
mkdirSync('test-results', { recursive: true });
async function adminAPI(path, method = 'GET', data) {
  const response = await admin.request.fetch(base + path, { method, headers: { Origin: new URL(base).origin, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(data ? { data } : {}) });
  const result = await response.json(); assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${JSON.stringify(result)}`); return result;
}
async function screenshot(path) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
  });
  await page.screenshot({ path, fullPage: true });
}
try {
  assert.equal((await page.goto(base + '/codeget')).status(), 200);
  await page.waitForFunction(() => !document.querySelector('#codeget-button').disabled || document.querySelector('#codeget-status').textContent.length > 0);
  assert.equal(await page.locator('#codeget-class-field').isVisible(), false);
  const cookie = (await context.cookies()).find(c => c.name === '__Host-codeget_device');
  assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('codeget_device')), false);
  for (const width of [1365, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}px`);
    await screenshot(`test-results/${remote ? 'remote' : 'local'}-codeget-${width}.png`);
  }
  await page.setViewportSize({ width: 1365, height: 900 });
  if (!remote) {
    const login = JSON.parse(readFileSync('.local/local-admin.json', 'utf8'));
    const session = await adminAPI('/api/admin/login', 'POST', login); csrf = session.csrf_token; loggedIn = true;
    const suffix = randomBytes(5).toString('hex'), name = `领码测试${suffix}`, other = `另一同学${suffix}`;
    logNames.push(name, other);
    const oldCode = randomBytes(16).toString('hex');
    for (const number of [1, 2]) {
      const group = await adminAPI('/api/admin/classes', 'POST', { class_name: `[领取验收]${suffix}-${number}` }); classIds.push(group.id);
      const student = await adminAPI('/api/admin/students', 'POST', { real_name: name, class_id: group.id, student_code: oldCode }); studentIds.push(student.id);
    }
    const extra = await adminAPI('/api/admin/students', 'POST', { real_name: other, class_id: classIds[0], student_code: oldCode }); studentIds.push(extra.id);
    await page.reload(); await page.waitForFunction(() => !document.querySelector('#codeget-button').disabled);
    await page.locator('[name=real_name]').fill(name);
    await page.locator('#codeget-button').click(); await page.locator('#codeget-class-field').waitFor({ state: 'visible' });
    await page.locator('#codeget-class').selectOption(String(classIds[0]));
    const request = page.waitForRequest(r => r.url().endsWith('/api/student/codeget') && r.method() === 'POST');
    await page.locator('#codeget-button').click(); const payload = (await request).postDataJSON();
    assert.match(payload.fingerprint, /^[a-f0-9]{64}$/); assert.equal(payload.real_name, name);
    await page.locator('#codeget-result').waitFor({ state: 'visible' });
    let code = await page.locator('#codeget-code').inputValue(); assert.match(code, /^[a-f0-9]{32}$/);
    assert.notEqual(code, oldCode); assert.equal(await page.locator('#codeget-form').isVisible(), false);
    assert.ok((await page.locator('#codeget-save-reminder').textContent()).includes('尽快截图保存邀请码'));
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.ok(await page.locator('#codeget-code').evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'Screenshot must include the entire code');
      await screenshot(`test-results/local-codeget-success-${width}.png`);
    }
    await page.setViewportSize({ width: 1365, height: 900 });
    await screenshot('test-results/local-codeget-success.png');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#copy-code').click(); await page.waitForFunction(() => document.querySelector('#codeget-status').textContent.includes('已复制'));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
    const rosterPage = await admin.newPage(); rosterPage.on('pageerror', error => errors.push(error.message));
    await rosterPage.goto(base + '/admin'); await rosterPage.locator('#admin-shell').waitFor({ state: 'visible' });
    await rosterPage.locator('.sidebar [data-view=students]').click();
    await rosterPage.waitForFunction(() => !document.querySelector('#view-students').hasAttribute('aria-busy'));
    await rosterPage.locator('#students-filter [name=class_id]').selectOption(String(classIds[0]));
    await rosterPage.locator('#students-filter [name=name]').fill(name);
    await rosterPage.locator('#students-filter button').click();
    await rosterPage.waitForFunction(() => document.querySelector('#students-body').children.length === 1);
    const reset = rosterPage.locator('#students-body button').filter({ hasText: '重置领取次数' });
    await reset.click(); await rosterPage.locator('#confirm-cancel').click();
    assert.equal((await adminAPI(`/api/admin/students?class_id=${classIds[0]}&name=${encodeURIComponent(name)}`)).items[0].claim_count, 1);
    const downloading = rosterPage.waitForEvent('download'); await rosterPage.locator('#export-codes').click();
    const download = await downloading, exported = readFileSync(await download.path(), 'utf8');
    assert.match(download.suggestedFilename(), /^invite-codes-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.ok(exported.startsWith('\ufeff')); assert.ok(exported.includes(code)); assert.ok(!exported.includes(oldCode));
    assert.equal(exported.trim().split('\r\n').length, 2);
    await reset.click(); await rosterPage.locator('#confirm-yes').click();
    await rosterPage.waitForFunction(() => document.querySelector('#students-body').textContent.includes('0 / 1'));
    await rosterPage.waitForFunction(() => getComputedStyle(document.querySelector('#confirm-dialog')).display === 'none');
    assert.equal((await adminAPI(`/api/admin/students?class_id=${classIds[0]}&name=${encodeURIComponent(name)}`)).items[0].claim_count, 0);
    await rosterPage.screenshot({ path: 'test-results/local-student-code-tools.png', fullPage: true });
    await rosterPage.setViewportSize({ width: 320, height: 844 });
    assert.ok(await rosterPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await rosterPage.screenshot({ path: 'test-results/local-student-code-tools-mobile.png', fullPage: true });
    await rosterPage.close();
    await page.goto(base + '/codeget'); await page.waitForFunction(() => !document.querySelector('#codeget-button').disabled);
    await page.locator('[name=real_name]').fill(name); await page.locator('#codeget-button').click();
    await page.locator('#codeget-class-field').waitFor({ state: 'visible' });
    await page.locator('#codeget-class').selectOption(String(classIds[0]));
    await page.locator('#codeget-button').click(); await page.locator('#codeget-result').waitFor({ state: 'visible' });
    const previous = code; code = await page.locator('#codeget-code').inputValue(); assert.notEqual(code, previous);
    const verifyOld = await context.request.post(base + '/api/student/verify', { headers: { Origin: new URL(base).origin }, data: { real_name: name, class_id: classIds[0], student_code: previous } });
    assert.equal(verifyOld.status(), 401);
    await page.locator('#codeget-result a').click(); await page.locator('#write-button').waitFor({ state: 'visible' });
    await page.locator('#write-button').click();
    await page.locator('#verify-form [name=real_name]').fill(name);
    await page.locator('#verify-class').selectOption(String(classIds[0]));
    await page.locator('#verify-form [name=student_code]').fill(code);
    await page.locator('#verify-form button').click(); await page.locator('#message-form').waitFor({ state: 'visible' });
    await page.locator('#message-content').fill('【领取验证码验收测试，完成后删除】谢谢老师耐心教导，让我们更有勇气表达自己。');
    await page.locator('#message-form button').click(); await page.locator('#submit-success').waitFor({ state: 'visible' });
    await page.goto(base + '/codeget'); await page.waitForFunction(() => !document.querySelector('#codeget-button').disabled);
    await page.locator('[name=real_name]').fill(other); await page.locator('#codeget-button').click();
    await page.waitForFunction(() => document.querySelector('#codeget-status').textContent.includes('已领取过'));
    assert.equal(await page.locator('#codeget-result').isVisible(), false);
    assert.equal(await page.locator('#codeget-button').getAttribute('aria-busy'), null);
    await screenshot('test-results/local-codeget-duplicate.png');
    const malicious = `<img src=x onerror=alert(1)>${suffix}`; logNames.push(malicious);
    await page.locator('[name=real_name]').fill(malicious); await page.locator('#codeget-button').click();
    await page.waitForFunction(() => document.querySelector('#codeget-status').textContent.includes('已领取过'));
    const logs = await adminAPI(`/api/admin/codeget-logs?name=${encodeURIComponent(name)}`);
    assert.equal(logs.total, 4);
    const issued = logs.items.find(item => item.outcome === 'issued' && item.claim_id);
    assert.ok(issued); assert.ok(issued.ip_address); assert.equal(issued.fingerprint, payload.fingerprint);
    assert.match(issued.device_hash, /^[a-f0-9]{64}$/); assert.notEqual(issued.device_hash, cookie.value);
    assert.equal(issued.real_name, name); assert.equal(issued.class_name, `[领取验收]${suffix}-1`);
    assert.ok(!JSON.stringify(logs).includes(code)); assert.ok(!JSON.stringify(logs).includes(cookie.value));
  } else {
    const login = JSON.parse(readFileSync('.local/production-admin.json', 'utf8'));
    const session = await adminAPI('/api/admin/login', 'POST', login); csrf = session.csrf_token; loggedIn = true;
  }
  const adminPage = await admin.newPage(); adminPage.on('pageerror', error => errors.push(error.message));
  await adminPage.goto(base + '/admin'); await adminPage.locator('#admin-shell').waitFor({ state: 'visible' });
  await adminPage.locator('.sidebar [data-view=codeget]').click();
  await adminPage.waitForFunction(() => document.querySelector('#view-codeget').getAttribute('aria-busy') === null);
  assert.equal(await adminPage.locator('#view-title').textContent(), '领码记录');
  assert.equal(await adminPage.locator('#codeget-body img').count(), 0);
  if (!remote) {
    await adminPage.locator('#codeget-filter [name=name]').fill(logNames[0]);
    await adminPage.locator('#codeget-filter button').click();
    await adminPage.waitForFunction(() => document.querySelector('#codeget-body').children.length === 4);
    assert.ok((await adminPage.locator('#codeget-body').textContent()).includes('领取成功'));
    assert.ok((await adminPage.locator('#codeget-body').textContent()).includes('需选择班级'));
    await adminPage.locator('#codeget-filter [name=name]').fill(logNames[2]);
    await adminPage.locator('#codeget-filter [name=outcome]').selectOption('rejected');
    await adminPage.locator('#codeget-filter button').click();
    await adminPage.waitForFunction(name => document.querySelector('#codeget-body').textContent.includes(name), logNames[2]);
    assert.equal(await adminPage.locator('#codeget-body img').count(), 0);
    await adminPage.locator('#codeget-filter [name=name]').fill(logNames[1]);
    await adminPage.locator('#codeget-filter button').click();
    await adminPage.waitForFunction(name => document.querySelector('#codeget-body').textContent.includes(name), logNames[1]);
    await adminPage.screenshot({ path: 'test-results/local-codeget-admin-logs.png', fullPage: true });
    await adminPage.setViewportSize({ width: 390, height: 844 });
    assert.ok(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await adminPage.screenshot({ path: 'test-results/local-codeget-admin-mobile.png', fullPage: true });
  }
  if (!remote) {
    await page.goto(base); await page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
    assert.equal(await page.locator('.heart-outline path').evaluate(el => getComputedStyle(el).animationName), 'heart-thread');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.heart-outline path').evaluate(el => getComputedStyle(el).animationName), 'none');
  }
  assert.deepEqual(errors, []);
  console.log(remote ? '线上只读验收通过：领取页 Cookie/布局与主管理员领码记录入口可用，无脚本错误；未领取正式验证码。' : '真实浏览器验收通过：领取/复制/截图提醒、单学生重置及取消、CSV 下载、同设备重领与旧码失效、寄语提交、后台留痕、手机布局及减少动态效果。');
} finally {
  try {
    if (loggedIn) {
      // Only remove this local test's traces and claims; never clear production records.
      if (!remote && logNames.length) execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--command', `DELETE FROM codeget_logs WHERE real_name IN (${logNames.map(name => `'${name.replace(/'/g, "''")}'`).join(',')})`], { stdio: 'pipe' });
      if (studentIds.length) execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--command', `DELETE FROM code_claims WHERE student_id IN (${studentIds.map(Number).join(',')})`], { stdio: 'pipe' });
      for (const classId of classIds) {
        const messages = await adminAPI(`/api/admin/messages?class_id=${classId}`);
        for (const message of messages.items) await adminAPI(`/api/admin/messages/${message.id}`, 'DELETE');
      }
      for (const studentId of studentIds) await adminAPI(`/api/admin/students/${studentId}`, 'DELETE');
      for (const classId of classIds) await adminAPI(`/api/admin/classes/${classId}`, 'DELETE');
      await adminAPI('/api/admin/logout', 'POST');
    }
  } finally { await browser.close(); }
}
