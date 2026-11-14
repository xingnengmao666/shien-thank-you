import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { decryptCode, digest, keyedHash, token } from '../src/security.js';

async function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_initial.sql', '0002_code_claims.sql', '0003_codeget_logs.sql', '0004_exportable_codes.sql']) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const DB = {
    prepare(sql) {
      const statement = { sql, args: [], bind(...args) { this.args = args; return this; },
        async first() { return sqlite.prepare(sql).get(...this.args) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.args) }; } };
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(s => {
          const results = sqlite.prepare(s.sql).all(...s.args);
          return { results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n, last_row_id: sqlite.prepare('SELECT last_insert_rowid() AS id').get().id } };
        });
        sqlite.exec('COMMIT'); return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  const env = { DB, AUTH_SECRET: 'a'.repeat(32), ASSETS: { fetch: async () => new Response('领取寄语验证码') } };
  const oldCode = 'original-private-code', hash = await keyedHash(env.AUTH_SECRET, `student-code:${oldCode}`);
  sqlite.exec("INSERT INTO classes (class_name) VALUES ('测试一班'), ('测试二班')");
  for (let i = 1; i <= 5; i++) sqlite.prepare('INSERT INTO students (real_name, class_id, student_code) VALUES (?, 1, ?)').run(`测试学生${i}`, hash);
  const request = async (path, data, headers = {}, method = data === undefined ? 'GET' : 'POST') => {
    const response = await worker.fetch(new Request(`https://school.example${path}`, {
      method, headers: { Origin: 'https://school.example', 'Content-Type': 'application/json', ...headers },
      body: data === undefined ? undefined : JSON.stringify(data)
    }), env);
    return { response, status: response.status, data: (response.headers.get('Content-Type') || '').includes('json') ? await response.json() : await response.text() };
  };
  const signals = (ip = '203.0.113.1', device = token()) => ({ 'CF-Connecting-IP': ip, Cookie: `__Host-codeget_device=${device}` });
  const claim = (name, fingerprint, headers) => request('/api/student/codeget', { real_name: name, fingerprint }, headers);
  const admin = async (role = 'owner') => {
    const raw = token(), csrf = token();
    const id = sqlite.prepare('INSERT INTO admins (username, password_hash, role) VALUES (?, ?, ?) RETURNING id').get(raw, 'unused', role).id;
    sqlite.prepare('INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(await digest(raw), id, csrf, Math.floor(Date.now() / 1000) + 3600);
    return { Cookie: `admin_session=${raw}`, 'X-CSRF-Token': csrf };
  };
  return { sqlite, env, request, signals, claim, oldCode, hash, admin };
}

test('Code page sets a private secure device cookie on every supported URL', async () => {
  const f = await fixture();
  try {
    for (const path of ['/codeget', '/codeget/', '/codeget.html']) {
      const page = await f.request(path);
      assert.equal(page.status, 200); assert.equal(page.response.headers.get('Cache-Control'), 'no-store');
      assert.match(page.response.headers.get('Set-Cookie'), /^__Host-codeget_device=[a-f0-9]{64}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
    }
    const page = await f.request('/codeget', undefined, f.signals());
    assert.equal(page.response.headers.get('Set-Cookie'), null);
  } finally { f.sqlite.close(); }
});

test('Claiming rotates the code, revokes old sessions, hashes limiter identifiers and keeps existing verification usable', async () => {
  const f = await fixture(), headers = f.signals(), fingerprint = token();
  try {
    const verified = await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: f.oldCode });
    assert.equal(verified.status, 200);
    const claim = await f.claim(' 测试学生1 ', fingerprint, headers);
    assert.equal(claim.status, 201); assert.match(claim.data.student_code, /^[a-f0-9]{32}$/); assert.equal(claim.data.class_id, 1);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM student_sessions').get().n, 0);
    const saved = f.sqlite.prepare('SELECT * FROM code_claims').get();
    assert.equal(saved.student_id, 1);
    for (const key of ['ip_hash', 'fingerprint_hash', 'device_hash']) assert.match(saved[key], /^[a-f0-9]{64}$/);
    assert.equal(saved.ip_hash, await keyedHash(f.env.AUTH_SECRET, 'codeget-ip:203.0.113.1'));
    assert.equal(saved.fingerprint_hash, await keyedHash(f.env.AUTH_SECRET, `codeget-fingerprint:${fingerprint}`));
    assert.ok(!JSON.stringify(saved).includes(claim.data.student_code));
    const log = f.sqlite.prepare('SELECT * FROM codeget_logs').get();
    assert.equal(log.claim_id, saved.id); assert.equal(log.outcome, 'issued'); assert.equal(log.http_status, 201);
    assert.equal(log.real_name, '测试学生1'); assert.equal(log.class_name, '测试一班');
    assert.equal(log.ip_address, '203.0.113.1'); assert.equal(log.fingerprint, fingerprint); assert.equal(log.device_hash, saved.device_hash);
    assert.ok(!JSON.stringify(log).includes(headers.Cookie.split('=')[1]));
    assert.ok(!JSON.stringify(log).includes(claim.data.student_code));
    assert.equal((await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: f.oldCode })).status, 401);
    const current = await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: claim.data.student_code });
    assert.equal(current.status, 200);
    assert.equal((await f.request('/api/messages', { content: '谢谢老师一直以来耐心地教导我们。' }, { Authorization: `Bearer ${current.data.credential}` })).status, 201);
  } finally { f.sqlite.close(); }
});

test('Student, IP, fingerprint and cookie each independently block duplicate and concurrent claims', async t => {
  for (const same of ['student', 'ip', 'fingerprint', 'device']) await t.test(same, async () => {
    const f = await fixture(), device = token(), fingerprint = token();
    try {
      const results = await Promise.all([
        f.claim('测试学生1', fingerprint, f.signals('203.0.113.1', device)),
        f.claim(same === 'student' ? '测试学生1' : '测试学生2', same === 'fingerprint' ? fingerprint : token(), f.signals(same === 'ip' ? '203.0.113.1' : '203.0.113.2', same === 'device' ? device : token()))
      ]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 1);
      const outcomes = f.sqlite.prepare('SELECT outcome FROM codeget_logs ORDER BY outcome').all().map(r => r.outcome);
      assert.deepEqual(outcomes, ['issued', 'rejected']);
      const winner = results.find(r => r.status === 201).data;
      assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE real_name = ?').get(winner.real_name).student_code, await keyedHash(f.env.AUTH_SECRET, `student-code:${winner.student_code}`));
      assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM students WHERE student_code = ?').get(f.hash).n, 4);
      assert.equal((await f.claim('测试学生3', token(), f.signals('203.0.113.3'))).status, 201);
    } finally { f.sqlite.close(); }
  });
});

test('Missing cookie, bad fingerprint, cross-site requests, unknown names and closed submissions issue nothing', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.claim('测试学生1', token(), {})).status, 403);
    assert.equal((await f.claim('测试学生1', 'fake', f.signals())).status, 400);
    assert.equal((await f.claim('测试学生1', token(), { ...f.signals(), Origin: 'https://evil.example' })).status, 403);
    assert.equal((await f.claim('不在名单中的姓名', token(), f.signals())).status, 404);
    f.sqlite.exec('UPDATE settings SET submissions_open = 0 WHERE id = 1');
    assert.equal((await f.claim('测试学生1', token(), f.signals())).status, 403);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE id = 1').get().student_code, f.hash);
    const logs = f.sqlite.prepare('SELECT * FROM codeget_logs ORDER BY id').all();
    assert.equal(logs.length, 5); assert.ok(logs.every(log => log.outcome === 'rejected'));
    assert.equal(logs[0].device_hash, null); assert.match(logs[0].fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(logs[1].fingerprint, null); assert.match(logs[1].device_hash, /^[a-f0-9]{64}$/);
    assert.equal(logs[2].http_status, 403); assert.equal(logs[3].real_name, '不在名单中的姓名');
  } finally { f.sqlite.close(); }
});

test('Same names require class selection; submitted students cannot claim; deletes retain device limits', async () => {
  const f = await fixture(), headers = f.signals();
  try {
    f.sqlite.prepare('INSERT INTO students (real_name, class_id, student_code) VALUES (?, 2, ?)').run('测试学生1', f.hash);
    const ambiguous = await f.claim('测试学生1', token(), headers);
    assert.equal(ambiguous.status, 200); assert.equal(ambiguous.data.needs_class, true); assert.equal(ambiguous.data.student_code, undefined);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 0);
    const selected = await f.request('/api/student/codeget', { real_name: '测试学生1', fingerprint: token(), class_id: 2 }, headers);
    assert.equal(selected.status, 201); assert.equal(selected.data.class_id, 2);
    f.sqlite.exec("INSERT INTO messages (student_id, content) VALUES (2, '谢谢老师的认真教导与耐心帮助。')");
    assert.equal((await f.claim('测试学生2', token(), f.signals('203.0.113.2'))).status, 409);
    f.sqlite.exec('DELETE FROM students WHERE class_id = 2');
    const savedLog = f.sqlite.prepare("SELECT * FROM codeget_logs WHERE outcome = 'issued'").get();
    assert.equal(savedLog.student_id, null); assert.equal(savedLog.real_name, '测试学生1'); assert.equal(savedLog.class_name, '测试二班');
    assert.equal(f.sqlite.prepare('SELECT student_id FROM code_claims').get().student_id, null);
    assert.equal((await f.claim('测试学生3', token(), headers)).status, 409);
  } finally { f.sqlite.close(); }
});

test('Forwarded headers do not override the trusted Cloudflare IP; claim attempts are rate limited', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.claim('测试学生1', token(), { Cookie: f.signals().Cookie, 'X-Forwarded-For': '1.1.1.1' })).status, 201);
    assert.equal((await f.claim('测试学生2', token(), { Cookie: f.signals().Cookie, 'X-Forwarded-For': '2.2.2.2' })).status, 409);
    for (let i = 0; i < 10; i++) assert.equal((await f.claim('不存在的姓名', token(), f.signals('203.0.113.20'))).status, 404);
    assert.equal((await f.claim('测试学生3', token(), f.signals('203.0.113.20'))).status, 429);
    const limited = f.sqlite.prepare('SELECT * FROM codeget_logs WHERE http_status = 429').get();
    assert.equal(limited.outcome, 'rejected'); assert.equal(limited.real_name, '测试学生3'); assert.equal(limited.ip_address, '203.0.113.20');
    assert.match(limited.fingerprint, /^[a-f0-9]{64}$/); assert.match(limited.device_hash, /^[a-f0-9]{64}$/);
  } finally { f.sqlite.close(); }
});

test('A setting change before the transaction leaves the old code intact; an old-code verification race creates no session', async () => {
  const f = await fixture(), originalBatch = f.env.DB.batch;
  try {
    f.env.DB.batch = statements => {
      f.sqlite.exec('UPDATE settings SET submissions_open = 0 WHERE id = 1');
      return originalBatch(statements);
    };
    assert.equal((await f.claim('测试学生1', token(), f.signals())).status, 409);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE id = 1').get().student_code, f.hash);
    f.env.DB.batch = statements => {
      f.sqlite.prepare('UPDATE students SET student_code = ? WHERE id = 1').run('replaced-hash');
      return originalBatch(statements);
    };
    assert.equal((await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: f.oldCode })).status, 401);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM student_sessions').get().n, 0);
  } finally { f.sqlite.close(); }
});

test('A failed code update rolls back the claim and preserves the original session', async () => {
  const f = await fixture();
  try {
    await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: f.oldCode });
    f.sqlite.exec("CREATE TRIGGER fail_update BEFORE UPDATE OF student_code ON students BEGIN SELECT RAISE(ABORT, 'test update failure'); END");
    const result = await f.claim('测试学生1', token(), f.signals());
    assert.equal(result.status, 500); assert.equal(result.data.student_code, undefined);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE id = 1').get().student_code, f.hash);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM student_sessions').get().n, 1);
    assert.equal(f.sqlite.prepare('SELECT outcome FROM codeget_logs').get().outcome, 'error');
  } finally { f.sqlite.close(); }
});

test('Success logging is atomic with issuing the code; log failure rolls back the entire claim', async () => {
  const f = await fixture();
  try {
    f.sqlite.exec("CREATE TRIGGER fail_success_log BEFORE INSERT ON codeget_logs WHEN NEW.outcome = 'issued' BEGIN SELECT RAISE(ABORT, 'test log failure'); END");
    assert.equal((await f.claim('测试学生1', token(), f.signals())).status, 500);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE id = 1').get().student_code, f.hash);
    const log = f.sqlite.prepare('SELECT * FROM codeget_logs').get();
    assert.equal(log.outcome, 'error'); assert.equal(log.claim_id, null);
  } finally { f.sqlite.close(); }
});

test('Malformed requests still leave the available source identifiers and no plaintext credentials', async () => {
  const f = await fixture(), headers = f.signals();
  try {
    assert.equal((await f.request('/api/student/codeget', {}, { ...headers, 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.request('/api/student/codeget', {}, headers)).status, 400);
    const logs = f.sqlite.prepare('SELECT * FROM codeget_logs').all();
    assert.equal(logs.length, 2); assert.ok(logs.every(log => log.ip_address === '203.0.113.1' && log.device_hash && log.fingerprint === null));
    assert.ok(!JSON.stringify(logs).includes(headers.Cookie.split('=')[1]));
  } finally { f.sqlite.close(); }
});

test('Only the owner can query traces; filtering, pagination and public privacy are enforced', async () => {
  const f = await fixture();
  try {
    await f.claim('测试学生1', token(), f.signals());
    await f.claim('不存在姓名', token(), f.signals('203.0.113.2'));
    const owner = token(), moderator = token();
    for (const [id, role, raw] of [[1, 'owner', owner], [2, 'moderator', moderator]]) {
      f.sqlite.prepare('INSERT INTO admins (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(id, role, 'unused', role);
      f.sqlite.prepare('INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').run(await digest(raw), id, token(), Math.floor(Date.now() / 1000) + 3600);
    }
    assert.equal((await f.request('/api/admin/codeget-logs')).status, 401);
    assert.equal((await f.request('/api/admin/codeget-logs', undefined, { Cookie: `admin_session=${moderator}` })).status, 403);
    const ownerHeaders = { Cookie: `admin_session=${owner}` };
    const filtered = await f.request(`/api/admin/codeget-logs?outcome=issued&ip=203.0.113.1&name=${encodeURIComponent('测试学生')}`, undefined, ownerHeaders);
    assert.equal(filtered.status, 200); assert.equal(filtered.data.total, 1); assert.equal(filtered.data.items[0].real_name, '测试学生1');
    assert.equal(filtered.data.items[0].ip_address, '203.0.113.1'); assert.match(filtered.data.items[0].fingerprint, /^[a-f0-9]{64}$/);
    const paged = await f.request('/api/admin/codeget-logs?page=2&page_size=1&sort=asc', undefined, ownerHeaders);
    assert.equal(paged.data.total, 2); assert.equal(paged.data.items.length, 1); assert.equal(paged.data.items[0].outcome, 'rejected');
    assert.equal((await f.request('/api/admin/codeget-logs?outcome=bad', undefined, ownerHeaders)).status, 400);
    assert.equal((await f.request('/api/admin/codeget-logs?sort=bad', undefined, ownerHeaders)).status, 400);
    assert.equal((await f.request('/api/codeget-logs')).status, 404);
    assert.equal((await f.request('/api/site')).data.codeget_logs, undefined);
  } finally { f.sqlite.close(); }
});

test('Historical success records are backfilled with hashes without inventing unavailable IPs or fingerprints', async () => {
  const f = await fixture();
  try {
    await f.claim('测试学生1', token(), f.signals());
    const claim = f.sqlite.prepare('SELECT * FROM code_claims').get();
    f.sqlite.exec('DROP TABLE codeget_logs');
    f.sqlite.exec(readFileSync('migrations/0003_codeget_logs.sql', 'utf8'));
    const log = f.sqlite.prepare('SELECT * FROM codeget_logs').get();
    assert.equal(log.claim_id, claim.id); assert.equal(log.created_at, claim.created_at);
    assert.equal(log.real_name, '测试学生1'); assert.equal(log.ip_address, null); assert.equal(log.fingerprint, null);
    assert.equal(log.ip_hash, claim.ip_hash); assert.equal(log.fingerprint_hash, claim.fingerprint_hash); assert.equal(log.device_hash, claim.device_hash);
    assert.match(log.reason, /历史成功领取/);
  } finally { f.sqlite.close(); }
});

test('Reset releases only the selected claim, retains history and code, and permits reissue on the same device and IP', async () => {
  const f = await fixture(), headers = f.signals(), fingerprint = token();
  try {
    const owner = await f.admin();
    const first = await f.claim('测试学生1', fingerprint, headers);
    const other = await f.claim('测试学生2', token(), f.signals('203.0.113.2'));
    assert.equal(first.status, 201); assert.equal(other.status, 201);
    assert.equal((await f.claim('测试学生1', fingerprint, headers)).status, 409);
    assert.equal((await f.request('/api/admin/students/1/reset-code-claims', {}, owner)).status, 200);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims WHERE student_id = 1').get().n, 0);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims WHERE student_id = 2').get().n, 1);
    const history = f.sqlite.prepare("SELECT * FROM codeget_logs WHERE student_id = 1 AND outcome = 'issued'").get();
    assert.equal(history.claim_id, null); assert.equal(history.real_name, '测试学生1'); assert.equal(history.ip_address, '203.0.113.1');
    assert.equal(f.sqlite.prepare('SELECT student_code FROM students WHERE id = 1').get().student_code, await keyedHash(f.env.AUTH_SECRET, `student-code:${first.data.student_code}`));
    const next = await f.claim('测试学生1', fingerprint, headers);
    assert.equal(next.status, 201); assert.notEqual(next.data.student_code, first.data.student_code);
    assert.equal((await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: first.data.student_code })).status, 401);
    assert.equal((await f.request('/api/student/verify', { real_name: '测试学生1', class_id: 1, student_code: next.data.student_code })).status, 200);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'reset_code_claims' AND target_id = '1'").get().n, 1);
    const roster = await f.request('/api/admin/students', undefined, owner);
    assert.equal(roster.data.items.find(s => s.id === 1).claim_count, 1);
    assert.ok(roster.data.items.every(s => !('student_code' in s) && !('student_code_encrypted' in s)));
    const exported = await f.request('/api/admin/students/export?name=' + encodeURIComponent('测试学生1'), undefined, owner);
    assert.ok(exported.data.includes(next.data.student_code)); assert.ok(!exported.data.includes(first.data.student_code));
  } finally { f.sqlite.close(); }
});

test('Reset and CSV export enforce owner, CSRF, method and student existence; audit failure rolls back reset', async () => {
  const f = await fixture();
  try {
    const owner = await f.admin(), moderator = await f.admin('moderator');
    await f.claim('测试学生1', token(), f.signals());
    for (const [headers, status] of [[{}, 401], [moderator, 403], [{ Cookie: owner.Cookie }, 403]]) {
      assert.equal((await f.request('/api/admin/students/1/reset-code-claims', {}, headers)).status, status);
    }
    assert.equal((await f.request('/api/admin/students/999/reset-code-claims', {}, owner)).status, 404);
    assert.equal((await f.request('/api/admin/students/1/reset-code-claims', undefined, owner, 'DELETE')).status, 405);
    assert.ok(f.sqlite.prepare('SELECT id FROM students WHERE id = 1').get());
    assert.equal((await f.request('/api/admin/students/export')).status, 401);
    assert.equal((await f.request('/api/admin/students/export', undefined, moderator)).status, 403);
    f.sqlite.exec("CREATE TRIGGER fail_reset_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'reset_code_claims' BEGIN SELECT RAISE(ABORT, 'test reset audit failure'); END");
    assert.equal((await f.request('/api/admin/students/1/reset-code-claims', {}, owner)).status, 500);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM code_claims').get().n, 1);
  } finally { f.sqlite.close(); }
});

test('Reset retains submitted messages and other students network limits', async () => {
  const f = await fixture();
  try {
    const owner = await f.admin(), headers = f.signals();
    await f.claim('测试学生1', token(), headers);
    f.sqlite.exec("INSERT INTO messages (student_id, content) VALUES (1, '谢谢老师的认真教导与耐心帮助。')");
    assert.equal((await f.request('/api/admin/students/1/reset-code-claims', {}, owner)).status, 200);
    assert.equal((await f.claim('测试学生1', token(), headers)).status, 409);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE student_id = 1').get().n, 1);
    await f.claim('测试学生2', token(), f.signals('203.0.113.2'));
    assert.equal((await f.request('/api/admin/students/1/reset-code-claims', {}, owner)).status, 200);
    assert.equal((await f.claim('测试学生3', token(), f.signals('203.0.113.2'))).status, 409);
  } finally { f.sqlite.close(); }
});

test('CSV exports created, imported, edited and claimed codes while marking historical hashes and respecting filters across pages', async () => {
  const f = await fixture();
  try {
    const owner = await f.admin();
    const created = await f.request('/api/admin/students', { real_name: '新增同学', class_id: 2, student_code: 'new-private-code' }, owner);
    assert.equal(created.status, 201);
    const id = created.data.id;
    const initial = f.sqlite.prepare('SELECT * FROM students WHERE id = ?').get(id);
    assert.equal(await decryptCode(f.env.AUTH_SECRET, initial.student_code_encrypted, initial.student_code), 'new-private-code');
    const rows = Array.from({ length: 30 }, (_, i) => `导出学生${i},测试二班,private-code-${i}`);
    assert.equal((await f.request('/api/admin/students/import', { csv: 'real_name,class_name,student_code\n' + rows.join('\n') }, owner)).status, 201);
    assert.equal((await f.request(`/api/admin/students/${id}`, { real_name: '新增同学', class_id: 2, student_code: '' }, owner, 'PUT')).status, 200);
    assert.equal(f.sqlite.prepare('SELECT student_code_encrypted FROM students WHERE id = ?').get(id).student_code_encrypted, initial.student_code_encrypted);
    assert.equal((await f.request(`/api/admin/students/${id}`, { real_name: '新增同学', class_id: 2, student_code: 'edited-private-code' }, owner, 'PUT')).status, 200);
    const exported = await f.request('/api/admin/students/export?class_id=2&page_size=1&page=2', undefined, owner);
    assert.equal(exported.status, 200); assert.match(exported.response.headers.get('Content-Type'), /text\/csv; charset=utf-8/);
    assert.match(exported.response.headers.get('Content-Disposition'), /attachment; filename="invite-codes-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.equal(exported.response.headers.get('Cache-Control'), 'no-store');
    assert.ok(exported.data.includes('edited-private-code')); assert.ok(!exported.data.includes('new-private-code'));
    assert.equal(exported.data.trim().split('\r\n').length, 32);
    for (let i = 0; i < 30; i++) assert.ok(exported.data.includes(`"private-code-${i}"`));
    assert.ok(!exported.data.includes('测试学生1'));
    const historical = await f.request('/api/admin/students/export?class_id=1', undefined, owner);
    assert.ok(historical.data.includes('历史验证码未保存原文')); assert.ok(!historical.data.includes(f.hash)); assert.ok(!historical.data.includes(f.oldCode));
    const empty = await f.request('/api/admin/students/export?submitted=yes', undefined, owner);
    assert.equal(empty.data.trim().split('\r\n').length, 1);
    assert.equal((await f.request('/api/admin/students/export?submitted=invalid', undefined, owner)).status, 400);
    assert.equal((await f.request('/api/admin/students/export?class_id=bad', undefined, owner)).status, 400);
    assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'code_export'").get().n, 3);
  } finally { f.sqlite.close(); }
});
