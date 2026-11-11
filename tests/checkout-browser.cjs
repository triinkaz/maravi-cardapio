// Checkout QA is local-only. WhatsApp navigations are captured, never sent.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'checkout');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' };
let server, browser;
async function run() {
  fs.mkdirSync(output, { recursive: true });
  server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, data) => {
      res.writeHead(error ? 404 : 200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
      res.end(error ? 'Not found' : data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true });
  for (const width of [320, 390, 1280]) {
    // A visitor abroad must still see the date and payment window of the shop.
    const context = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Asia/Tokyo' });
    const messages = [], errors = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === base && url.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: 'window.MARAVI_CONFIG={};' });
      if (url.origin === base) return route.continue();
      if (url.hostname === 'wa.me') {
        messages.push(url.searchParams.get('text'));
        return route.fulfill({ contentType: 'text/html', body: '<h1>Local checkout capture</h1>' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.setFixedTime(new Date('2026-11-11T15:00:00Z'));
    await page.goto(base); await page.waitForSelector('.product-card');
    await page.locator('[data-add="classic-nutella"]').click();
    if (width <= 800) await page.locator('#mobile-cart-button').click();
    await page.locator('#customer-name').fill('Cliente teste');
    await page.locator('input[name="fulfillment"][value="entrega"]').locator('..').click();
    await page.locator('#address').fill('Rua de teste, 100');
    await page.locator('#payment').selectOption('Pix');
    assert.equal(await page.locator('#order-date').innerText(), '11/11/2026');
    assert.equal(await page.locator('#order-date').getAttribute('datetime'), '2026-11-11');
    assert.equal(await page.locator('#when, input[type="date"], input[type="time"]').count(), 0);
    assert.equal(await page.locator('#payment option:enabled').count(), 2);
    assert.equal(await page.locator('#delivery-estimate').isVisible(), true);
    assert.equal(await page.locator('#pickup-estimate').isVisible(), false);
    assert.doesNotMatch(await page.locator('#cart-totals').innerText(), /Subtotal/);
    await page.locator('#order-button').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `today-delivery-${width}.png`), animations: 'disabled' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#order-button').click();
    await page.waitForURL('https://wa.me/**');
    assert.match(messages.at(-1), /para hoje \(11\/11\/2026\)/);
    assert.match(messages.at(-1), /35–75 minutos, a confirmar pelo WhatsApp/);
    assert.match(messages.at(-1), /\*Pagamento:\* Pix/);
    assert.doesNotMatch(messages.at(-1), /Subtotal/);
    await page.goBack(); await page.waitForSelector('.product-card');
    if (width <= 800 && !await page.locator('#pedido').evaluate(el => el.classList.contains('open'))) await page.locator('#mobile-cart-button').click();
    await page.locator('#customer-name').fill('Cliente teste');
    await page.locator('input[name="fulfillment"][value="entrega"]').locator('..').click();
    await page.locator('#address').fill('Rua de teste, 100');
    await page.locator('input[name="orderTiming"][value="agendar"]').locator('..').click();
    assert.equal(await page.locator('#today-details').isVisible(), false);
    assert.equal(await page.locator('#payment').isVisible(), false);
    assert.equal(await page.locator('#schedule-details').isVisible(), true);
    await page.locator('#order-button').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `scheduled-delivery-${width}.png`), animations: 'disabled' });
    if (width <= 800) {
      await page.locator('#cart-close').click();
      assert.equal(await page.locator('body').evaluate(el => el.style.overflow), '');
      await page.locator('#mobile-cart-button').click();
      assert.equal(await page.locator('input[name="orderTiming"][value="agendar"]').isChecked(), true);
      assert.equal(await page.locator('#payment').isVisible(), false);
    }
    await page.locator('#order-button').click(); await page.waitForURL('https://wa.me/**');
    assert.match(messages.at(-1), /\*Pedido:\* agendamento/);
    assert.match(messages.at(-1), /\*Data e horário:\* a combinar pelo WhatsApp/);
    assert.match(messages.at(-1), /\*Pagamento:\* a combinar pelo WhatsApp/);
    assert.doesNotMatch(messages.at(-1), /para hoje|11\/11|35–75|Troco|Subtotal/);
    await page.goBack(); await page.waitForSelector('.product-card');
    if (width <= 800 && !await page.locator('#pedido').evaluate(el => el.classList.contains('open'))) await page.locator('#mobile-cart-button').click();
    await page.locator('#customer-name').fill('Cliente teste');
    await page.locator('input[name="orderTiming"][value="hoje"]').locator('..').click();
    await page.locator('input[name="fulfillment"][value="retirada"]').locator('..').click();
    await page.locator('#payment').selectOption('Dinheiro'); await page.locator('#change').fill('50');
    assert.equal(await page.locator('#payment option:enabled').count(), 5);
    assert.equal(await page.locator('#address-wrap').isVisible(), false);
    await page.locator('#order-button').click(); await page.waitForURL('https://wa.me/**');
    assert.match(messages.at(-1), /\*Recebimento:\* Retirada/);
    assert.match(messages.at(-1), /\*Troco para:\* 50/);
    assert.doesNotMatch(messages.at(-1), /Endereço|Taxa de entrega|35–75/);
    assert.equal(messages.length, 3);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS checkout ${width}px: today/Pix, scheduled, pickup/cash, back navigation and repeated open/close; no real orders sent`);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
