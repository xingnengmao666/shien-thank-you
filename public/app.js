import { heartRows } from './heart.js';
import { conceal, reveal, sendPaper, setBusy, startLoading } from './ui.js';
import './landing.js';
const $ = s => document.querySelector(s);
let credential = null, classes = [], syncInProgress = false, lastSignature = '';
let noteButtons = [], layoutFrame = 0, mobileIndex = 0;
const outline = $('#heart-stage .heart-outline'), heartPath = outline.querySelector('path');
const emptyPath = heartPath.getAttribute('d');
function sizeHeart() {
  const stage = $('#heart-stage');
  outline.setAttribute('viewBox', '0 0 800 650'); heartPath.setAttribute('d', emptyPath);
  outline.setAttribute('preserveAspectRatio', stage.classList.contains('has-notes') && !stage.classList.contains('mobile-heart') ? 'none' : 'xMidYMid meet');
  if (!stage.classList.contains('has-notes') || stage.classList.contains('mobile-heart')) return;
  const rows = [...$('#notes').children], width = stage.clientWidth;
  const body = rows.reduce((height, row) => height + row.offsetHeight, 0);
  const compact = stage.classList.contains('compact-heart');
  const gap = parseFloat(stage.style.getPropertyValue('--note-gap'));
  const noteWidth = parseFloat(stage.style.getPropertyValue('--note-width'));
  const fraction = noteButtons.length === 1 ? .5 : compact ? .82 - noteWidth / width : .68, start = noteButtons.length === 1 ? .28 : compact ? .1 : .12;
  const height = Math.max(width * 650 / 800, (body + gap * (rows.length - 1)) / fraction);
  const rowGap = rows.length > 1 ? (height * fraction - body) / (rows.length - 1) : 0;
  const top = height * start + (rows.length === 1 ? (height * fraction - body) / 2 : 0);
  stage.style.setProperty('--row-gap', `${rowGap}px`);
  stage.style.setProperty('--heart-top-space', `${top}px`);
  stage.style.setProperty('--heart-bottom-space', `${height - top - body - rowGap * (rows.length - 1)}px`);
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
function updateMobileGroup() {
  const wall = $('#notes');
  if (!$('#heart-stage').classList.contains('mobile-heart') || !noteButtons.length) return;
  const groups = Math.ceil(noteButtons.length / 3);
  mobileIndex = Math.max(0, Math.min(groups - 1, mobileIndex));
  [...wall.children].forEach((page, index) => { page.hidden = Math.floor(index / 3) !== mobileIndex; });
  const position = `第 ${mobileIndex + 1} 组 / 共 ${groups} 组`;
  if ($('#heart-position').textContent !== position) $('#heart-position').textContent = position;
  $('#heart-prev').disabled = mobileIndex === 0;
  $('#heart-next').disabled = mobileIndex === groups - 1;
}
function turnMobilePage(index) {
  const previous = mobileIndex;
  mobileIndex = index; updateMobileGroup();
  const page = $('#notes').children[mobileIndex * 3];
  if (page) {
    page.style.scrollMarginTop = `${$('#mobile-heart-nav').offsetHeight + 16}px`;
    page.focus({ preventScroll: true });
    page.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (previous !== mobileIndex && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      $('#notes').querySelectorAll('.mobile-heart-page:not([hidden]) .heart-note').forEach((note, position) => {
        note.classList.remove('note-enter');
        note.getAnimations().forEach(animation => animation.cancel());
        note.animate([{ opacity: 0, translate: '0 10px' }, { opacity: 1, translate: '0 0' }], { duration: 260, delay: position * 40, easing: 'ease-out', fill: 'backwards' });
      });
    }
  }
}
$('#heart-prev').addEventListener('click', () => turnMobilePage(mobileIndex - 1));
$('#heart-next').addEventListener('click', () => turnMobilePage(mobileIndex + 1));
function arrangeMobileNotes(wall) {
  const current = wall.querySelector('.mobile-heart-page:not([hidden]) .heart-note');
  const currentIndex = noteButtons.indexOf(current);
  if (currentIndex >= 0) mobileIndex = Math.floor(currentIndex / 3);
  let anchor = wall.firstElementChild;
  noteButtons.forEach((note, index) => {
    let page = note.closest('.mobile-heart-page');
    if (!page) {
      page = document.createElement('div'); page.className = 'mobile-heart-page';
      const heart = outline.cloneNode(true);
      heart.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      // Each heart needs its own gradient IDs when several share the same document.
      for (const gradient of heart.querySelectorAll('[id]')) gradient.id += `-${note.dataset.messageId}`;
      heart.querySelector('path').setAttribute('fill', `url(#heart-paper-${note.dataset.messageId})`);
      heart.querySelector('path').setAttribute('stroke', `url(#heart-thread-${note.dataset.messageId})`);
      page.append(heart);
    }
    page.setAttribute('role', 'group'); page.setAttribute('aria-label', `第 ${index + 1} 份祝福，共 ${noteButtons.length} 份`);
    page.inert = false; page.setAttribute('tabindex', '-1');
    note.classList.remove('note-lobe-start'); note.style.setProperty('--rotation', '0deg');
    note.dataset.campus = index % 2 ? 'new' : 'original';
    note.querySelector('.note-read').textContent = '阅读全文';
    note.querySelector('.note-preview').getAnimations().forEach(animation => animation.cancel());
    if (note.parentElement !== page) page.append(note);
    if (page !== anchor) wall.insertBefore(page, anchor);
    anchor = page.nextElementSibling;
  });
  for (const child of [...wall.children]) if (!child.classList.contains('mobile-heart-page') || !child.querySelector('.heart-note')) child.remove();
  wall.removeAttribute('tabindex');
  if (noteButtons.length > 1) wall.setAttribute('aria-describedby', 'mobile-heart-hint');
  else wall.removeAttribute('aria-describedby');
  updateMobileGroup();
  dispatchEvent(new Event('scroll'));
}
function arrangeNotes() {
  const stage = $('#heart-stage'), wall = $('#notes');
  const available = $('#heart-wall').clientWidth;
  const compact = noteButtons.length >= 5 && available >= 640;
  const mobile = noteButtons.length > 0 && matchMedia('(max-width: 700px)').matches;
  stage.classList.toggle('has-notes', noteButtons.length > 0);
  stage.classList.toggle('compact-heart', compact && !mobile);
  stage.classList.toggle('mobile-heart', mobile);
  $('#wall-title').textContent = mobile ? '把心意，一页页珍藏' : '把心意，拼成一颗心';
  $('#heart-wall .wall-heading > p:last-child').textContent = mobile ? '您奔赴新的校园，这些心意一直都在。' : '您奔赴新的校园，我们把感谢留成一颗心。';
  $('#mobile-heart-nav').hidden = !mobile || noteButtons.length <= 3;
  $('#mobile-heart-hint').hidden = !mobile || noteButtons.length === 1;
  if (!mobile) { wall.removeAttribute('tabindex'); wall.removeAttribute('aria-describedby'); }
  if (!noteButtons.length) { stage.style.removeProperty('--wall-width'); stage.style.removeProperty('--note-width'); wall.replaceChildren(); sizeHeart(); return; }
  const oldPositions = new Map(noteButtons.filter(note => note.isConnected && !note.classList.contains('note-enter')).map(note => [note, note.getBoundingClientRect()]));
  const focused = document.activeElement;
  if (mobile) {
    arrangeMobileNotes(wall); sizeHeart();
    if (focused?.closest('.heart-note') && document.activeElement !== focused && focused.isConnected) focused.focus({ preventScroll: true });
    return;
  }
  const gap = compact ? 12 : 24;
  const columns = Math.max(1, Math.min(8, Math.floor((available * .72 + gap) / ((compact ? 90 : 200) + gap)), Math.ceil(Math.sqrt(noteButtons.length) * (compact ? 1.35 : 1))));
  const width = Math.min(available, noteButtons.length === 1 ? 520 : (columns * (compact ? 130 : 210) + (columns - 1) * gap) / .72);
  stage.style.setProperty('--wall-width', `${width}px`);
  stage.style.setProperty('--note-gap', `${gap}px`);
  stage.style.setProperty('--note-width', `${Math.min(220, (width * .72 - (columns - 1) * gap) / columns)}px`);
  const rows = [...wall.children].filter(row => row.classList.contains('note-row'));
  const layout = heartRows(noteButtons.length, columns);
  stage.style.setProperty('--shoulder-width', layout.length <= 4 ? '80%' : '90%');
  layout.forEach((indices, r) => {
    const row = rows[r] || document.createElement('div'); row.className = 'note-row';
    let anchor = row.firstElementChild;
    indices.forEach((index, position) => {
      const button = noteButtons[index];
      button.classList.toggle('note-lobe-start', r === 0 && indices.length > 2 && position === indices.length / 2);
      button.dataset.campus = indices.length === 1 && columns === 1 && noteButtons.length > 1 ? (index % 2 ? 'new' : 'original') : (position < indices.length / 2 && indices.length > 1 ? 'original' : 'new');
      if (button !== anchor) row.insertBefore(button, anchor);
      anchor = button.nextElementSibling;
    });
    if (!row.isConnected) wall.append(row);
  });
  for (const row of rows) if (!row.children.length) row.remove();
  wall.querySelectorAll('.mobile-heart-page').forEach(page => page.remove());
  for (const note of noteButtons) {
    const content = note.querySelector('.note-preview'), toggle = note.querySelector('.note-toggle');
    note.querySelector('.note-read').textContent = compact ? '阅读' : '单独阅读';
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
