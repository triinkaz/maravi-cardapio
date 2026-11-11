// Layout checks use the original photo pixels and a local server only.
// Run: CHROMIUM_PATH=/usr/bin/chromium node tests/client-visual-browser.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results', 'client-visual');
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
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForSelector('.product-card');
  await page.addStyleTag({ content: 'html{scroll-behavior:auto!important}' });
  for (const width of [320, 350, 390, 550, 768, 800, 801, 1024, 1160, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const layout = await page.evaluate(async () => {
      const productImages = [...document.querySelectorAll('.product-img')];
      // Lazy images must be decoded before measuring their source crop.
      for (const image of productImages) { image.loading = 'eager'; await image.decode(); }
      const crops = ['kinder-classic', 'rabanada'].map(id => {
        const image = document.querySelector(`[data-add="${id}"]`).closest('.product-card').querySelector('img');
        const rect = image.getBoundingClientRect(), style = getComputedStyle(image);
        const scale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
        const position = style.objectPosition.split(' ').map(value => parseFloat(value) / 100);
        const top = (image.naturalHeight - rect.height / scale) * position[1];
        return { id, ratio: rect.width / rect.height, top, bottom: top + rect.height / scale, objectFit: style.objectFit };
      });
      const descriptions = [...document.querySelectorAll('.product-description')].every(el => el.scrollHeight <= el.clientHeight + 1);
      const art = document.querySelector('.hero-art').getBoundingClientRect();
      const frames = [...document.querySelectorAll('.hero-frame')].map(el => el.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth > innerWidth, crops, descriptions,
        framesInside: frames.every(rect => rect.left >= art.left - 1 && rect.right <= art.right + 1 && rect.top >= art.top - 1 && rect.bottom <= art.bottom + 1),
        overlapping: frames[0].right > frames[1].left && frames[0].bottom > frames[1].top,
        circleBorder: getComputedStyle(document.querySelector('.brand-seal')).borderTopWidth };
    });
    assert.equal(layout.overflow, false, `${width}: horizontal overflow`);
    assert.equal(layout.descriptions, true, `${width}: truncated descriptions`);
    assert.equal(layout.framesInside, true, `${width}: photos leave hero`);
    assert.equal(layout.overlapping, true, `${width}: hero photos should overlap`);
    assert.equal(layout.circleBorder, '2px');
    for (const crop of layout.crops) {
      assert.equal(crop.objectFit, 'cover');
      assert.ok(Math.abs(crop.ratio - 4 / 3) < .01, `${width}: stable photo proportions`);
      // Visually inspected source bounds: both halves lie inside y=203..415
      // for Kinder and y=230..408 for Rabanada (360x480 originals).
      const top = crop.id === 'kinder-classic' ? 203 : 230;
      const bottom = crop.id === 'kinder-classic' ? 415 : 408;
      assert.ok(crop.top <= top && crop.bottom >= bottom, `${width}: ${crop.id} cuts off a cookie half`);
    }
    if ([390, 1280].includes(width)) {
      await page.screenshot({ path: path.join(output, `hero-${width}.png`), animations: 'disabled' });
      for (const id of ['kinder-classic', 'rabanada']) {
        await page.locator(`[data-add="${id}"]`).locator('xpath=ancestor::article').screenshot({
          path: path.join(output, `${id}-${width}.png`), animations: 'disabled'
        });
      }
    }
    console.log(`PASS client layout ${width}px: no overflow or truncated copy; both cookie halves visible; hero frames overlap`);
  }
  assert.deepEqual(errors, []);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
