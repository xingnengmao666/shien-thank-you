import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const remote = Boolean(process.env.TEST_BASE_URL);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const login = JSON.parse(readFileSync(`.local/${remote ? 'production' : 'local'}-admin.json`,'utf8'));
let cookie = '', csrf = '';
async function call(path, method='GET', data, extra = {}, auth=false) {
  const headers = {'Content-Type':'application/json',Origin:new URL(base).origin,...(auth ? {Cookie:cookie,'X-CSRF-Token':csrf} : {}),...extra};
  const response = await fetch(base+path,{method,headers,body:data === undefined ? undefined : JSON.stringify(data),redirect:'manual'});
  const type = response.headers.get('Content-Type') || '';
  return {status:response.status,data:type.includes('json') ? await response.json() : await response.text(),headers:response.headers};
}
async function ok(path,method='GET',data,extra={},auth=false) { const r=await call(path,method,data,extra,auth); assert.ok(r.status>=200 && r.status<300, `${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; }
test('Real Worker + D1 complete business flow, security and cleanup', async t => {
  const suffix = randomBytes(5).toString('hex'), className = `[验收测试]${suffix}`, studentName = `验收同学${suffix}`, code = randomBytes(16).toString('hex');
  let classId, studentId, messageId, secondId; const previous = (await ok('/api/site')).settings;
  const content = '【自动化验收测试留言，将在测试结束后删除】老师，谢谢您耐心的教导。<img src=x onerror=alert(1)>这段文本仅测试安全转义。';
  await t.test('Admin HTML route is reachable and session cookie is secure', async () => {
    const page = await call('/admin'); assert.equal(page.status,200); assert.match(page.data,/管理员登录/);
    const response = await call('/api/admin/login','POST',{username:login.username,password:login.password}); assert.equal(response.status,200);
    cookie = response.headers.get('set-cookie').split(';')[0]; csrf = response.data.csrf_token;
    for (const flag of ['HttpOnly','Secure','SameSite=Strict']) assert.ok(response.headers.get('set-cookie').includes(flag));
  });
  try {
    await t.test('Unauthorized and missing CSRF mutations are blocked', async () => {
      assert.equal((await call('/api/admin/students')).status,401);
      assert.equal((await call('/api/admin/classes','POST',{class_name:'bad'},{Cookie:cookie})).status,403);
      assert.equal((await call('/api/admin/classes','POST',{class_name:'bad'},{Cookie:cookie,'X-CSRF-Token':csrf,Origin:'https://evil.example'})).status,403);
      assert.equal((await call('/api/students')).status,404);
    });
    await t.test('CSV import creates classes and stores roster; a duplicate import is atomic', async () => {
      const csv = `real_name,class_name,student_code,teacher_name\n${studentName},${className},${code},验收教师\n另一个验收同学,${className},${randomBytes(16).toString('hex')},验收教师`;
      const imported = await ok('/api/admin/students/import','POST',{csv},{},true); assert.equal(imported.imported,2);
      const classes = await ok('/api/admin/classes','GET',undefined,{},true); classId=classes.items.find(c=>c.class_name===className).id;
      const roster = await ok(`/api/admin/students?class_id=${classId}`,'GET',undefined,{},true); assert.equal(roster.total,2);
      studentId=roster.items.find(s=>s.real_name===studentName).id; secondId=roster.items.find(s=>s.id!==studentId).id;
      assert.ok(roster.items.every(s=>!('student_code' in s)));
      const mixed = `real_name,class_name,student_code\n新学生,${className},abcdefghijk123\n${studentName},${className},abcdefghijk124`;
      assert.equal((await call('/api/admin/students/import','POST',{csv:mixed},{},true)).status,409);
      assert.equal((await ok(`/api/admin/students?class_id=${classId}`,'GET',undefined,{},true)).total,2);
    });
    let credential;
    await t.test('Real student verification requires private code', async () => {
      assert.equal((await call('/api/student/verify','POST',{real_name:studentName,class_id:classId,student_code:'wrong123456'})).status,401);
      const verified=await ok('/api/student/verify','POST',{real_name:studentName,class_id:classId,student_code:code}); assert.equal(verified.verified,true); credential=verified.credential;
    });
    await t.test('Student submission persists as pending and duplicate or forged credentials fail', async () => {
      assert.equal((await call('/api/messages','POST',{content},{Authorization:'Bearer forged'})).status,401);
      assert.equal((await call('/api/messages','POST',{content:'too short'},{Authorization:`Bearer ${credential}`})).status,400);
      const submitted=await ok('/api/messages','POST',{content},{Authorization:`Bearer ${credential}`}); assert.equal(submitted.status,'pending');
      assert.equal((await call('/api/messages','POST',{content},{Authorization:`Bearer ${credential}`})).status,409);
      const list=await ok(`/api/admin/messages?class_id=${classId}&name=${encodeURIComponent(studentName)}`,'GET',undefined,{},true); assert.equal(list.total,1); messageId=list.items[0].id;
      assert.equal(list.items[0].content,content); assert.equal(list.items[0].status,'pending');
      const publicList=await ok('/api/messages?status=pending'); assert.ok(!publicList.items.some(m=>m.id===messageId));
    });
    await t.test('Approval publishes only safe public fields; independent client and refresh agree', async () => {
      await ok(`/api/admin/messages/${messageId}/approve`,'POST',undefined,{},true);
      const first=await ok('/api/messages?page_size=100&sort=stable'), second=await ok('/api/messages?page_size=100&sort=stable');
      assert.deepEqual(first.items,second.items); const published=first.items.find(m=>m.id===messageId); assert.ok(published); assert.equal(published.content,content); assert.equal(published.display_name,'验同学');
      for (const key of ['student_id','real_name','student_code','credential','reviewed_by']) assert.ok(!(key in published));
      assert.equal((await call('/api/messages?sort=malicious')).status,400);
    });
    await t.test('Hiding and rejecting remove public notes; class and dashboard statistics match', async () => {
      await ok(`/api/admin/messages/${messageId}/hide`,'POST',undefined,{},true); assert.ok(!(await ok('/api/messages?page_size=100')).items.some(m=>m.id===messageId));
      await ok(`/api/admin/messages/${messageId}/reject`,'POST',undefined,{},true);
      const group=await ok(`/api/admin/classes/${classId}/stats`,'GET',undefined,{},true); assert.equal(group.student_count,2); assert.equal(group.submitted_count,1); assert.equal(group.approved_count,0);
      const stats=await ok('/api/admin/dashboard','GET',undefined,{},true); assert.ok(stats.rejected>=1 && stats.students_total>=2 && stats.today>=1);
    });
    await t.test('Settings persist, submission switch is enforced, edits revoke student credentials', async () => {
      const changed={...previous,submissions_open:false,name_display:'anonymous'};
      await ok('/api/admin/settings','PUT',changed,{},true); assert.equal((await ok('/api/site')).settings.name_display,'anonymous');
      assert.equal((await call('/api/messages','POST',{content},{Authorization:`Bearer ${credential}`})).status,403);
      await ok('/api/admin/settings','PUT',{...previous,submissions_open:Boolean(previous.submissions_open)},{},true);
      await ok(`/api/admin/students/${studentId}`,'PUT',{real_name:studentName,class_id:classId},{},true);
      assert.equal((await call('/api/messages','POST',{content},{Authorization:`Bearer ${credential}`})).status,401);
      assert.equal((await call(`/api/admin/classes/${classId}`,'DELETE',undefined,{},true)).status,409);
      assert.equal((await call(`/api/admin/students/${studentId}`,'DELETE',undefined,{},true)).status,409);
    });
    await t.test('Critical operations have durable audit logs', async () => {
      const logs=await ok('/api/admin/audit-logs?page_size=100','GET',undefined,{},true);
      for (const action of ['csv_import','approve','hide','reject','update']) assert.ok(logs.items.some(log=>log.action===action),action);
    });
  } finally {
    await ok('/api/admin/settings','PUT',{...previous,submissions_open:Boolean(previous.submissions_open)},{},true);
    if (messageId) await ok(`/api/admin/messages/${messageId}`,'DELETE',undefined,{},true);
    for (const student of [studentId,secondId].filter(Boolean)) await ok(`/api/admin/students/${student}`,'DELETE',undefined,{},true);
    if (classId) await ok(`/api/admin/classes/${classId}`,'DELETE',undefined,{},true);
  }
  await t.test('Logout revokes server-side session', async () => { await ok('/api/admin/logout','POST',undefined,{},true); assert.equal((await call('/api/admin/me','GET',undefined,{},true)).status,401); });
});
