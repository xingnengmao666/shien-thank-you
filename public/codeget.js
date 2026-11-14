import { conceal, reveal, setBusy, startLoading } from './ui.js';

const form = document.querySelector('#codeget-form'), button = document.querySelector('#codeget-button');
const status = document.querySelector('#codeget-status'), classField = document.querySelector('#codeget-class-field');
const classSelect = document.querySelector('#codeget-class');

async function browserFingerprint() {
  const canvas = document.createElement('canvas');
  canvas.width = 240; canvas.height = 60;
  const ctx = canvas.getContext('2d');
  let drawing = 'unavailable', renderer = 'unavailable';
  if (ctx) {
    ctx.font = '18px sans-serif'; ctx.fillStyle = '#94070a'; ctx.fillText('师恩难忘 / codeget ♡', 8, 30);
    ctx.fillStyle = '#67d027'; ctx.fillRect(175, 10, 30, 30);
    drawing = canvas.toDataURL();
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    if (info) renderer = `${gl.getParameter(info.UNMASKED_VENDOR_WEBGL)}:${gl.getParameter(info.UNMASKED_RENDERER_WEBGL)}`;
  } catch { /* Privacy settings may disable WebGL; the other signals still apply. */ }
  const features = [navigator.userAgent, navigator.platform, navigator.languages, navigator.hardwareConcurrency || null,
    navigator.deviceMemory || null, navigator.maxTouchPoints, [screen.width, screen.height].sort((a, b) => a - b),
    screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone, drawing, renderer];
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(features)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

async function api(path, options = {}) {
  const finish = startLoading();
  try {
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json' } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '领取失败，请稍后再试。');
    return data;
  } finally { finish(); }
}

form.elements.real_name.addEventListener('input', () => {
  classField.hidden = true; classSelect.required = false; classSelect.value = ''; status.textContent = '';
});
form.addEventListener('submit', async event => {
  event.preventDefault(); status.textContent = ''; setBusy(button, true);
  try {
    const data = { real_name: form.elements.real_name.value, fingerprint: await browserFingerprint() };
    if (!classField.hidden) data.class_id = classSelect.value;
    const result = await api('/api/student/codeget', { method: 'POST', body: JSON.stringify(data) });
    if (result.needs_class) {
      reveal(classField); classSelect.required = true; classSelect.focus(); status.textContent = result.message; return;
    }
    document.querySelector('#codeget-identity').textContent = `${result.real_name} · ${result.class_name}`;
    document.querySelector('#codeget-code').value = result.student_code;
    await conceal(form); reveal(document.querySelector('#codeget-result'));
    status.textContent = '领取成功，请尽快截图保存邀请码，并复制备份。';
    document.querySelector('#copy-code').focus();
  } catch (error) { status.textContent = error.message; }
  finally { setBusy(button, false); }
});
document.querySelector('#copy-code').addEventListener('click', async () => {
  const code = document.querySelector('#codeget-code');
  try { await navigator.clipboard.writeText(code.value); status.textContent = '验证码已复制，请尽快截图保存邀请码，再前往填写寄语。'; }
  catch { code.focus(); code.select(); status.textContent = '请长按或使用 Ctrl+C 手动复制并保存验证码。'; }
});

try {
  const { settings, classes } = await api('/api/site');
  for (const item of classes) {
    const option = document.createElement('option'); option.value = item.id; option.textContent = item.class_name; classSelect.append(option);
  }
  if (settings.submissions_open) button.disabled = false;
  else status.textContent = '寄语提交暂时关闭，暂不能领取验证码。';
} catch (error) { status.textContent = error.message; }
