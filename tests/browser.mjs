import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const remote=Boolean(process.env.TEST_BASE_URL), base=process.env.TEST_BASE_URL||'http://127.0.0.1:8787';
const account=JSON.parse(readFileSync(`.local/${remote?'production':'local'}-admin.json`,'utf8'));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{}),...(process.env.BROWSER_PROXY?{proxy:{server:process.env.BROWSER_PROXY,bypass:'127.0.0.1,localhost'}}:{})});
const adminContext=await browser.newContext({viewport:{width:1440,height:1000}}), publicContext=await browser.newContext({viewport:{width:1365,height:1000}});
const admin=await adminContext.newPage(), student=await publicContext.newPage();
const errors=[];
for (const page of [admin,student]) page.on('pageerror',error=>errors.push(error.message));
const suffix=randomBytes(4).toString('hex'), className=`[浏览器验收]${suffix}`, studentName=`测试同学${suffix}`, code=randomBytes(16).toString('hex');
const text='【浏览器验收测试，完成后删除】谢谢老师在课堂上耐心解答问题，也谢谢您让我更有勇气。<img src=x onerror=alert(1)>必须作为普通文字显示。';
mkdirSync('test-results',{recursive:true});
async function overflow(page) { assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page has horizontal overflow'); }
async function settle(page) {
  await page.evaluate(async () => {
    const effects = [...document.querySelectorAll('dialog,.heart-note')].flatMap(node => node.getAnimations());
    await Promise.all(effects.filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}
try {
  await admin.goto(`${base}/admin`); await admin.locator('#login-form [name=username]').fill(account.username); await admin.locator('#login-form [name=password]').fill(account.password); await admin.locator('#login-form button').click(); await admin.locator('#admin-shell').waitFor({state:'visible'});
  await admin.locator('.sidebar [data-view=classes]').click(); await admin.locator('#add-class').click(); await admin.locator('#edit-form [name=class_name]').fill(className); await admin.locator('#edit-form [name=teacher_name]').fill('验收教师'); await admin.locator('#edit-form button').click(); await admin.locator('#edit-dialog').waitFor({state:'hidden'});
  await admin.locator('.sidebar [data-view=students]').click(); await admin.locator('#add-student').click(); await admin.locator('#edit-form [name=real_name]').fill(studentName); await admin.locator('#edit-form [name=class_id]').selectOption({label:className}); await admin.locator('#edit-form [name=student_code]').fill(code); await admin.locator('#edit-form button').click(); await admin.locator('#edit-dialog').waitFor({state:'hidden'});
  await student.goto(base); await student.waitForFunction(()=>!document.querySelector('#write-button').disabled);
  assert.ok(await student.locator('#write-reveal').evaluate(el=>el.inert && getComputedStyle(el).visibility==='hidden'),'Writing entrance must start hidden');
  await overflow(student); await student.screenshot({path:`test-results/${remote?'remote':'local'}-desktop-empty.png`,fullPage:true});
  await student.locator('.scroll-invitation').click(); await student.waitForFunction(()=>!document.querySelector('#write-reveal').inert);
  await student.locator('#write-button').click(); await student.locator('#verify-form [name=real_name]').fill(studentName); await student.locator('#verify-form [name=class_id]').selectOption({label:className}); await student.locator('#verify-form [name=student_code]').fill(code); await student.locator('#verify-form button').click(); await student.locator('#message-form').waitFor({state:'visible'}); await student.locator('#message-content').fill(text); await student.locator('#message-form button').click(); await student.locator('#submit-success').waitFor({state:'visible'}); await student.locator('#submit-success [data-close]').click();
  assert.equal(await student.locator('.heart-note').count(),0,'Pending message leaked into public wall');
  await admin.locator('.sidebar [data-view=messages]').click(); const row=admin.locator('#messages-body tr').filter({hasText:studentName}); await row.waitFor({state:'visible'}); await row.getByRole('button',{name:'通过',exact:true}).click();
  // Reload is also the persistence proof; the subsequent interval checks automatic synchronization.
  await student.reload(); await student.locator('.heart-note').first().waitFor({state:'visible'}); assert.equal(await student.locator('.heart-note').count(),1);
  assert.equal(await student.locator('#notes img').count(),0,'User content was interpreted as HTML');
  assert.equal(await student.locator('.heart-note').getAttribute('data-campus'),'new','A centered note uses the new-campus paper');
  const mobileContext=await browser.newContext({...devices['Pixel 7']});
  try {
    const mobile=await mobileContext.newPage(); await mobile.goto(base); await mobile.locator('.heart-note').waitFor({state:'visible'}); await mobile.locator('.note-read').click(); assert.equal(await mobile.locator('#read-content').textContent(),text); await overflow(mobile);
  } finally { await mobileContext.close(); }
  const position=await student.locator('.heart-note').first().getAttribute('style'); await student.reload(); await student.locator('.heart-note').first().waitFor({state:'visible'}); assert.equal(await student.locator('.heart-note').first().getAttribute('style'),position);
  await student.locator('.note-read').click(); await student.locator('#read-dialog').waitFor({state:'visible'}); assert.equal(await student.locator('#read-content').textContent(),text); await student.locator('#read-dialog [data-close]').click(); await settle(student);
  await student.screenshot({path:`test-results/${remote?'remote':'local'}-desktop-note.png`,fullPage:true});
  await student.setViewportSize({width:390,height:844}); await settle(student); await overflow(student); await student.screenshot({path:`test-results/${remote?'remote':'local'}-mobile.png`,fullPage:true}); await student.locator('.note-read').click(); await student.locator('#read-dialog').waitFor({state:'visible'}); await student.locator('#read-dialog [data-close]').click(); await settle(student);
  await admin.locator('#messages-filter [name=status]').selectOption('approved'); await admin.locator('#messages-filter button').click(); await admin.locator('#messages-body tr').filter({hasText:studentName}).waitFor({state:'visible'}); await admin.screenshot({path:`test-results/${remote?'remote':'local'}-admin.png`,fullPage:true});
  await admin.locator('#messages-body tr').filter({hasText:studentName}).getByRole('button',{name:'隐藏',exact:true}).click(); await student.waitForFunction(()=>document.querySelectorAll('.heart-note').length===0,{},{timeout:40000});
  await admin.setViewportSize({width:390,height:844}); await overflow(admin); await admin.screenshot({path:`test-results/${remote?'remote':'local'}-admin-mobile.png`,fullPage:true});
  assert.deepEqual(errors,[]); console.log('浏览器验收通过：真实登录、班级和学生管理、核验、提交、审核、便签阅读、稳定布局、自动同步、桌面与手机无横向溢出。');
} finally {
  // Clean only this run's explicitly marked fixtures, even if a UI assertion fails.
  try {
    const me=await adminContext.request.get(`${base}/api/admin/me`), data=await me.json();
    const headers={Origin:new URL(base).origin,'X-CSRF-Token':data.csrf_token};
    const groups=await (await adminContext.request.get(`${base}/api/admin/classes`)).json(); const group=groups.items.find(c=>c.class_name===className);
    if (group) {
      const messages=await (await adminContext.request.get(`${base}/api/admin/messages?class_id=${group.id}`)).json(); for (const m of messages.items) assert.ok((await adminContext.request.delete(`${base}/api/admin/messages/${m.id}`,{headers})).ok());
      const students=await (await adminContext.request.get(`${base}/api/admin/students?class_id=${group.id}`)).json(); for (const s of students.items) assert.ok((await adminContext.request.delete(`${base}/api/admin/students/${s.id}`,{headers})).ok());
      assert.ok((await adminContext.request.delete(`${base}/api/admin/classes/${group.id}`,{headers})).ok());
    }
    await adminContext.request.post(`${base}/api/admin/logout`,{headers});
  } finally { await browser.close(); }
}
