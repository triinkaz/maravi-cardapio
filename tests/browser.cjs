const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const data = vm.runInNewContext(raw.slice(0, raw.indexOf('const backend =')) + ';({products:DEFAULT_PRODUCTS,options:DEFAULT_OPTIONS})');
const products = data.products.map(({ price, ...p }) => ({ ...p, price_cents: Math.round(price * 100), image: `assets/${p.id}.webp`, active: true, stock: null, custom: p.custom || null, flavors: (data.options[p.custom] || []).map(name => ({ name, active: true })) }));
const apiOrigin = 'https://example.supabase.co';
const output = path.join(root, 'test-results');
const errors = [];
let browser, server, base;

function serve() {
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
    fs.readFile(file, (error, bytes) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(error ? 'Not found' : bytes);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}
async function makeContext(state) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === base && state && url.pathname === '/config.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `window.MARAVI_CONFIG={supabaseUrl:'${apiOrigin}',supabasePublishableKey:'sb_publishable_test'};` });
    }
    if (url.origin === base) return route.continue();
    // No test sends data to Supabase, WhatsApp, Google Fonts or any real service.
    if (!state || url.origin !== apiOrigin) return route.abort();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey,authorization,content-type', 'access-control-allow-methods': 'POST,OPTIONS' };
    const reply = (status, body) => route.fulfill({ status, headers, contentType: 'application/json', ...(status === 204 ? {} : { body: JSON.stringify(body) }) });
    if (req.method() === 'OPTIONS') return reply(204);
    if (url.pathname === '/auth/v1/token') {
      if (state.badLogin) return reply(400, { code: 'invalid_credentials' });
      return reply(200, { access_token: 'test-memory-only-session', expires_in: 3600 });
    }
    if (url.pathname === '/auth/v1/logout') return reply(204);
    if (url.pathname === '/rest/v1/rpc/get_public_catalog') {
      if (state.fail) return reply(503, {});
      return reply(200, { revision: state.revision, catalog: { products: state.products.filter(p => p.active).map(p => ({ ...p, flavors: p.flavors.filter(f => f.active) })) } });
    }
    if (req.headers().authorization !== 'Bearer test-memory-only-session') return reply(401, {});
    if (url.pathname === '/rest/v1/rpc/admin_get_catalog') return reply(200, { revision: state.revision, catalog: { products: state.products } });
    if (url.pathname === '/rest/v1/rpc/admin_save_catalog') {
      state.saves = (state.saves || 0) + 1;
      const body = req.postDataJSON();
      if (state.conflict || body.expected_revision !== state.revision) return reply(409, { code: '40001' });
      state.products = body.catalog_data.products;
      state.revision++;
      return reply(200, { revision: state.revision, catalog: { products: state.products } });
    }
    return reply(404, {});
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return context;
}
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: !name.includes('mobile'), animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name + ': horizontal overflow');
}
async function login(page) {
  await page.locator('#email').fill('admin@example.test');
  await page.locator('#password').fill('mock-password-no-real-account');
  await page.locator('#login-button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  base = await serve();
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true });
  const context = await makeContext();
  const page = await context.newPage();
  await page.goto(base); await page.waitForSelector('.product-card');
  assert.equal(await page.locator('.product-card').count(), 14);
  await screenshot(page, 'cardapio-desktop');
  await page.locator('[data-add="classic-nutella"]').click();
  assert.equal(await page.locator('#cart-count').innerText(), '1');
  await page.locator('[data-add="aconchego"]').click();
  assert.equal(await page.locator('#dialog-counter').innerText(), '4 de 4 unidades selecionadas');
  await page.locator('#dialog-close').click();
  await page.locator('[data-add="aconchego"]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#custom-dialog').evaluate(e => e.open), false);
  await page.locator('[data-add="quarteto-maravi"]').click(); await page.locator('#dialog-add').click();
  assert.equal(await page.locator('#cart-count').innerText(), '2');
  await page.reload(); await page.waitForSelector('.product-card');
  assert.equal(await page.locator('#cart-count').innerText(), '2');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await screenshot(page, 'cardapio-mobile');
  await page.locator('#mobile-cart-button').click();
  assert.equal(await page.locator('#pedido').evaluate(e => e.classList.contains('open')), true);
  await screenshot(page, 'carrinho-mobile');
  await page.locator('#cart-close').click();
  assert.equal(await page.locator('body').evaluate(e => e.style.overflow), '');
  await page.goto(base + '/admin.html');
  assert.equal(await page.locator('#login-button').isDisabled(), true);
  assert.equal(await page.locator('#setup-notice').isVisible(), true);
  console.log('PASS storefront and unconfigured admin: catalog, cart restore, box modal, mobile drawer, fail-closed login');

  const live = { products: structuredClone(products), revision: 1 };
  live.products[0].stock = 2; live.products[1].active = false;
  const connected = await makeContext(live), p = await connected.newPage();
  await p.goto(base); await p.waitForSelector('.product-card');
  assert.equal(await p.locator('.product-card').count(), 13);
  for (let i = 0; i < 3; i++) await p.locator('[data-add="classic-nutella"]').click();
  assert.equal(await p.locator('#cart-count').innerText(), '2');
  await p.locator('#customer-name').fill('Teste'); await p.locator('#payment').selectOption('Pix');
  live.products[0].stock = 1; await p.locator('#order-button').click();
  await p.getByText('O cardápio foi atualizado.', { exact: false }).waitFor();
  assert.equal(await p.locator('#cart-count').innerText(), '1');
  live.fail = true; await p.locator('#order-button').click();
  await p.getByText('Não foi possível confirmar o cardápio.', { exact: false }).waitFor();
  await p.reload(); await p.waitForSelector('#retry-catalog');
  assert.equal(await p.locator('.product-card').count(), 0);
  assert.equal(await p.locator('#order-button').isDisabled(), true);
  live.fail = false; await p.locator('#retry-catalog').click(); await p.waitForSelector('.product-card');
  console.log('PASS live catalog: inactive hidden, stock cap, checkout revalidation, connection error and retry');

  const state = { products: structuredClone(products), revision: 1, badLogin: true };
  const adminContext = await makeContext(state), a = await adminContext.newPage();
  await a.goto(base + '/admin.html');
  await screenshot(a, 'admin-login-desktop');
  await a.locator('#email').fill('admin@example.test'); await a.locator('#password').fill('mock-password-no-real-account');
  await a.locator('#login-button').click(); await a.getByText('E-mail ou senha inválidos.', { exact: false }).waitFor();
  assert.equal(await a.locator('#password').inputValue(), '');
  state.badLogin = false; await login(a);
  assert.equal(await a.locator('.product').count(), 14);
  assert.equal(await a.locator('#password').inputValue(), '');
  assert.equal(await a.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await screenshot(a, 'admin-produtos-desktop');
  await a.locator('[data-edit="classic-nutella"]').click();
  await a.locator('#product-name').fill('Cookie atualizado'); await a.locator('#product-stock').fill('0');
  await a.locator('#product-form button[type="submit"]').click();
  assert.match(await a.locator('#products').innerText(), /Cookie atualizado/);
  a.on('dialog', dialog => dialog.accept());
  await a.locator('#publish').click(); await a.getByText('Versão 2', { exact: false }).waitFor();
  assert.equal(await a.locator('#publish').isDisabled(), true);
  assert.equal(state.saves, 1);
  await a.locator('#new-product').click();
  await a.locator('#product-name').fill('Caixa nova'); await a.locator('#product-id').fill('caixa-nova');
  await a.locator('#product-category').fill('Caixas'); await a.locator('#product-price').fill('12');
  await a.locator('#product-type').selectOption('quarteto'); await a.locator('.flavor-input').fill('Ninho');
  await a.locator('#product-form button[type="submit"]').click();
  assert.equal(await a.locator('.product').count(), 15);
  await a.locator('[data-edit="caixa-nova"]').click(); await a.locator('#product-name').fill('Não aplicado');
  await a.locator('#cancel-editor').click();
  assert.equal(await a.locator('#editor').isVisible(), false);
  assert.doesNotMatch(await a.locator('#products').innerText(), /Não aplicado/);
  await a.locator('[data-toggle="classic-nutella"]').click(); await a.locator('#filter').selectOption('inactive');
  assert.equal(await a.locator('.product').count(), 1); await a.locator('#filter').selectOption('all');
  state.conflict = true; await a.locator('#publish').click(); await a.getByText('Outra sessão publicou alterações.', { exact: false }).waitFor();
  assert.equal(await a.locator('.product').count(), 15);
  await a.setViewportSize({ width: 390, height: 844 });
  assert.ok(await a.locator('.badge.empty').evaluate(e => e.getBoundingClientRect().height) < 40, 'Stock badge must remain compact');
  await a.evaluate(() => window.scrollTo(0, 0)); await screenshot(a, 'admin-produtos-mobile');
  await a.locator('[data-edit="caixa-nova"]').click(); await screenshot(a, 'admin-editor-mobile');
  await a.locator('#cancel-editor').click();
  state.conflict = false; await a.locator('#reload').click(); await a.getByText('Última versão carregada.', { exact: true }).waitFor();
  assert.equal(await a.locator('.product').count(), 14);
  await a.locator('#logout').click(); await a.locator('#login-section').waitFor({ state: 'visible' });
  assert.equal(await a.locator('.product').count(), 0);
  assert.equal(await a.locator('#password').inputValue(), '');
  await screenshot(a, 'admin-login-mobile');
  await login(a); await a.reload(); await a.locator('#login-section').waitFor({ state: 'visible' });
  assert.equal(await a.locator('#workspace').isVisible(), false);
  console.log('PASS admin: bad login, session memory, edit/stock, publish, new box, cancel, filter, revision conflict, reload, mobile, logout and refresh');
  assert.deepEqual(errors, []);
}
run().catch(async error => {
  console.error(error);
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(output, `failure-${Date.now()}.png`), fullPage: true }).catch(() => {});
  }
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
