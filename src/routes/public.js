import { body, displayName, HttpError, id, json, page, sort, str } from '../lib.js';
import { checkOrigin, codeDevice, digest, encryptCode, equal, keyedHash, masterStudentCode, passwordHash, passwordMatches, rateLimit, sessionCookie, studentAuth, token } from '../security.js';

export async function publicRoutes(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/site') {
    await rateLimit(request, env, 'read-site', 120, 60);
    const settings = await env.DB.prepare('SELECT site_title, teacher_name, homepage_copy, submissions_open, name_display FROM settings WHERE id = 1').first();
    const { results: classes } = await env.DB.prepare('SELECT id, class_name FROM classes ORDER BY class_name, id').all();
    return json({ settings, classes });
  }
  if (request.method === 'GET' && path === '/api/messages') {
    await rateLimit(request, env, 'read-messages', 120, 60);
    const p = page(url), order = sort(url, true);
    const settings = await env.DB.prepare('SELECT name_display FROM settings WHERE id = 1').first();
    const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM messages WHERE status = 'approved'").first();
    const { results } = await env.DB.prepare(`SELECT m.id, m.content, m.created_at, m.display_order, s.real_name FROM messages m JOIN students s ON s.id = m.student_id WHERE m.status = 'approved' ORDER BY ${order} LIMIT ? OFFSET ?`).bind(p.page_size, p.offset).all();
    return json({ items: results.map(({ real_name, ...m }) => ({ ...m, display_name: displayName(real_name, settings.name_display) })), total: total.count, page: p.page, page_size: p.page_size });
  }
  if (request.method === 'POST' && path === '/api/student/codeget') {
    const device = codeDevice(request), ipAddress = request.headers.get('CF-Connecting-IP')?.slice(0, 45) || null;
    // shortcut: IP and browser signals can be shared or forged; use verified identity if stronger assurance is needed.
    const [ipHash, deviceHash] = await Promise.all([
      keyedHash(env.AUTH_SECRET, `codeget-ip:${ipAddress || 'local'}`),
      device ? keyedHash(env.AUTH_SECRET, `codeget-device:${device}`) : null
    ]);
    let realName = '', className = '', studentId = null, fingerprint = null, fingerprintHash = null;
    const log = (status, reason, claimId = null) => env.DB.prepare(`INSERT INTO codeget_logs
      (claim_id, student_id, real_name, class_name, ip_address, ip_hash, fingerprint, fingerprint_hash, device_hash, outcome, http_status, reason)
      SELECT ?, (SELECT id FROM students WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ? IS NULL OR EXISTS (SELECT 1 FROM code_claims WHERE id = ?)`)
      .bind(claimId, studentId, realName, className, ipAddress, ipHash, fingerprint, fingerprintHash, deviceHash,
        status === 201 ? 'issued' : status === 200 ? 'needs_class' : status >= 500 ? 'error' : 'rejected', status, reason, claimId, claimId);
    try {
      const data = await body(request, 4096);
      realName = typeof data.real_name === 'string' ? [...data.real_name.normalize('NFC').trim()].slice(0, 80).join('') : '';
      fingerprint = typeof data.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(data.fingerprint) ? data.fingerprint : null;
      if (fingerprint) fingerprintHash = await keyedHash(env.AUTH_SECRET, `codeget-fingerprint:${fingerprint}`);
      checkOrigin(request);
      await rateLimit(request, env, 'codeget', 10);
      const name = str(data.real_name, '真实姓名');
      if (!fingerprint) throw new HttpError(400, '浏览器指纹无效，请使用领取页面。');
      if (!device) throw new HttpError(403, '请允许本站 Cookie，并从领取页面重新进入。');
      const duplicate = '此学生、网络或浏览器已领取过验证码，每人限领取一次。请联系管理员。';
      if (await env.DB.prepare('SELECT id FROM code_claims WHERE ip_hash = ? OR fingerprint_hash = ? OR device_hash = ? LIMIT 1').bind(ipHash, fingerprintHash, deviceHash).first()) throw new HttpError(409, duplicate);
      const settings = await env.DB.prepare('SELECT submissions_open FROM settings WHERE id = 1').first();
      if (!settings.submissions_open) throw new HttpError(403, '寄语提交暂时关闭，暂不能领取验证码。');
      const classId = data.class_id === undefined ? null : id(data.class_id);
      const { results: students } = await env.DB.prepare('SELECT s.id, s.real_name, s.class_id, s.student_code, c.class_name FROM students s JOIN classes c ON c.id = s.class_id WHERE s.real_name = ? AND (? IS NULL OR s.class_id = ?) LIMIT 2').bind(name, classId, classId).all();
      if (!students.length) throw new HttpError(404, '姓名未匹配到学生名单，请核对本名或联系管理员。');
      if (students.length > 1) {
        const message = '名单中有同名同学，请选择所属班级后领取。';
        await env.DB.batch([log(200, message)]);
        return json({ needs_class: true, message });
      }
      const student = students[0];
      studentId = student.id; className = student.class_name;
      if (await env.DB.prepare('SELECT id FROM code_claims WHERE student_id = ?').bind(student.id).first()) throw new HttpError(409, duplicate);
      if (await env.DB.prepare('SELECT id FROM messages WHERE student_id = ?').bind(student.id).first()) throw new HttpError(409, '你已经提交过寄语，无需再领取验证码。');
      const code = token().slice(0, 32), claimId = token(), hash = await keyedHash(env.AUTH_SECRET, `student-code:${code}`);
      const encrypted = await encryptCode(env.AUTH_SECRET, code, hash);
      try {
        const results = await env.DB.batch([
          env.DB.prepare(`INSERT INTO code_claims (id, student_id, ip_hash, fingerprint_hash, device_hash)
            SELECT ?, id, ?, ?, ? FROM students WHERE id = ? AND real_name = ? AND class_id = ? AND student_code = ?
            AND (SELECT submissions_open FROM settings WHERE id = 1) = 1
            AND NOT EXISTS (SELECT 1 FROM messages WHERE student_id = students.id)`)
            .bind(claimId, ipHash, fingerprintHash, deviceHash, student.id, name, student.class_id, student.student_code),
          env.DB.prepare("UPDATE students SET student_code = ?, student_code_encrypted = ?, verification_status = 'unverified' WHERE id = ? AND EXISTS (SELECT 1 FROM code_claims WHERE id = ?)").bind(hash, encrypted, student.id, claimId),
          env.DB.prepare('DELETE FROM student_sessions WHERE student_id = ? AND EXISTS (SELECT 1 FROM code_claims WHERE id = ?)').bind(student.id, claimId),
          log(201, '领取成功。', claimId)
        ]);
        if (!results[0].meta.changes) throw new HttpError(409, '参与状态已变化，本次未领取，请刷新后重试。');
      } catch (error) {
        if (String(error).includes('UNIQUE constraint failed')) throw new HttpError(409, duplicate);
        throw error;
      }
      return json({ student_code: code, real_name: name, class_id: student.class_id, class_name: student.class_name }, 201);
    } catch (error) {
      await env.DB.batch([log(error instanceof HttpError ? error.status : 500,
        error instanceof HttpError ? error.message : '服务暂时不可用，本次领取未完成。')]);
      throw error;
    }
  }
  if (request.method === 'POST' && path === '/api/student/verify') {
    let data;
    try { data = await body(request); }
    catch (error) { await rateLimit(request, env, 'verify', 15); throw error; }
    const masterCode = masterStudentCode(env), master = masterCode !== null && equal(data.student_code, masterCode);
    if (!master) await rateLimit(request, env, 'verify', 15);
    const name = str(data.real_name, '姓名'), classId = id(data.class_id), code = str(data.student_code, '专属验证码', 8, 128);
    const student = await env.DB.prepare('SELECT id, student_code FROM students WHERE class_id = ? AND real_name = ?').bind(classId, name).first();
    const hash = await keyedHash(env.AUTH_SECRET, `student-code:${code}`);
    if (!student || !master && !equal(student.student_code, hash)) throw new HttpError(401, '姓名、班级或专属验证码不匹配，请核对或联系管理员。');
    const existing = await env.DB.prepare('SELECT status FROM messages WHERE student_id = ?').bind(student.id).first();
    let raw = token();
    if (master) raw += `.${await keyedHash(masterCode, `master-student-session:${raw}`)}`;
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE students SET verification_status = 'verified' WHERE id = ? AND student_code = ?").bind(student.id, student.student_code),
      env.DB.prepare('INSERT INTO student_sessions (token_hash, student_id, expires_at) SELECT ?, id, ? FROM students WHERE id = ? AND student_code = ?').bind(await digest(raw), expires, student.id, student.student_code)
    ]);
    if (!results[1].meta.changes) throw new HttpError(401, '验证码已变更，请使用最新验证码重新验证。');
    return json({ verified: true, credential: raw, expires_at: expires, submission_status: existing?.status || null });
  }
  if (request.method === 'POST' && path === '/api/messages') {
    const student = await studentAuth(request, env).catch(async error => {
      await rateLimit(request, env, 'submit', 10); throw error;
    });
    if (!student.bypassRateLimit) await rateLimit(request, env, 'submit', 10);
    const studentId = student.studentId, data = await body(request);
    const content = str(data.content, '感谢内容', 10, 1000);
    const settings = await env.DB.prepare('SELECT submissions_open FROM settings WHERE id = 1').first();
    if (!settings.submissions_open) throw new HttpError(403, '留言提交暂时关闭，请稍后再来。');
    try {
      const inserted = await env.DB.prepare("INSERT INTO messages (student_id, content) SELECT ?, ? WHERE (SELECT submissions_open FROM settings WHERE id = 1) = 1 RETURNING id").bind(studentId, content).first();
      if (!inserted) throw new HttpError(403, '留言提交暂时关闭。');
      return json({ message: '感谢您的真诚表达！留言已提交，等待管理员审核。', status: 'pending' }, 201);
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) throw new HttpError(409, '你已经提交过留言，请等待审核。');
      throw error;
    }
  }
  if (request.method === 'POST' && path === '/api/admin/bootstrap') {
    await rateLimit(request, env, 'bootstrap', 5);
    if (!env.BOOTSTRAP_TOKEN || !equal(request.headers.get('X-Bootstrap-Token'), env.BOOTSTRAP_TOKEN)) throw new HttpError(403, '初始化口令无效。');
    const data = await body(request), username = str(data.username, '用户名', 3, 64), password = str(data.password, '密码', 12, 128);
    const hash = await passwordHash(password);
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO admins (username, password_hash, role) SELECT ?, ?, 'owner' WHERE NOT EXISTS (SELECT 1 FROM admins)").bind(username, hash),
      env.DB.prepare("INSERT INTO audit_logs (admin_id, action, target_type, target_id) SELECT id, 'bootstrap', 'admin', CAST(id AS TEXT) FROM admins WHERE username = ? AND password_hash = ? AND changes() = 1").bind(username, hash)
    ]);
    if (!results[0].meta.changes) throw new HttpError(409, '管理员已初始化，不能重复创建。');
    return json({ message: '管理员已创建，请登录。' }, 201);
  }
  if (request.method === 'POST' && path === '/api/admin/login') {
    await rateLimit(request, env, 'login', 10);
    const data = await body(request), username = str(data.username, '用户名', 3, 64), password = str(data.password, '密码', 1, 128);
    const admin = await env.DB.prepare('SELECT id, username, password_hash, role FROM admins WHERE username = ?').bind(username).first();
    // Equalize the password work even when the username does not exist.
    const fallback = `pbkdf2-sha256$100000$${'0'.repeat(64)}$${'0'.repeat(64)}`;
    const valid = await passwordMatches(password, admin?.password_hash || fallback);
    if (!admin || !valid) throw new HttpError(401, '用户名或密码错误。');
    const raw = token(), csrf = token();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO admin_sessions (token_hash, admin_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)').bind(await digest(raw), admin.id, csrf, Math.floor(Date.now() / 1000) + 28800),
      env.DB.prepare("INSERT INTO audit_logs (admin_id, action, target_type, target_id) VALUES (?, 'login', 'admin', ?)").bind(admin.id, String(admin.id))
    ]);
    return json({ admin: { username: admin.username, role: admin.role }, csrf_token: csrf }, 200, { 'Set-Cookie': sessionCookie(raw) });
  }
  return null;
}
