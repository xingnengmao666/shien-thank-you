import { HttpError, json } from './lib.js';
import { checkOrigin, codeDevice, codeDeviceCookie, token } from './security.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';

function secure(response, isAPI = false) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'same-origin');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (isAPI) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const api = url.pathname.startsWith('/api/');
    try {
      if (!api) {
        if (!['GET','HEAD'].includes(request.method)) throw new HttpError(405, '不支持该请求方式。');
        if (['/codeget', '/codeget/', '/codeget.html'].includes(url.pathname)) {
          const response = await env.ASSETS.fetch(new Request(new URL('/codeget.html', url), request));
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', 'no-store');
          if (!codeDevice(request)) headers.set('Set-Cookie', codeDeviceCookie(token()));
          return secure(new Response(response.body, { status: response.status, headers }));
        }
        if (url.pathname === '/admin' || url.pathname === '/') {
          const assetURL = new URL(url.pathname === '/admin' ? '/admin.html' : '/index.html', url);
          return secure(await env.ASSETS.fetch(new Request(assetURL, request)));
        }
        return secure(await env.ASSETS.fetch(request));
      }
      if (!env.DB) throw new HttpError(503, '数据库尚未配置。');
      // The codeget route checks Origin itself so rejected attempts also leave a record.
      if (!['GET','HEAD'].includes(request.method) && !(request.method === 'POST' && url.pathname === '/api/student/codeget')) checkOrigin(request);
      const response = await publicRoutes(request, env, url) || await adminRoutes(request, env, url);
      if (!response) throw new HttpError(404, '接口不存在。');
      return secure(response, true);
    } catch (error) {
      let status = error.status || 500, message = error instanceof HttpError ? error.message : '服务暂时不可用，请稍后重试。';
      if (String(error).includes('UNIQUE constraint failed')) { status = 409; message = '记录已存在，操作未保存。请检查是否重复导入或重名。'; }
      if (String(error).includes('FOREIGN KEY constraint failed')) { status = 409; message = '关联记录不存在或仍被使用，操作未保存。'; }
      if (status === 500) console.error('Worker failure:', error.name, error.message);
      return secure(json({ error: message }, status, status === 429 ? { 'Retry-After': '600' } : {}), api);
    }
  },
  async scheduled(event, env) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM student_sessions WHERE expires_at < ?').bind(now)
    ]);
  }
};
