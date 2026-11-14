import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
assert.ok(!process.env.TEST_BASE_URL, 'Run note fixtures only against local D1');
const base = 'http://127.0.0.1:8787', account = JSON.parse(readFileSync('.local/local-admin.json', 'utf8'));
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage(), errors = [], tag = randomBytes(4).toString('hex');
page.on('pageerror', error => errors.push(error.message));
const className = `[便签验收]${tag}`, label = `【便签验收${tag}，测试结束删除】`;
const contents = [label + '祝您在新的学校中前程似锦，万事顺利。', label + '感谢您的耐心教导。'.repeat(130), label + '\n' + '记得您在课堂上的鼓励。\n'.repeat(100)];
for (let i = 1; i < contents.length; i++) contents[i] = [...contents[i]].slice(0, 994).join('') + '最后一行结束';
mkdirSync('test-results', { recursive: true });
let headers, group;
async function json(response) { assert.ok(response.ok(), `API failed: ${response.status()} ${await response.text()}`); return response.json(); }
async function ready(count) {
  await page.goto(base);
  await page.waitForFunction(count => Number(document.querySelector('#approved-count').textContent) === count && document.querySelector('#sync-status').textContent.includes('已同步'), count);
  await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.heart-note')].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))); });
}
async function settle() {
  await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.heart-note,.note-preview')].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))); });
}
async function expandAll() {
  const collapsed = page.locator('.note-toggle:not([hidden])[aria-expanded="false"]');
  while (await collapsed.count()) { await collapsed.first().click(); await settle(); }
}
async function complete() {
  const notes = await page.locator('.heart-note').evaluateAll(notes => notes.map(note => {
    const text = note.querySelector('.note-preview'), author = note.querySelector('.note-author'), r = note.getBoundingClientRect();
    return { content: text.textContent, clipped: text.scrollHeight > text.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1, font: parseFloat(getComputedStyle(text).fontSize), author: getComputedStyle(author).display, rect: { x: r.x, y: r.y, right: r.right, bottom: r.bottom } };
  }));
  assert.deepEqual(notes.map(n => n.content), contents);
  assert.ok(notes.every(n => !n.clipped && n.font >= 14 && n.author !== 'none'), 'A note or its signature is clipped or too small');
  for (let a = 0; a < notes.length; a++) for (let b = a + 1; b < notes.length; b++) {
    const x = notes[a].rect, y = notes[b].rect;
    assert.ok(x.right <= y.x || y.right <= x.x || x.bottom <= y.y || y.bottom <= x.y, 'Notes overlap');
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow');
  assert.ok(await page.evaluate(() => {
    const stage = document.querySelector('#heart-stage').getBoundingClientRect(), path = document.querySelector('.heart-outline path').getBoundingClientRect();
    return path.height >= stage.height * .7 && path.y < stage.y + stage.height * .15 && [...document.querySelectorAll('.heart-note')].every(note => {
      const r = note.getBoundingClientRect(); return r.x >= path.x && r.right <= path.right && r.y >= path.y && r.bottom <= path.bottom;
    });
  }), 'The heart fill and outline did not expand around all notes');
}
try {
  await json(await context.request.post(`${base}/api/admin/login`, { headers: { Origin: base }, data: account }));
  const me = await json(await context.request.get(`${base}/api/admin/me`)); headers = { Origin: base, 'X-CSRF-Token': me.csrf_token };
  await json(await context.request.post(`${base}/api/admin/classes`, { headers, data: { class_name: className, teacher_name: '便签验收教师' } }));
  group = (await json(await context.request.get(`${base}/api/admin/classes`))).items.find(c => c.class_name === className);
  const codes = contents.map(() => randomBytes(16).toString('hex')), names = contents.map((_, i) => `便签测试${tag}${i}`);
  await json(await context.request.post(`${base}/api/admin/students/import`, { headers, data: { csv: 'real_name,class_name,student_code\n' + names.map((n, i) => `${n},${className},${codes[i]}`).join('\n') } }));
  let small;
  for (let i = 0; i < contents.length; i++) {
    const verified = await json(await context.request.post(`${base}/api/student/verify`, { headers: { Origin: base }, data: { real_name: names[i], class_id: group.id, student_code: codes[i] } }));
    await json(await context.request.post(`${base}/api/messages`, { headers: { Origin: base, Authorization: `Bearer ${verified.credential}` }, data: { content: contents[i] } }));
    const message = (await json(await context.request.get(`${base}/api/admin/messages?class_id=${group.id}`))).items.find(m => m.content === contents[i]);
    await json(await context.request.post(`${base}/api/admin/messages/${message.id}/approve`, { headers }));
    await ready(i + 1);
    const size = await page.locator('#heart-stage').boundingBox();
    if (i === 0) { small = size; await page.screenshot({ path: 'test-results/local-note-complete-single.png' }); }
    else assert.ok(size.width >= small.width && size.height > small.height, 'Heart did not expand for more content');
  }
  assert.ok(await page.locator('.heart-note').evaluateAll(notes => notes.every(note => note.offsetHeight < 220)), 'Collapsed notes are too large');
  const originalCurve = await page.locator('.heart-outline path').getAttribute('d');
  assert.ok(!originalCurve.includes('L'), 'The original curved heart acquired straight edges');
  await page.screenshot({ path: 'test-results/local-notes-compact.png', fullPage: true });
  const compact = await page.locator('#heart-stage').boundingBox();
  await expandAll();
  assert.equal(await page.locator('.heart-outline path').getAttribute('d'), originalCurve, 'Expansion changed the heart outline');
  assert.ok((await page.locator('#heart-stage').boundingBox()).height > compact.height, 'The heart did not grow with expansion');
  await complete();
  await page.screenshot({ path: 'test-results/local-notes-complete-desktop.png', fullPage: true });
  const order = await page.locator('.heart-note').evaluateAll(notes => notes.map(n => n.dataset.messageId));
  const toggle = page.locator('.note-toggle').nth(1);
  await toggle.focus(); await page.keyboard.press('Enter'); await settle();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(await page.locator('.heart-note').nth(1).evaluate(note => note.offsetHeight < 220));
  await ready(3); assert.deepEqual(await page.locator('.heart-note').evaluateAll(notes => notes.map(n => n.dataset.messageId)), order); await expandAll();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.evaluate(async () => { await Promise.all([...document.querySelectorAll('.heart-note')].flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))); });
    await complete();
    if (width <= 390) assert.ok(await page.locator('.heart-note').evaluateAll(notes => notes.every(note => note.style.getPropertyValue('--rotation') === '0deg')), 'Single-column notes must stay upright inside the heart');
    if (width === 390) await page.screenshot({ path: 'test-results/local-notes-complete-mobile.png', fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('便签验收通过：紧凑预览、键盘展开/收起、1000 字与多行全文可读、署名完整、无重叠、原有曲线不变、爱心随数量与展开同步扩展、刷新顺序稳定、320/390/768px 可读。真实本地 D1 测试数据已清理。');
} finally {
  try {
    if (group && headers) {
      const messages = await json(await context.request.get(`${base}/api/admin/messages?class_id=${group.id}`));
      for (const m of messages.items) await json(await context.request.delete(`${base}/api/admin/messages/${m.id}`, { headers }));
      const students = await json(await context.request.get(`${base}/api/admin/students?class_id=${group.id}`));
      for (const s of students.items) await json(await context.request.delete(`${base}/api/admin/students/${s.id}`, { headers }));
      await json(await context.request.delete(`${base}/api/admin/classes/${group.id}`, { headers }));
    }
    if (headers) await context.request.post(`${base}/api/admin/logout`, { headers });
  } finally { await context.close(); await browser.close(); }
}
