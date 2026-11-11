(function (root) {
  'use strict';
  const config = root.MARAVI_CONFIG || {};
  let url = '';
  let key = '';
  try {
    const parsed = new URL(config.supabaseUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    key = String(config.supabasePublishableKey || '');
    let publicKey = key.startsWith('sb_publishable_');
    if (key.split('.').length === 3) {
      const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      publicKey = payload.role === 'anon';
    }
    if (!publicKey) throw new Error();
    url = parsed.origin;
  } catch { url = ''; key = ''; }
  function error(message, status = 0, code = '') {
    return Object.assign(new Error(message), { status, code });
  }
  async function request(path, body, accessToken) {
    if (!url) throw error('O painel ainda não foi conectado ao banco de dados.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit' });
      let data = null;
      if (response.status !== 204) { try { data = await response.json(); } catch { /* An invalid response is handled below. */ } }
      if (!response.ok) {
        const code = data?.code || '';
        let message = 'Não foi possível concluir a operação. Tente novamente.';
        if (response.status === 401 || path.startsWith('/auth/v1/token') && response.status === 400) message = 'E-mail ou senha incorretos, ou sessão expirada.';
        else if (response.status === 403 || code === '42501') message = 'Este usuário não tem permissão de administrador.';
        else if (response.status === 409 || code === '40001') message = 'O catálogo mudou em outra sessão. Recarregue antes de publicar.';
        else if (response.status === 429) message = 'Muitas tentativas. Aguarde um pouco antes de tentar novamente.';
        else if (code === '22023' || code === '23514') message = 'Há dados inválidos no catálogo. Revise os campos antes de publicar.';
        throw error(message, response.status, code);
      }
      if (data === null && response.status !== 204) throw error('O servidor retornou uma resposta inválida.');
      return data;
    } catch (cause) {
      if ('status' in cause) throw cause;
      throw error(cause.name === 'AbortError' ? 'O servidor demorou a responder. Tente novamente.' : 'Sem conexão com o catálogo. Verifique a internet e tente novamente.');
    } finally { clearTimeout(timer); }
  }
  root.MaraviBackend = Object.freeze({
    configured: Boolean(url),
    configurationProvided: Boolean(config.supabaseUrl || config.supabasePublishableKey),
    getPublicCatalog: () => request('/rest/v1/rpc/get_public_catalog', {}),
    async login(email, password) {
      const data = await request('/auth/v1/token?grant_type=password', { email, password });
      if (!data.access_token || !Number.isFinite(data.expires_in)) throw error('Resposta de autenticação inválida.');
      return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    },
    getAdminCatalog: token => request('/rest/v1/rpc/admin_get_catalog', {}, token),
    saveAdminCatalog: (token, revision, catalog) => request('/rest/v1/rpc/admin_save_catalog', { expected_revision: revision, catalog_data: catalog }, token),
    logout: token => request('/auth/v1/logout?scope=local', {}, token)
  });
})(typeof window !== 'undefined' ? window : globalThis);
