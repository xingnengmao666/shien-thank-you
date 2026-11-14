import { audit, body, HttpError, id, json, page, sort, str } from '../lib.js';
import { adminAuth, decryptCode, encryptCode, keyedHash, passwordHash, passwordMatches, sessionCookie } from '../security.js';
import { encodeCSV, parseCSV } from '../csv.js';

const statuses = ['pending', 'approved', 'rejected', 'hidden'];
const classStats = `SELECT c.*, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) AS student_count,
  (SELECT COUNT(*) FROM messages m JOIN students s ON s.id = m.student_id WHERE s.class_id = c.id) AS submitted_count,
  (SELECT COUNT(*) FROM messages m JOIN students s ON s.id = m.student_id WHERE s.class_id = c.id AND m.status = 'approved') AS approved_count FROM classes c`;

export async function adminRoutes(request, env, url) {
  if (!url.pathname.startsWith('/api/admin/')) return null;
  const path = url.pathname, method = request.method, db = env.DB;
  const ownerOnly = !/^\/api\/admin\/(me|logout|messages(?:\/|$)|dashboard|password)/.test(path);
  const admin = await adminAuth(request, env, ownerOnly);
  if (method === 'GET' && path === '/api/admin/me') return json({ admin: { username: admin.username, role: admin.role }, csrf_token: admin.csrf_token });
  if (method === 'POST' && path === '/api/admin/logout') {
    await db.batch([db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(admin.token_hash), audit(db, admin, 'logout', 'admin', admin.id)]);
    return json({ message: '已退出登录。' }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (method === 'POST' && path === '/api/admin/password') {
    const data = await body(request), previous = str(data.current_password, '当前密码', 1, 128), next = str(data.new_password, '新密码', 12, 128);
    const saved = await db.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(admin.id).first();
    if (!await passwordMatches(previous, saved.password_hash)) throw new HttpError(401, '当前密码错误。');
    await db.batch([
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(await passwordHash(next), admin.id),
      db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(admin.id),
      audit(db, admin, 'password_change', 'admin', admin.id)
    ]);
    return json({ message: '密码已修改，请重新登录。' }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (method === 'GET' && path === '/api/admin/dashboard') {
    const stats = await db.prepare(`SELECT (SELECT COUNT(*) FROM students) AS students_total, COUNT(*) AS messages_total,
      COALESCE(SUM(status = 'pending'), 0) AS pending, COALESCE(SUM(status = 'approved'), 0) AS approved,
      COALESCE(SUM(status = 'rejected'), 0) AS rejected, COALESCE(SUM(status = 'hidden'), 0) AS hidden,
      COALESCE(SUM(date(created_at, '+8 hours') = date('now', '+8 hours')), 0) AS today FROM messages`).first();
    return json(stats);
  }
  if (method === 'GET' && path === '/api/admin/codeget-logs') {
    const p = page(url), conditions = [], bindings = [];
    const outcome = url.searchParams.get('outcome');
    if (outcome) {
      if (!['issued', 'needs_class', 'rejected', 'error'].includes(outcome)) throw new HttpError(400, '领取结果参数错误。');
      conditions.push('m.outcome = ?'); bindings.push(outcome);
    }
    const name = url.searchParams.get('name'), ip = url.searchParams.get('ip');
    if (name) { conditions.push('instr(m.real_name, ?) > 0'); bindings.push(str(name, '姓名')); }
    if (ip) { conditions.push('m.ip_address = ?'); bindings.push(str(ip, 'IP', 1, 45)); }
    const from = `FROM codeget_logs m ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`;
    const total = await db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...bindings).first();
    const { results } = await db.prepare(`SELECT m.* ${from} ORDER BY ${sort(url)} LIMIT ? OFFSET ?`).bind(...bindings, p.page_size, p.offset).all();
    return json({ items: results, total: total.count, page: p.page, page_size: p.page_size });
  }
  if (method === 'GET' && path === '/api/admin/messages') {
    const p = page(url), conditions = [], bindings = [];
    const status = url.searchParams.get('status');
    if (status) { if (!statuses.includes(status)) throw new HttpError(400, '状态参数错误。'); conditions.push('m.status = ?'); bindings.push(status); }
    const name = url.searchParams.get('name');
    if (name) { conditions.push('instr(s.real_name, ?) > 0'); bindings.push(str(name, '姓名')); }
    const classId = url.searchParams.get('class_id');
    if (classId) { conditions.push('s.class_id = ?'); bindings.push(id(classId)); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM messages m JOIN students s ON s.id = m.student_id JOIN classes c ON c.id = s.class_id ${where}`;
    const count = await db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...bindings).first();
    const { results } = await db.prepare(`SELECT m.*, s.real_name, c.class_name ${from} ORDER BY ${sort(url)} LIMIT ? OFFSET ?`).bind(...bindings, p.page_size, p.offset).all();
    return json({ items: results, total: count.count, page: p.page, page_size: p.page_size });
  }
  const messageRoute = path.match(/^\/api\/admin\/messages\/([1-9]\d*)(?:\/(approve|reject|hide))?$/);
  if (messageRoute) {
    const messageId = id(messageRoute[1]), action = messageRoute[2];
    const existing = await db.prepare('SELECT id, status FROM messages WHERE id = ?').bind(messageId).first();
    if (!existing) throw new HttpError(404, '留言不存在。');
    if (method === 'POST' && action) {
      if (action === 'hide' && existing.status !== 'approved') throw new HttpError(409, '只有已发布留言可以隐藏。');
      const status = { approve: 'approved', reject: 'rejected', hide: 'hidden' }[action];
      await db.batch([
        db.prepare("UPDATE messages SET status = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE id = ?").bind(status, admin.id, messageId),
        audit(db, admin, action, 'message', messageId)
      ]);
      return json({ message: '留言状态已更新。', status });
    }
    if (method === 'DELETE' && !action) {
      await db.batch([db.prepare('DELETE FROM messages WHERE id = ?').bind(messageId), audit(db, admin, 'delete', 'message', messageId)]);
      return json({ message: '留言已删除。' });
    }
  }
  if (method === 'GET' && path === '/api/admin/classes') {
    return json({ items: (await db.prepare(`${classStats} ORDER BY c.class_name, c.id`).all()).results });
  }
  if (method === 'POST' && path === '/api/admin/classes') {
    const data = await body(request), name = str(data.class_name, '班级名称', 1, 120), teacher = str(data.teacher_name || '', '教师姓名', 0, 80);
    const created = await db.batch([
      db.prepare('INSERT INTO classes (class_name, teacher_name) VALUES (?, ?)').bind(name, teacher),
      db.prepare("INSERT INTO audit_logs (admin_id, action, target_type, target_id) SELECT ?, 'create', 'class', CAST(id AS TEXT) FROM classes WHERE class_name = ?").bind(admin.id, name)
    ]);
    return json({ id: created[0].meta.last_row_id, message: '班级已创建。' }, 201);
  }
  const classRoute = path.match(/^\/api\/admin\/classes\/([1-9]\d*)(?:\/(stats))?$/);
  if (classRoute) {
    const classId = id(classRoute[1]), existing = await db.prepare(`${classStats} WHERE c.id = ?`).bind(classId).first();
    if (!existing) throw new HttpError(404, '班级不存在。');
    if (method === 'GET') return json(existing);
    if (method === 'PUT' && !classRoute[2]) {
      const data = await body(request);
      await db.batch([
        db.prepare('UPDATE classes SET class_name = ?, teacher_name = ? WHERE id = ?').bind(str(data.class_name, '班级名称', 1, 120), str(data.teacher_name || '', '教师姓名', 0, 80), classId),
        audit(db, admin, 'update', 'class', classId)
      ]);
      return json({ message: '班级已更新。' });
    }
    if (method === 'DELETE' && !classRoute[2]) {
      if (existing.student_count) throw new HttpError(409, '班级还有学生，请先转移或删除学生。');
      await db.batch([db.prepare('DELETE FROM classes WHERE id = ?').bind(classId), audit(db, admin, 'delete', 'class', classId)]);
      return json({ message: '班级已删除。' });
    }
  }
  if (method === 'GET' && ['/api/admin/students', '/api/admin/students/export'].includes(path)) {
    const p = page(url), conditions = [], args = [];
    if (url.searchParams.get('name')) { conditions.push('instr(s.real_name, ?) > 0'); args.push(str(url.searchParams.get('name'), '姓名')); }
    if (url.searchParams.get('class_id')) { conditions.push('s.class_id = ?'); args.push(id(url.searchParams.get('class_id'))); }
    const submitted = url.searchParams.get('submitted');
    if (submitted) {
      if (!['yes','no'].includes(submitted)) throw new HttpError(400, '提交状态参数错误。');
      conditions.push(submitted === 'yes' ? 'm.id IS NOT NULL' : 'm.id IS NULL');
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN messages m ON m.student_id = s.id ${where}`;
    const claims = '(SELECT COUNT(*) FROM code_claims r WHERE r.student_id = s.id) AS claim_count';
    if (path.endsWith('/export')) {
      const { results } = await db.prepare(`SELECT s.real_name, c.class_name, s.student_code, s.student_code_encrypted, m.status AS submission_status, ${claims} ${from} ORDER BY c.class_name, s.real_name, s.id`).bind(...args).all();
      const rows = await Promise.all(results.map(async student => [student.real_name, student.class_name,
        student.student_code_encrypted ? await decryptCode(env.AUTH_SECRET, student.student_code_encrypted, student.student_code) : '',
        student.claim_count, student.student_code_encrypted ? '可用' : '历史验证码未保存原文，请重新设置', student.submission_status || '未提交']));
      await db.batch([audit(db, admin, 'code_export', 'students', results.length)]);
      const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
      return new Response(encodeCSV([['real_name', 'class_name', 'student_code', 'claim_count', 'code_status', 'submission_status'], ...rows]), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="invite-codes-${date}.csv"` }
      });
    }
    const total = await db.prepare(`SELECT COUNT(*) AS count ${from}`).bind(...args).first();
    const { results } = await db.prepare(`SELECT s.id, s.real_name, s.class_id, s.verification_status, s.created_at, c.class_name, m.status AS submission_status, ${claims} ${from} ORDER BY c.class_name, s.real_name, s.id LIMIT ? OFFSET ?`).bind(...args, p.page_size, p.offset).all();
    return json({ items: results, total: total.count, page: p.page, page_size: p.page_size });
  }
  if (method === 'POST' && path === '/api/admin/students/import') {
    const data = await body(request, 1000000), rows = parseCSV(data.csv);
    const classes = [...new Map(rows.map(s => [s.class_name, s.teacher_name])).entries()];
    const hashes = await Promise.all(rows.map(s => keyedHash(env.AUTH_SECRET, `student-code:${s.student_code}`)));
    const encrypted = await Promise.all(rows.map((s, i) => encryptCode(env.AUTH_SECRET, s.student_code, hashes[i])));
    const statements = [];
    for (let i = 0; i < classes.length; i += 40) {
      const chunk = classes.slice(i, i + 40);
      statements.push(db.prepare(`INSERT INTO classes (class_name, teacher_name) VALUES ${chunk.map(() => '(?, ?)').join(',')} ON CONFLICT(class_name) DO NOTHING`).bind(...chunk.flat()));
    }
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      statements.push(db.prepare(`INSERT INTO students (real_name, class_id, student_code, student_code_encrypted) VALUES ${chunk.map(() => '(?, (SELECT id FROM classes WHERE class_name = ?), ?, ?)').join(',')}`).bind(...chunk.flatMap((s, j) => [s.real_name, s.class_name, hashes[i + j], encrypted[i + j]])));
    }
    statements.push(audit(db, admin, 'csv_import', 'students', rows.length));
    await db.batch(statements);
    return json({ imported: rows.length, message: `已导入 ${rows.length} 名学生。` }, 201);
  }
  if (method === 'POST' && path === '/api/admin/students') {
    const data = await body(request), name = str(data.real_name, '姓名'), classId = id(data.class_id);
    const plain = str(data.student_code, '专属验证码', 8, 128), code = await keyedHash(env.AUTH_SECRET, `student-code:${plain}`);
    const encrypted = await encryptCode(env.AUTH_SECRET, plain, code);
    const inserted = await db.batch([
      db.prepare('INSERT INTO students (real_name, class_id, student_code, student_code_encrypted) VALUES (?, ?, ?, ?)').bind(name, classId, code, encrypted),
      db.prepare("INSERT INTO audit_logs (admin_id, action, target_type, target_id) SELECT ?, 'create', 'student', CAST(id AS TEXT) FROM students WHERE class_id = ? AND real_name = ?").bind(admin.id, classId, name)
    ]);
    return json({ id: inserted[0].meta.last_row_id, message: '学生已添加。' }, 201);
  }
  const studentRoute = path.match(/^\/api\/admin\/students\/([1-9]\d*)(?:\/(reset-code-claims))?$/);
  if (studentRoute) {
    const studentId = id(studentRoute[1]), existing = await db.prepare('SELECT id FROM students WHERE id = ?').bind(studentId).first();
    if (!existing) throw new HttpError(404, '学生不存在。');
    if (method === 'POST' && studentRoute[2] === 'reset-code-claims') {
      await db.batch([
        db.prepare('DELETE FROM code_claims WHERE student_id = ?').bind(studentId),
        audit(db, admin, 'reset_code_claims', 'student', studentId)
      ]);
      return json({ message: '领取次数已重置，历史领码记录已保留。' });
    }
    if (studentRoute[2]) throw new HttpError(405, '不支持该请求方式。');
    if (method === 'PUT') {
      const data = await body(request), name = str(data.real_name, '姓名'), classId = id(data.class_id);
      const plain = data.student_code ? str(data.student_code, '专属验证码', 8, 128) : null;
      const code = plain ? await keyedHash(env.AUTH_SECRET, `student-code:${plain}`) : null;
      const encrypted = plain ? await encryptCode(env.AUTH_SECRET, plain, code) : null;
      await db.batch([
        db.prepare("UPDATE students SET real_name = ?, class_id = ?, student_code = COALESCE(?, student_code), student_code_encrypted = COALESCE(?, student_code_encrypted), verification_status = 'unverified' WHERE id = ?").bind(name, classId, code, encrypted, studentId),
        db.prepare('DELETE FROM student_sessions WHERE student_id = ?').bind(studentId),
        audit(db, admin, 'update', 'student', studentId)
      ]);
      return json({ message: '学生已更新，原身份凭证已失效。' });
    }
    if (method === 'DELETE') {
      if (await db.prepare('SELECT id FROM messages WHERE student_id = ?').bind(studentId).first()) throw new HttpError(409, '该学生已有留言，请先处理并删除留言。');
      await db.batch([db.prepare('DELETE FROM students WHERE id = ?').bind(studentId), audit(db, admin, 'delete', 'student', studentId)]);
      return json({ message: '学生已删除。' });
    }
  }
  if (method === 'GET' && path === '/api/admin/settings') return json(await db.prepare('SELECT * FROM settings WHERE id = 1').first());
  if (method === 'PUT' && path === '/api/admin/settings') {
    const data = await body(request);
    if (!['full','masked','anonymous'].includes(data.name_display) || typeof data.submissions_open !== 'boolean') throw new HttpError(400, '系统设置参数错误。');
    await db.batch([
      db.prepare('UPDATE settings SET site_title = ?, teacher_name = ?, homepage_copy = ?, submissions_open = ?, name_display = ? WHERE id = 1').bind(str(data.site_title, '网站标题', 1, 40), str(data.teacher_name, '教师姓名', 1, 80), str(data.homepage_copy, '首页文案', 1, 500), Number(data.submissions_open), data.name_display),
      audit(db, admin, 'update', 'settings', 1)
    ]);
    return json({ message: '设置已保存。' });
  }
  if (method === 'GET' && path === '/api/admin/audit-logs') {
    const p = page(url), total = await db.prepare('SELECT COUNT(*) AS count FROM audit_logs').first();
    const { results } = await db.prepare('SELECT l.*, a.username FROM audit_logs l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT ? OFFSET ?').bind(p.page_size, p.offset).all();
    return json({ items: results, total: total.count, page: p.page, page_size: p.page_size });
  }
  throw new HttpError(404, '接口不存在。');
}
