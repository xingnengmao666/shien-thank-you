import { conceal, reveal, setBusy, startLoading } from './ui.js';
const $ = selector => document.querySelector(selector);
let csrf = '', currentView = 'dashboard', classList = [], editing = null, pendingConfirmation = null;
const pages = { messages: 1, students: 1, audit: 1, codeget: 1 };
const titles = { dashboard: '概览', messages: '留言审核', students: '学生名单', classes: '班级管理', settings: '系统设置', audit: '操作记录', codeget: '领码记录' };
const statusLabels = { pending: '待审核', approved: '已通过', rejected: '已拒绝', hidden: '已隐藏' };
let noticeTimeout;
function notice(text, error = false) { const el = $('#admin-notice'); el.textContent = text; reveal(el); el.classList.toggle('error-notice', error); clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => conceal(el), 8000); }
async function api(path, options = {}) {
  const finish = startLoading();
  try {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers } });
    const data = response.ok && response.headers.get('Content-Type')?.includes('text/csv') ? await response.blob() : await response.json();
    if (!response.ok) { if (response.status === 401 && !path.endsWith('/login') && !path.endsWith('/password')) showLogin(); throw new Error(data.error || '操作失败，请重试。'); }
    return data;
  } finally { finish(); }
}
const post = (path, data, method = 'POST') => api(path, { method, body: data === undefined ? undefined : JSON.stringify(data) });
function showLogin() { csrf = ''; $('#admin-shell').hidden = true; reveal($('#login-shell')); document.querySelectorAll('dialog[open]').forEach(el => el.close()); }
function element(tag, text, className) { const el = document.createElement(tag); if (text !== undefined && text !== null) el.textContent = text; if (className) el.className = className; return el; }
function cell(...children) { const td = element('td'); children.forEach(child => td.append(typeof child === 'object' ? child : document.createTextNode(String(child ?? '')))); return td; }
function statusTag(status) { return element('span', statusLabels[status] || '未提交', `status-tag status-${status || 'none'}`); }
function date(value) { return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Taipei', hour12: false }); }
function action(label, handler, danger = false) { const button = element('button', label, `small-action${danger ? ' delete-action' : ''}`); button.addEventListener('click', async () => { setBusy(button, true); try { await handler(); } catch (error) { notice(error.message, true); } finally { setBusy(button, false); } }); return button; }
function query(form, currentPage) { const params = new URLSearchParams(); for (const [key, value] of new FormData(form)) if (value) params.set(key, value); params.set('page', currentPage); params.set('page_size', '20'); return params; }
function paginate(view, data) {
  const box = $(`#${view}-pagination`), totalPages = Math.max(1, Math.ceil(data.total / data.page_size)); box.replaceChildren();
  if (pages[view] > totalPages) { pages[view] = totalPages; loadView(); return; }
  const prev = element('button', '上一页', 'secondary'), next = element('button', '下一页', 'secondary'); prev.disabled = data.page <= 1; next.disabled = data.page >= totalPages;
  prev.addEventListener('click', () => { pages[view]--; loadView(); }); next.addEventListener('click', () => { pages[view]++; loadView(); });
  box.append(element('span', `共 ${data.total} 条`), prev, element('span', `${data.page} / ${totalPages}`), next);
}
async function refreshClasses() {
  const data = await api('/api/admin/classes'); classList = data.items;
  document.querySelectorAll('[data-class-select]').forEach(select => { const selected = select.value; select.replaceChildren(new Option('全部班级', ''), ...classList.map(c => new Option(c.class_name, c.id))); select.value = selected; });
}
async function dashboard() {
  const data = await api('/api/admin/dashboard'); $('#pending-badge').textContent = data.pending; $('#stats-grid').replaceChildren();
  for (const [key, label] of [['students_total','学生总人数'],['messages_total','感谢留言总数'],['pending','等待审核'],['approved','审核已通过'],['rejected','审核已拒绝'],['today','今日新增留言']]) {
    const box = element('div', undefined, `stat${key === 'pending' ? ' pending-stat' : ''}`); box.append(element('p', label), element('strong', data[key])); $('#stats-grid').append(box);
  }
}
async function messages() {
  const data = await api(`/api/admin/messages?${query($('#messages-filter'), pages.messages)}`), target = $('#messages-body'); target.replaceChildren(); $('#messages-empty').hidden = data.items.length > 0;
  data.items.forEach(message => {
    const row = element('tr'), author = element('div', message.real_name, 'cell-name'), group = element('div', message.class_name, 'cell-sub');
    const content = cell(message.content); content.className = 'message-cell';
    const actions = element('div', undefined, 'cell-actions');
    if (message.status !== 'approved') actions.append(action('通过', async () => { await post(`/api/admin/messages/${message.id}/approve`); await messages(); await dashboard(); notice('已审核通过，便签将在感谢墙同步。'); }));
    if (message.status !== 'rejected') actions.append(action('拒绝', async () => { await post(`/api/admin/messages/${message.id}/reject`); await messages(); await dashboard(); notice('已拒绝该留言。'); }));
    if (message.status === 'approved') actions.append(action('隐藏', async () => { await post(`/api/admin/messages/${message.id}/hide`); await messages(); await dashboard(); notice('已隐藏该留言。'); }));
    actions.append(action('删除', async () => { if (await confirm('永久删除这条留言？删除后，学生可以重新提交。')) { await post(`/api/admin/messages/${message.id}`, undefined, 'DELETE'); await messages(); await dashboard(); notice('留言已删除。'); } }, true));
    row.append(cell(author, group), content, cell(statusTag(message.status), element('div', date(message.created_at), 'cell-sub')), cell(actions)); target.append(row);
  }); paginate('messages', data);
}
async function students() {
  const data = await api(`/api/admin/students?${query($('#students-filter'), pages.students)}`), target = $('#students-body'); target.replaceChildren(); $('#students-empty').hidden = data.items.length > 0;
  data.items.forEach(student => {
    const row = element('tr'), actions = element('div', undefined, 'cell-actions');
    const reset = action('重置领取次数', async () => {
      if (await confirm(`重置 ${student.class_name} · ${student.real_name} 的邀请码领取次数？将释放该次领取的 IP、浏览器和设备限制，保留历史记录。再次领取会使旧码失效；已有寄语仍不能重新领取。`)) {
        const result = await post(`/api/admin/students/${student.id}/reset-code-claims`); await students(); notice(result.message);
      }
    });
    reset.disabled = student.claim_count === 0; actions.append(reset);
    actions.append(action('编辑', () => editStudent(student)), action('删除', async () => { if (await confirm(`删除 ${student.real_name} 的学生记录？已有留言时需先删除留言。`)) { await post(`/api/admin/students/${student.id}`, undefined, 'DELETE'); await students(); notice('学生已删除。'); } }, true));
    row.append(cell(element('span', student.real_name, 'cell-name')), cell(student.class_name), cell(student.verification_status === 'verified' ? '已核验' : '未核验'), cell(`${student.claim_count} / 1`), cell(statusTag(student.submission_status)), cell(actions)); target.append(row);
  }); paginate('students', data);
}
async function classes() {
  await refreshClasses(); const target = $('#classes-body'); target.replaceChildren(); $('#classes-empty').hidden = classList.length > 0;
  classList.forEach(group => {
    const ratio = group.student_count ? Math.round(group.submitted_count / group.student_count * 100) : 0;
    const row = element('tr'), actions = element('div', undefined, 'cell-actions'), track = element('div', undefined, 'progress-track'), fill = element('div', undefined, 'progress-fill'); fill.style.width = `${ratio}%`; track.append(fill);
    actions.append(action('编辑', () => editClass(group)), action('查看学生', async () => { $('#students-filter').elements.class_id.value = group.id; await switchView('students'); }), action('删除', async () => { if (await confirm(`删除班级“${group.class_name}”？有学生的班级需先转移或删除学生。`)) { await post(`/api/admin/classes/${group.id}`, undefined, 'DELETE'); await classes(); notice('班级已删除。'); } }, true));
    row.append(cell(element('span', group.class_name, 'cell-name')), cell(group.teacher_name || '未设置'), cell(group.student_count), cell(`${group.submitted_count} / ${group.approved_count}`), cell(`${ratio}%`, track), cell(actions)); target.append(row);
  });
}
async function settings() { const data = await api('/api/admin/settings'), form = $('#settings-form'); for (const key of ['site_title','teacher_name','homepage_copy','name_display']) form.elements[key].value = data[key]; form.elements.submissions_open.checked = Boolean(data.submissions_open); }
async function audit() {
  const data = await api(`/api/admin/audit-logs?page=${pages.audit}&page_size=20`), target = $('#audit-body'); target.replaceChildren(); $('#audit-empty').hidden = data.items.length > 0;
  const labels = { bootstrap:'初始化管理员', login:'登录', logout:'退出登录', approve:'审核通过', reject:'拒绝', hide:'隐藏', delete:'删除', create:'创建', update:'更新', csv_import:'导入学生', password_change:'修改密码', reset_code_claims:'重置领取次数', code_export:'导出邀请码' };
  data.items.forEach(item => { const row = element('tr'); row.append(cell(date(item.created_at)), cell(item.username || '已删除账号'), cell(labels[item.action] || item.action), cell(item.target_type), cell(item.target_id)); target.append(row); }); paginate('audit', data);
}
async function codeget() {
  const data = await api(`/api/admin/codeget-logs?${query($('#codeget-filter'), pages.codeget)}`), target = $('#codeget-body');
  target.replaceChildren(); $('#codeget-empty').hidden = data.items.length > 0;
  const labels = { issued: '领取成功', needs_class: '需选择班级', rejected: '领取被拒绝', error: '服务错误' };
  const tones = { issued: 'approved', needs_class: 'pending', rejected: 'rejected', error: 'rejected' };
  for (const item of data.items) {
    const row = element('tr');
    row.append(cell(date(item.created_at)), cell(element('div', item.real_name || '未提供有效姓名', 'cell-name'), element('div', item.class_name || '未确定班级', 'cell-sub')),
      cell(element('span', labels[item.outcome], `status-tag status-${tones[item.outcome]}`), element('div', item.reason, 'trace-reason')),
      cell(element('code', item.ip_address || item.ip_hash, 'trace-value'), element('div', item.ip_address ? 'Cloudflare 来源 IP' : '历史或本地记录：IP HMAC', 'trace-caption')),
      cell(element('code', item.fingerprint || item.fingerprint_hash || '未提供或格式无效', 'trace-value'), element('div', item.fingerprint ? '浏览器 SHA-256 摘要' : item.fingerprint_hash ? '历史指纹 HMAC' : '', 'trace-caption')),
      cell(element('code', item.device_hash || '未提供或格式无效', 'trace-value')));
    target.append(row);
  }
  paginate('codeget', data);
}
const loaders = { dashboard, messages, students, classes, settings, audit, codeget };
async function loadView() {
  const view = $(`#view-${currentView}`);
  view.classList.add('is-region-loading'); view.setAttribute('aria-busy', 'true');
  const button = view.querySelector('.filter-bar > button') || (currentView === 'dashboard' ? $('#refresh-dashboard') : null);
  if (button) setBusy(button, true);
  try { await loaders[currentView](); } catch (error) { notice(error.message, true); }
  finally { view.classList.remove('is-region-loading'); view.removeAttribute('aria-busy'); if (button) setBusy(button, false); }
}
async function switchView(view) { currentView = view; $('#view-title').textContent = titles[view]; document.querySelectorAll('.admin-view').forEach(el => { el.hidden = el.id !== `view-${view}`; }); document.querySelectorAll('.sidebar [data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view)); await loadView(); }
async function start(data) {
  csrf = data.csrf_token; $('#login-shell').hidden = true; reveal($('#admin-shell')); $('#admin-name').textContent = `${data.admin.username} · ${data.admin.role === 'owner' ? '主管理员' : '审核员'}`;
  document.querySelectorAll('[data-owner]').forEach(el => { el.hidden = data.admin.role !== 'owner'; });
  if (data.admin.role === 'owner') await refreshClasses();
  await dashboard(); await switchView('dashboard');
}
$('#login-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); $('#login-status').textContent = '正在登录…'; try { const data = await post('/api/admin/login', Object.fromEntries(new FormData(event.target))); event.target.reset(); await start(data); $('#login-status').textContent = ''; } catch (error) { $('#login-status').textContent = error.message; } finally { setBusy(button, false); } });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('#refresh-dashboard').addEventListener('click', loadView);
$('#logout-button').addEventListener('click', async event => { setBusy(event.currentTarget, true); const button = event.currentTarget; try { await post('/api/admin/logout'); showLogin(); } catch (error) { notice(error.message, true); } finally { setBusy(button, false); } });
for (const name of ['messages','students','codeget']) $(`#${name}-filter`).addEventListener('submit', event => { event.preventDefault(); pages[name] = 1; loadView(); });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
function confirm(text) { $('#confirm-message').textContent = text; $('#confirm-dialog').showModal(); return new Promise(resolve => { pendingConfirmation = resolve; }); }
$('#confirm-yes').addEventListener('click', () => { pendingConfirmation?.(true); pendingConfirmation = null; $('#confirm-dialog').close(); });
$('#confirm-cancel').addEventListener('click', () => $('#confirm-dialog').close());
$('#confirm-dialog').addEventListener('close', () => { pendingConfirmation?.(false); pendingConfirmation = null; });
function edit(title, fields, save, help = '') {
  editing = save; $('#edit-title').textContent = title; $('#edit-help').textContent = help; $('#edit-status').textContent = ''; $('#edit-fields').replaceChildren();
  fields.forEach(field => {
    const label = element('label', field.label); let input;
    if (field.options) { input = element('select'); input.append(new Option('请选择班级', ''), ...field.options.map(c => new Option(c.class_name, c.id))); }
    else { input = element('input'); input.type = field.type || 'text'; input.maxLength = field.max || 80; if (field.min) input.minLength = field.min; if (input.type === 'password') input.autocomplete = 'new-password'; }
    input.name = field.name; input.required = field.required !== false; input.value = field.value ?? ''; label.append(input); $('#edit-fields').append(label);
  }); $('#edit-dialog').showModal();
}
function editStudent(student) {
  if (!classList.length) { notice('请先创建班级。', true); return; }
  edit(student ? '编辑学生' : '添加学生', [{name:'real_name',label:'真实姓名',value:student?.real_name},{name:'class_id',label:'所属班级',value:student?.class_id,options:classList},{name:'student_code',label:student ? '新验证码（留空保留原验证码）' : '专属验证码（至少 8 位）',type:'password',min:8,max:128,required:!student}], async data => { data.class_id = Number(data.class_id); await post(`/api/admin/students${student ? `/${student.id}` : ''}`, data, student ? 'PUT' : 'POST'); await students(); notice(student ? '学生信息已更新。' : '学生已添加。'); }, student ? '保存会使原学生身份凭证失效，学生需重新验证。' : '请将验证码私下发给学生。主管理员可导出邀请码 CSV，请妥善保管。');
}
function editClass(group) { edit(group ? '编辑班级' : '创建班级', [{name:'class_name',label:'班级名称',max:120,value:group?.class_name},{name:'teacher_name',label:'教师姓名',required:false,value:group?.teacher_name}], async data => { await post(`/api/admin/classes${group ? `/${group.id}` : ''}`, data, group ? 'PUT' : 'POST'); await classes(); notice(group ? '班级已更新。' : '班级已创建。'); }); }
$('#add-student').addEventListener('click', () => editStudent()); $('#add-class').addEventListener('click', () => editClass());
$('#export-codes').addEventListener('click', async event => {
  const button = event.currentTarget; setBusy(button, true);
  try {
    const params = query($('#students-filter'), 1); params.delete('page'); params.delete('page_size');
    const blob = await api(`/api/admin/students/export?${params}`), url = URL.createObjectURL(blob);
    const link = element('a'); link.href = url; link.download = `invite-codes-${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' })}.csv`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notice('已导出当前筛选范围内全部学生的邀请码。CSV 含个人信息和邀请码，请妥善保管；历史原文缺失会在表中标明。');
  } catch (error) { notice(error.message, true); }
  finally { setBusy(button, false); }
});
$('#edit-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); try { await editing(Object.fromEntries(new FormData(event.target))); $('#edit-dialog').close(); event.target.reset(); } catch (error) { $('#edit-status').textContent = error.message; } finally { setBusy(button, false); } });
$('#import-button').addEventListener('click', () => { $('#import-status').textContent = ''; $('#import-form').reset(); $('#import-dialog').showModal(); });
$('#import-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); $('#import-status').textContent = '正在检查并导入…'; try { const file = event.target.elements.file.files[0]; if (file.size > 800000) throw new Error('文件过大，请拆分为每批最多 200 人。'); const data = await post('/api/admin/students/import', { csv: await file.text() }); $('#import-dialog').close(); await refreshClasses(); await students(); notice(data.message); } catch (error) { $('#import-status').textContent = error.message; } finally { setBusy(button, false); } });
$('#settings-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); try { const data = Object.fromEntries(new FormData(event.target)); data.submissions_open = event.target.elements.submissions_open.checked; await post('/api/admin/settings', data, 'PUT'); notice('设置已保存，感谢墙会自动同步。'); } catch (error) { notice(error.message, true); } finally { setBusy(button, false); } });
$('#password-button').addEventListener('click', () => edit('修改管理员密码', [{name:'current_password',label:'当前密码',type:'password',max:128},{name:'new_password',label:'新密码（至少 12 位）',type:'password',min:12,max:128}], async data => { await post('/api/admin/password', data); showLogin(); $('#login-status').textContent = '密码已修改，请使用新密码登录。'; }, '保存后全部管理员会话将退出。'));
api('/api/admin/me').then(start).catch(() => showLogin());
