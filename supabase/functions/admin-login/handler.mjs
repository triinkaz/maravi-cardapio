// This is a password gateway, not an administrator/service-role client.
// The username-to-email association exists only in private function settings.
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const MAX_BODY_BYTES = 8192;
const INVALID = { code: 'invalid_credentials', message: 'Usuário ou senha inválidos.' };

/** @param {(name: string) => string | undefined} env */
export function readConfig(env) {
  try {
    const url = new URL(env('SUPABASE_URL'));
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const keys = JSON.parse(env('SUPABASE_PUBLISHABLE_KEYS') || '{}');
    const key = keys.default;
    if (typeof key !== 'string' || !key.startsWith('sb_publishable_')) return null;
    const username = env('MARAVI_ADMIN_USERNAME') || '';
    const email = env('MARAVI_ADMIN_EMAIL') || '';
    if (!USERNAME.test(username) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return null;
    const origins = (env('MARAVI_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);
    if (!origins.length || origins.some(value => {
      const origin = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
      return origin.origin !== value || origin.username || origin.password || !(origin.protocol === 'https:' || local && origin.protocol === 'http:');
    })) return null;
    return Object.freeze({ url: url.origin, key, username, email, origins: Object.freeze(origins) });
  } catch { return null; }
}

async function readJson(request, timeoutMs) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new Error('body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body');
  let length = 0;
  const chunks = [];
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('body timeout')), timeoutMs); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new Error('body');
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    // Cancel unfinished input without waiting indefinitely for its producer.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function createHandler(config, fetchImpl = fetch, { bodyTimeoutMs = 5000 } = {}) {
  return async request => {
    const origin = request.headers.get('origin');
    const allowed = Boolean(config && config.origins.includes(origin));
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (allowed) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'apikey, content-type', 'Access-Control-Max-Age': '600' });
    const reply = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
    if (!config) return reply(503, { code: 'login_unavailable' });
    if (!allowed) return reply(403, { code: 'origin_not_allowed' });
    if (request.method === 'OPTIONS') return reply(204);
    if (request.method !== 'POST') return reply(405, { code: 'method_not_allowed' });
    // A publishable key is not a secret or proof of identity. The password is
    // verified by Supabase Auth, then the user's own JWT checks the admin list.
    if (request.headers.get('apikey') !== config.key) return reply(401, INVALID);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { code: 'invalid_request' });
    let body;
    try { body = await readJson(request, bodyTimeoutMs); } catch { return reply(400, { code: 'invalid_request' }); }
    if (!body || Array.isArray(body) || typeof body !== 'object' || typeof body.username !== 'string' || body.username.length > 128) return reply(400, { code: 'invalid_request' });
    if (Object.keys(body).some(key => !['username', 'password'].includes(key)) || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 1024) return reply(400, { code: 'invalid_request' });
    const username = body.username.trim().toLowerCase();
    if (!USERNAME.test(username) || username !== config.username) return reply(401, INVALID);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let token;
    let accepted = false;
    const authHeaders = { apikey: config.key, 'Content-Type': 'application/json' };
    try {
      const response = await fetchImpl(config.url + '/auth/v1/token?grant_type=password', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ email: config.email, password: body.password }), signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit'
      });
      body.password = '';
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter && /^\d{1,5}$/.test(retryAfter)) headers['Retry-After'] = retryAfter;
        return reply(429, { code: 'rate_limit', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
      }
      if (!response.ok) return reply(response.status >= 500 ? 503 : 401, response.status >= 500 ? { code: 'login_unavailable' } : INVALID);
      const session = await response.json();
      token = session.access_token;
      if (typeof token !== 'string' || !token || !Number.isFinite(session.expires_in) || session.expires_in < 1 || session.expires_in > 86400) return reply(503, { code: 'login_unavailable' });
      // An authenticated account is not enough; it must be on the private
      // admin list. Never return a session for a non-admin account.
      const check = await fetchImpl(config.url + '/rest/v1/rpc/admin_get_catalog', {
        method: 'POST', headers: { ...authHeaders, Authorization: `Bearer ${token}` }, body: '{}', signal: controller.signal, redirect: 'error', cache: 'no-store', credentials: 'omit'
      });
      if (check.status === 429) {
        const retryAfter = check.headers.get('retry-after');
        if (retryAfter && /^\d{1,5}$/.test(retryAfter)) headers['Retry-After'] = retryAfter;
        return reply(429, { code: 'rate_limit', message: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
      }
      if (!check.ok) return reply(check.status >= 500 ? 503 : 401, check.status >= 500 ? { code: 'login_unavailable' } : INVALID);
      const catalog = await check.json();
      if (!Number.isSafeInteger(catalog?.revision) || catalog.revision < 1 || !Array.isArray(catalog?.catalog?.products)) return reply(503, { code: 'login_unavailable' });
      accepted = true;
      // No user object or refresh token is returned. The access JWT itself
      // may contain its owner's email, which authenticated users can inspect.
      return reply(200, { access_token: token, expires_in: session.expires_in });
    } catch { return reply(503, { code: 'login_unavailable' }); }
    finally {
      body.password = '';
      clearTimeout(timeout);
      if (token && !accepted) {
        // Best effort cleanup of a newly created but rejected session.
        try { await fetchImpl(config.url + '/auth/v1/logout?scope=local', { method: 'POST', headers: { ...authHeaders, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store', credentials: 'omit' }); } catch { /* Tokens remain short-lived if logout fails. */ }
      }
    }
  };
}
