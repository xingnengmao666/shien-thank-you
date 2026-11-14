import { heartRows } from './heart.js';
import { conceal, reveal, sendPaper, setBusy, startLoading } from './ui.js';
import './landing.js';
const $ = s => document.querySelector(s);
let credential = null, classes = [], syncInProgress = false, lastSignature = '';
let noteButtons = [], layoutFrame = 0;
const outline = $('#heart-stage .heart-outline'), heartPath = outline.querySelector('path');
const emptyPath = heartPath.getAttribute('d');
function sizeHeart() {
  const stage = $('#heart-stage');
  outline.setAttribute('viewBox', '0 0 800 650'); heartPath.setAttribute('d', emptyPath);
  outline.setAttribute('preserveAspectRatio', stage.classList.contains('has-notes') ? 'none' : 'xMidYMid meet');
  if (!stage.classList.contains('has-notes')) return;
  const body = $('#notes').scrollHeight, width = stage.clientWidth;
  const fraction = noteButtons.length === 1 ? .5 : .68, start = noteButtons.length === 1 ? .28 : .12;
  const height = Math.max(width / 1.3, body / fraction);
  const top = height * start + (height * fraction - body) / 2;
  stage.style.setProperty('--heart-top-space', `${top}px`);
  stage.style.setProperty('--heart-bottom-space', `${height - top - body}px`);
  dispatchEvent(new Event('scroll'));
}
new ResizeObserver(sizeHeart).observe($('#notes'));
async function api(path, options = {}) {
  const finish = startLoading();
  try {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
    return data;
  } finally { finish(); }
}
const dateText = date => new Date(date).toLocaleDateString('zh-CN', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' });
function openWrite() {
  credential = null;
  $('#verify-form').hidden = false; $('#message-form').hidden = true; $('#submit-success').hidden = true;
  $('#form-status').textContent = ''; $('#write-dialog').showModal();
}
$('#write-button').addEventListener('click', openWrite);
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } }));
$('#message-content').addEventListener('input', event => { $('#char-count').textContent = `${[...event.target.value].length} / 1000`; });
function readNote(message, campus) {
  $('#read-dialog').dataset.campus = campus;
  $('#read-content').textContent = message.content; $('#read-name').textContent = `—— ${message.display_name}`; $('#read-date').textContent = dateText(message.created_at); $('#read-dialog').showModal();
}
function arrangeNotes() {
  const stage = $('#heart-stage'), wall = $('#notes');
  stage.classList.toggle('has-notes', noteButtons.length > 0);
  if (!noteButtons.length) { stage.style.removeProperty('--wall-width'); stage.style.removeProperty('--note-width'); wall.replaceChildren(); sizeHeart(); return; }
  const oldPositions = new Map(noteButtons.filter(note => note.isConnected && !note.classList.contains('note-enter')).map(note => [note, note.getBoundingClientRect()]));
  const focused = document.activeElement;
  const available = $('#heart-wall').clientWidth;
  const columns = Math.max(1, Math.min(4, Math.floor((available * .8 + 24) / 224), Math.ceil(Math.sqrt(noteButtons.length))));
  const width = Math.min(available, noteButtons.length === 1 ? 520 : (columns * 210 + (columns - 1) * 24) / .8);
  stage.style.setProperty('--wall-width', `${width}px`);
  stage.style.setProperty('--note-width', `${Math.min(220, (width * .8 - (columns - 1) * 24) / columns)}px`);
  const rows = [...wall.children];
  heartRows(noteButtons.length, columns).forEach((indices, r) => {
    const row = rows[r] || document.createElement('div'); row.className = 'note-row';
    let anchor = row.firstElementChild;
    indices.forEach((index, position) => {
      const button = noteButtons[index];
      button.dataset.campus = indices.length === 1 && columns === 1 && noteButtons.length > 1 ? (index % 2 ? 'new' : 'original') : (position < indices.length / 2 && indices.length > 1 ? 'original' : 'new');
      if (button !== anchor) row.insertBefore(button, anchor);
      anchor = button.nextElementSibling;
    });
    if (!row.isConnected) wall.append(row);
  });
  for (const row of rows) if (!row.children.length) row.remove();
  for (const note of noteButtons) {
    const content = note.querySelector('.note-preview'), toggle = note.querySelector('.note-toggle');
    if (!note.classList.contains('is-expanded') && !content.getAnimations().length) note.hasOverflow = content.scrollHeight > content.clientHeight + 1;
    toggle.hidden = !note.hasOverflow;
  }
  sizeHeart();
  for (const button of noteButtons) {
    const angle = columns === 1 || button.offsetHeight > button.offsetWidth * 1.3 ? 0 : ((Number(button.dataset.messageId) * 7) % 5) - 2;
    button.style.setProperty('--rotation', `${angle}deg`);
    const previous = oldPositions.get(button), next = button.getBoundingClientRect();
    if (previous && !matchMedia('(prefers-reduced-motion: reduce)').matches && (Math.abs(previous.x - next.x) > 1 || Math.abs(previous.y - next.y) > 1)) {
      button.animate([{ translate: `${previous.x - next.x}px ${previous.y - next.y}px` }, { translate: '0 0' }], { duration: 260, easing: 'linear' });
    }
  }
  if (focused?.closest('.heart-note') && document.activeElement !== focused && focused.isConnected) focused.focus({ preventScroll: true });
}
function toggleNote(note) {
  const content = note.querySelector('.note-preview'), toggle = note.querySelector('.note-toggle');
  const from = content.getBoundingClientRect().height;
  content.getAnimations().forEach(animation => animation.cancel());
  const expanded = note.classList.toggle('is-expanded');
  toggle.setAttribute('aria-expanded', String(expanded)); toggle.textContent = expanded ? '收起全文' : '展开全文';
  note.style.setProperty('--rotation', '0deg');
  const to = content.getBoundingClientRect().height;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    content.style.overflow = 'hidden';
    const animation = content.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 200, easing: 'linear' });
    note.expandAnimation = animation;
    animation.finished.catch(() => {}).then(() => {
      if (note.expandAnimation === animation) { content.style.removeProperty('overflow'); arrangeNotes(); }
    });
  } else arrangeNotes();
}
function scheduleLayout() {
  if (!layoutFrame) layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; arrangeNotes(); });
}
async function renderNotes(messages) {
  const signature = JSON.stringify(messages);
  if (signature === lastSignature) return;
  lastSignature = signature;
  const wall = $('#notes');
  const previous = new Map([...wall.querySelectorAll('.heart-note')].map(note => [Number(note.dataset.messageId), note]));
  const buttons = [];
  if (messages.length) conceal($('#wall-empty'));
  else if ($('#wall-empty').hidden) reveal($('#wall-empty'));
  messages.forEach(message => {
    const existing = previous.get(message.id);
    const button = existing || document.createElement('article');
    previous.delete(message.id);
    button.noteMessage = message;
    if (!existing) {
      button.className = `heart-note note-tone-${message.id % 4} note-enter`;
      button.addEventListener('animationend', () => button.classList.remove('note-enter'), { once: true });
    }
    button.dataset.messageId = message.id;
    button.setAttribute('aria-label', `${message.display_name}的寄语`);
    const content = button.querySelector('.note-preview') || document.createElement('span'); content.className = 'note-preview'; content.textContent = message.content;
    content.id = `note-text-${message.id}`;
    const author = button.querySelector('.note-author') || document.createElement('span'); author.className = 'note-author'; author.textContent = message.display_name;
    if (!existing) {
      const actions = document.createElement('div'); actions.className = 'note-actions';
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'note-toggle'; toggle.textContent = '展开全文'; toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', content.id);
      toggle.addEventListener('click', () => toggleNote(button));
      const read = document.createElement('button'); read.type = 'button'; read.className = 'note-read'; read.textContent = '单独阅读';
      read.addEventListener('click', () => readNote(button.noteMessage, button.dataset.campus));
      actions.append(toggle, read); button.append(content, author, actions);
    }
    buttons.push(button);
  });
  await Promise.all([...previous.values()].map(note => conceal(note, true)));
  noteButtons = buttons; arrangeNotes();
}
async function sync() {
  if (syncInProgress || document.hidden) return;
  syncInProgress = true;
  try {
    const site = await api('/api/site'); classes = site.classes;
    document.querySelectorAll('[data-title]').forEach(el => { el.textContent = site.settings.site_title; });
    document.title = `${site.settings.site_title} · 写给老师的感谢`;
    $('#teacher-name').textContent = site.settings.teacher_name; $('#homepage-copy').textContent = site.settings.homepage_copy;
    const open = Boolean(site.settings.submissions_open) && classes.length > 0;
    $('#write-button').disabled = !open;
    $('#submission-hint').textContent = !site.settings.submissions_open ? '留言提交暂时关闭，感谢墙仍可浏览。' : !classes.length ? '管理员正在准备班级名单，请稍后再来。' : '实名验证后提交，审核通过后展示。';
    const select = $('#verify-class'), selected = select.value;
    select.replaceChildren(new Option('请选择班级', ''), ...classes.map(c => new Option(c.class_name, c.id)));
    select.value = selected;
    let messages = [], current = 1, total;
    do {
      const data = await api(`/api/messages?page_size=100&page=${current++}&sort=stable`);
      messages.push(...data.items); total = data.total;
      if (!data.items.length) break;
    } while (messages.length < total);
    // A concurrent approval can shift a page boundary; never render the same row twice.
    messages = [...new Map(messages.map(m => [m.id, m])).values()].sort((a, b) => a.display_order - b.display_order || a.id - b.id);
    await renderNotes(messages); $('#approved-count').textContent = messages.length;
    $('#sync-status').textContent = '已同步 · 每 30 秒更新';
  } catch (error) { $('#sync-status').textContent = `${error.message} 30 秒后重试`; }
  finally { syncInProgress = false; }
}
$('#verify-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); $('#form-status').textContent = '正在验证身份…';
  try {
    const values = Object.fromEntries(new FormData(event.target)); values.class_id = Number(values.class_id);
    const data = await api('/api/student/verify', { method: 'POST', body: JSON.stringify(values) });
    if (data.submission_status) { $('#form-status').textContent = '你已提交过感谢，请耐心等待审核；如需调整请联系管理员。'; return; }
    credential = data.credential; $('#verified-name').textContent = `✓ ${values.real_name}，身份已确认`;
    event.target.reset(); await conceal($('#verify-form')); reveal($('#message-form')); $('#form-status').textContent = ''; $('#message-content').focus();
  } catch (error) { $('#form-status').textContent = error.message; }
  finally { setBusy(button, false); }
});
$('#message-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); setBusy(button, true); $('#form-status').textContent = '正在提交感谢…';
  try {
    const content = $('#message-content').value;
    await api('/api/messages', { method: 'POST', headers: { Authorization: `Bearer ${credential}` }, body: JSON.stringify({ content }) });
    const from = $('#message-content').getBoundingClientRect();
    $('#message-form').hidden = true; reveal($('#submit-success')); $('#form-status').textContent = ''; credential = null;
    event.target.reset(); $('#char-count').textContent = '0 / 1000';
    await sendPaper(from, $('#submit-success .success-mark'), content);
  } catch (error) { $('#form-status').textContent = error.message; }
  finally { setBusy(button, false); }
});
addEventListener('resize', scheduleLayout, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
sync(); setInterval(sync, 30000);
