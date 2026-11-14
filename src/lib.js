export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
export async function body(request, max = 262144) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new HttpError(415, '请使用 JSON 请求。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '请求内容不能为空。');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new HttpError(413, '请求内容过大。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch { throw new HttpError(400, '请求内容不是有效的 JSON 对象。'); }
}
export function str(value, label, min = 1, max = 80) {
  if (typeof value !== 'string') throw new HttpError(400, `${label}格式错误。`);
  const s = value.normalize('NFC').trim();
  if ([...s].length < min || [...s].length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)) throw new HttpError(400, `${label}需为 ${min}–${max} 个字符，且不能含控制字符。`);
  return s;
}
export function id(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, '编号格式错误。');
  return Number(value);
}
export function page(url) {
  const p = url.searchParams.get('page') || '1', size = url.searchParams.get('page_size') || '30';
  const current = id(p), limit = id(size);
  if (limit > 100 || current > 1000000) throw new HttpError(400, '分页参数超出范围。');
  return { page: current, page_size: limit, offset: (current - 1) * limit };
}
export function sort(url, stable = false) {
  const s = url.searchParams.get('sort') || (stable ? 'stable' : 'desc');
  if (s === 'stable' && stable) return 'm.display_order ASC, m.id ASC';
  if (s === 'asc' || s === 'desc') return `m.created_at ${s.toUpperCase()}, m.id ${s.toUpperCase()}`;
  throw new HttpError(400, '排序参数错误。');
}
export function displayName(name, mode) {
  return mode === 'full' ? name : mode === 'anonymous' ? '一位同学' : `${[...name][0]}同学`;
}
export function audit(db, admin, action, type, target) {
  return db.prepare('INSERT INTO audit_logs (admin_id, action, target_type, target_id) VALUES (?, ?, ?, ?)').bind(admin.id, action, type, String(target));
}
