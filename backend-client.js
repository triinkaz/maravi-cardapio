(function (root) {
  'use strict';
  const config = root.MARAVI_CONFIG || {};
  let url = '';
  let key = '';
  try {
    const parsed = new URL(config.supabaseUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    key = String(config.supabasePublishableKey || '');
    // This must be the same default publishable key used by admin-login.
    // Legacy anon JWTs work for the Data API but not this login gateway.
    if (!key.startsWith('sb_publishable_')) throw new Error();
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
      const response = await fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
      let data = null;
      if (response.status !== 204) { try { data = await response.json(); } catch { /* An invalid response is handled below. */ } }
      if (!response.ok) {
        const code = data?.code || '';
        let message = 'Não foi possível concluir a operação. Tente novamente.';
        if (response.status === 401 || path === '/functions/v1/admin-login' && response.status === 400) message = 'Usuário ou senha incorretos, ou sessão expirada.';
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
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const IMAGE_ORIGIN = 'https://dkllcttqkyazbkqygixv.supabase.co';
  async function uploadProductImage(token, file) {
    if (typeof token !== 'string' || !token.trim()) throw error('Sua sessão expirou. Entre novamente.', 401);
    if (!url || url !== IMAGE_ORIGIN) throw error('O armazenamento de fotos ainda não foi configurado.');
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || typeof file.arrayBuffer !== 'function') throw error('Escolha uma foto JPG, PNG ou WEBP.');
    if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_IMAGE_BYTES) throw error('A foto deve ter no máximo 5 MB.');
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const signature = file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
      : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!signature) throw error('O arquivo não é uma foto válida.');
    let bitmap;
    let blob;
    try {
      bitmap = await root.createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error();
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = root.document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.86));
      if (!blob || blob.type !== 'image/webp' || blob.size < 1 || blob.size > MAX_IMAGE_BYTES) throw new Error();
    } catch { throw error('Não foi possível preparar a foto. Use JPG, PNG ou WEBP de até 40 megapixels.'); }
    finally { if (bitmap) bitmap.close(); }
    const path = `products/${root.crypto.randomUUID()}.webp`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${url}/storage/v1/object/product-images/${path}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'image/webp', 'x-upsert': 'false', 'cache-control': '31536000' },
        body: blob, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error'
      });
      if (!response.ok) {
        if (response.status === 401) throw error('Sua sessão expirou. Entre novamente.', 401);
        if (response.status === 403) throw error('Este usuário não tem permissão para enviar fotos.', 403);
        throw error('Não foi possível enviar a foto. Tente novamente.', response.status);
      }
      return { image: `${url}/storage/v1/object/public/product-images/${path}`, path };
    } catch (cause) {
      if ('status' in cause) throw cause;
      throw error('Não foi possível confirmar o envio da foto. Verifique a conexão e tente novamente.');
    } finally { clearTimeout(timer); }
  }
  root.MaraviBackend = Object.freeze({
    uploadProductImage,
    configured: Boolean(url),
    configurationProvided: Boolean(config.supabaseUrl || config.supabasePublishableKey),
    getPublicCatalog: () => request('/rest/v1/rpc/get_public_catalog', {}),
    async login(username, password) {
      const data = await request('/functions/v1/admin-login', { username, password });
      if (typeof data.access_token !== 'string' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in < 1 || data.expires_in > 86400) throw error('Resposta de autenticação inválida.');
      return { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    },
    getAdminCatalog: token => request('/rest/v1/rpc/admin_get_catalog', {}, token),
    saveAdminCatalog: (token, revision, catalog) => request('/rest/v1/rpc/admin_save_catalog', { expected_revision: revision, catalog_data: catalog }, token),
    logout: token => request('/auth/v1/logout?scope=local', {}, token)
  });
})(typeof window !== 'undefined' ? window : globalThis);
