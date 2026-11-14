import { HttpError } from './lib.js';

const encoder = new TextEncoder();
function hex(bytes) { return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(s) { return Uint8Array.from(s.match(/.{2}/g) || [], b => parseInt(b, 16)); }
export function token() { return hex(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
export async function keyedHash(secret, value) {
  if (!secret || secret.length < 32) throw new HttpError(503, '服务尚未配置安全密钥。');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function codeKey(secret) {
  return crypto.subtle.importKey('raw', fromHex(await keyedHash(secret, 'student-code-export:v1')), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptCode(secret, code, hash) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(hash) }, await codeKey(secret), encoder.encode(code));
  return `${hex(iv)}:${hex(encrypted)}`;
}
export async function decryptCode(secret, encrypted, hash) {
  const [iv, data] = encrypted.split(':');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(iv), additionalData: encoder.encode(hash) }, await codeKey(secret), fromHex(data));
  return new TextDecoder().decode(plain);
}
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
export async function passwordHash(password, salt = token()) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: fromHex(salt) }, key, 256);
  return `pbkdf2-sha256$100000$${salt}$${hex(result)}`;
}
export async function passwordMatches(password, saved) {
  const parts = saved.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000') return false;
  return equal(await passwordHash(password, parts[2]), saved);
}
export function checkOrigin(request) {
  const expected = new URL(request.url).origin;
  if (request.headers.get('Origin') !== expected) throw new HttpError(403, '请求来源不受信任。');
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new HttpError(403, '不允许跨站请求。');
}
export async function rateLimit(request, env, scope, limit, seconds = 600) {
  const now = Math.floor(Date.now() / 1000);
  const fingerprint = await keyedHash(env.AUTH_SECRET, `${scope}:${request.headers.get('CF-Connecting-IP') || 'local'}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits')
    .bind(`${fingerprint}:${Math.floor(now / seconds)}`, now + seconds).first();
  if (row.hits > limit) throw new HttpError(429, '操作过于频繁，请稍后再试。');
}
export const sessionCookie = (value, age = 28800) => `admin_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export function codeDevice(request) {
  const raw = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('__Host-codeget_device='))?.slice('__Host-codeget_device='.length);
  return /^[a-f0-9]{64}$/.test(raw || '') ? raw : null;
}
export const codeDeviceCookie = value => `__Host-codeget_device=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`;
export async function adminAuth(request, env, ownerOnly = false) {
  const raw = (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith('admin_session='))?.slice(14);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(401, '请先登录管理员账号。');
  const admin = await env.DB.prepare('SELECT a.id, a.username, a.role, s.csrf_token FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await digest(raw), Math.floor(Date.now() / 1000)).first();
  if (!admin) throw new HttpError(401, '会话已过期，请重新登录。');
  if (ownerOnly && admin.role !== 'owner') throw new HttpError(403, '此操作需要主管理员权限。');
  if (!['GET', 'HEAD'].includes(request.method) && !equal(request.headers.get('X-CSRF-Token'), admin.csrf_token)) throw new HttpError(403, '安全校验失败，请刷新后台重试。');
  return { ...admin, token_hash: await digest(raw) };
}
export async function studentAuth(request, env) {
  const raw = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new HttpError(401, '请先完成学生身份验证。');
  const student = await env.DB.prepare('SELECT student_id FROM student_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await digest(raw), Math.floor(Date.now() / 1000)).first();
  if (!student) throw new HttpError(401, '身份验证已过期，请重新验证。');
  return student.student_id;
}
