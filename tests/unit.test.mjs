import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCSV, parseCSV } from '../src/csv.js';
import { displayName, str } from '../src/lib.js';
import { adminAuth, checkOrigin, decryptCode, digest, encryptCode, equal, keyedHash, passwordHash, passwordMatches, rateLimit, token } from '../src/security.js';
import { heartRows } from '../public/heart.js';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';

test('Only trusted mainland China geolocation prefixes the background URL, without cache reuse', async () => {
  const css = readFileSync('public/theme.css', 'utf8');
  for (const country of ['CN', 'HK', 'MO', 'TW', 'US', undefined]) {
    const request = new Request('https://school.example/theme.css', { headers: {
      'CF-IPCountry': 'CN', 'If-None-Match': 'old-theme', 'If-Modified-Since': 'Sun, 15 Nov 2026 00:00:00 GMT', Range: 'bytes=0-9', 'If-Range': 'old-theme'
    } });
    if (country) request.cf = { country };
    const response = await worker.fetch(request, { ASSETS: { fetch: async assetRequest => {
      for (const name of ['If-None-Match', 'If-Modified-Since', 'Range', 'If-Range']) assert.equal(assetRequest.headers.get(name), null);
      assert.equal(assetRequest.headers.get('Accept-Encoding'), 'identity');
      return new Response(css, { headers: { 'Content-Type': 'text/css', 'Cache-Control': 'public, max-age=3600', ETag: 'old-theme', 'Last-Modified': 'Sun, 15 Nov 2026 00:00:00 GMT', 'Content-Length': String(Buffer.byteLength(css)) } });
    } } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), country === 'CN' ? css.replace("url('/images/sakura-classroom.png')", "url('https://mirror.qlzx.qzz.io/https://school.example/images/sakura-classroom.png')") : css);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    for (const name of ['ETag', 'Last-Modified', 'Content-Length']) assert.equal(response.headers.get(name), null);
    assert.match(response.headers.get('Content-Type'), /text\/css/);
    const csp = response.headers.get('Content-Security-Policy');
    assert.match(csp, /img-src 'self' data: https:\/\/mirror\.qlzx\.qzz\.io;/);
    assert.match(csp, /script-src 'self'; style-src 'self';/);
    assert.match(csp, /connect-src 'self';/);
  }
});

test('Regional stylesheet preserves HEAD, errors, raw artwork and unsupported method handling', async () => {
  for (const [path, method, status, body] of [
    ['/theme.css', 'HEAD', 200, null], ['/theme.css', 'GET', 404, 'Not found'],
    ['/images/sakura-classroom.png', 'GET', 200, readFileSync('public/images/sakura-classroom.png')]
  ]) {
    const request = new Request('https://school.example' + path, { method });
    request.cf = { country: 'CN' };
    const response = await worker.fetch(request, { ASSETS: { fetch: async () => new Response(body, { status }) } });
    assert.equal(response.status, status);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(body || ''));
  }
  assert.equal((await worker.fetch(new Request('https://school.example/theme.css', { method: 'POST' }), {})).status, 405);
});

test('CSV supports BOM, escaped quotes, commas, CRLF and quoted multiline names', () => {
  const data = parseCSV('\ufeffreal_name,class_name,student_code,teacher_name\r\n"李""明","三年级,一班",A8vZ7nQp9t,陈老师\r\n');
  assert.equal(data[0].real_name, '李"明'); assert.equal(data[0].class_name, '三年级,一班');
});

test('CSV export quotes delimiters and multiline values, includes BOM, and neutralizes spreadsheet formulas', () => {
  assert.equal(encodeCSV([['姓名', '班级'], ['李"明', '一班,二组\n新校']]), '\ufeff"姓名","班级"\r\n"李""明","一班,二组\n新校"\r\n');
  for (const value of ['=1+1', '+SUM(A1)', '-1+1', '@SUM(A1)', '  =1+1', '\t123', '\r123', '\n123']) assert.ok(encodeCSV([[value]]).startsWith('\ufeff"\''));
});

test('Exportable codes use authenticated encryption with fresh IVs and are bound to their verification hash', async () => {
  const secret = 'a'.repeat(32), code = '私人邀请码0123456789', hash = await keyedHash(secret, `student-code:${code}`);
  const a = await encryptCode(secret, code, hash), b = await encryptCode(secret, code, hash);
  assert.notEqual(a, b); assert.ok(!a.includes(code));
  assert.equal(await decryptCode(secret, a, hash), code);
  await assert.rejects(() => decryptCode('b'.repeat(32), a, hash));
  await assert.rejects(() => decryptCode(secret, a, 'other-student-code-hash'));
  const [iv, encrypted] = a.split(':');
  await assert.rejects(() => decryptCode(secret, `${iv}:${encrypted[0] === '0' ? '1' : '0'}${encrypted.slice(1)}`, hash));
});
test('CSV rejects malformed, duplicate, incomplete and oversized imports', () => {
  for (const csv of ['name,class\n李明,一班', 'real_name,class_name,student_code\n李明,一班,short', 'real_name,class_name,student_code\n"李明,一班,abcdefghi', 'real_name,class_name,student_code\n李明,一班,abcdefghi\n李明,一班,abcdefghj', 'real_name,class_name,student_code\n李明,一班,abcdefghi,extra', 'real_name,class_name,student_code\n"李明"x,一班,abcdefghi']) assert.throws(() => parseCSV(csv));
  assert.throws(() => parseCSV('real_name,class_name,student_code\n' + Array.from({length:201}, (_,i)=>`学生${i},一班,abcdefgh${i}`).join('\n')));
});
test('Password hashing uses fresh salt and validates without storing plaintext', async () => {
  const a = await passwordHash('a-secure-password-2026'), b = await passwordHash('a-secure-password-2026');
  assert.notEqual(a,b); assert.ok(await passwordMatches('a-secure-password-2026',a)); assert.equal(await passwordMatches('incorrect',a), false);
  assert.equal(equal('a','aa'),false); assert.equal(equal('ab','ab'),true);
});
test('Student code hashes depend on private secret, random tokens have 256 bits', async () => {
  assert.match(token(), /^[a-f0-9]{64}$/);
  assert.notEqual(await keyedHash('a'.repeat(32),'code'), await keyedHash('b'.repeat(32),'code'));
  assert.equal((await digest('credential')).length,64);
});
test('Mutations reject absent or cross-site Origin', () => {
  assert.throws(() => checkOrigin(new Request('https://school.example/api/messages')));
  assert.throws(() => checkOrigin(new Request('https://school.example/api/messages',{headers:{Origin:'https://evil.example'}})));
  checkOrigin(new Request('https://school.example/api/messages',{headers:{Origin:'https://school.example'}}));
});
test('Moderator role cannot manage roster; missing CSRF and expired sessions fail', async () => {
  const request = new Request('https://school.example/api/admin/students',{method:'POST',headers:{Cookie:`admin_session=${'a'.repeat(64)}`}});
  const env = {DB:{prepare:()=>({bind:()=>({first:async()=>({id:1,role:'moderator',csrf_token:'x'})})})}};
  await assert.rejects(()=>adminAuth(request,env,true), e=>e.status===403);
  await assert.rejects(()=>adminAuth(request,env,false), e=>e.status===403);
  env.DB.prepare = ()=>({bind:()=>({first:async()=>null})});
  await assert.rejects(()=>adminAuth(request,env), e=>e.status===401);
});
test('Heart rows preserve every message in stable order with balanced lobes and a tapered tip', () => {
  for (const count of [0,1,2,3,4,5,7,12,24,30,44,100,250,1000]) for (const columns of [1,2,3,4,6,8]) {
    const rows = heartRows(count, columns); assert.deepEqual(rows, heartRows(count, columns));
    assert.deepEqual(rows.flat(), Array.from({length: count}, (_, i) => i));
    assert.ok(rows.every(row => row.length >= 1 && row.length <= columns));
    if (count > 2 && columns > 1) { assert.equal(rows[0].length % 2, 0); assert.equal(rows.at(-1).length, 1); }
  }
  assert.deepEqual(heartRows(11, 4).map(row => row.length), [2, 4, 4, 1]);
  assert.deepEqual(heartRows(24, 8).map(row => row.length), [4, 8, 8, 3, 1]);
  assert.deepEqual(heartRows(30, 8).map(row => row.length), [4, 8, 8, 6, 3, 1]);
});
test('Names are masked by default; input limits count Unicode codepoints', () => {
  assert.equal(displayName('张小明','masked'),'张同学'); assert.equal(displayName('张小明','anonymous'),'一位同学'); assert.equal(displayName('张小明','full'),'张小明');
  assert.throws(()=>str('x\u0000','content')); assert.throws(()=>str({},'name')); assert.equal(str('  谢谢老师  ','content'),'谢谢老师');
});
test('Rate limit rejects at threshold and uses a bound hashed bucket', async () => {
  let hits=0, binding;
  const env={AUTH_SECRET:'a'.repeat(32),DB:{prepare:sql=>{assert.match(sql,/ON CONFLICT/);return{bind:(...args)=>{binding=args;return{first:async()=>({hits:++hits})};}}}}};
  const request=new Request('https://school.example/api/site',{headers:{'CF-Connecting-IP':'203.0.113.10'}});
  await rateLimit(request,env,'test',1,60); await assert.rejects(()=>rateLimit(request,env,'test',1,60),e=>e.status===429);
  assert.ok(!binding[0].includes('203.0.113.10')); assert.match(binding[0],/^[a-f0-9]{64}:\d+$/);
});
