const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.js');
const defaults = vm.runInNewContext(app.slice(0, app.indexOf('const backend =')) + ';DEFAULT_PRODUCTS');
const seed = JSON.parse(read('supabase/schema.sql').split('$catalog$')[1]).products;

test('client copy appears once and the hero keeps real product photos', () => {
  const dom = new JSDOM(read('index.html'));
  const document = dom.window.document;
  assert.equal(document.querySelector('h1').textContent, 'Artesanal por essência.');
  assert.equal(document.querySelector('.section-heading .eyebrow').textContent, 'Sabor em cada detalhe');
  assert.equal(document.querySelector('.brand-seal > span').textContent, 'MR');
  assert.doesNotMatch(document.body.textContent, /Um carinho em forma|O SABOR DO SEU MOMENTO|Produção artesanal/);
  assert.equal(document.querySelector('.hero-sticker'), null);
  assert.deepEqual([...document.querySelectorAll('.hero-photo')].map(image => image.getAttribute('src')), ['assets/classic-nutella.webp', 'assets/red-ninho.webp']);
  for (const image of document.querySelectorAll('.hero-photo')) {
    assert.ok(image.getAttribute('alt'));
    assert.ok(fs.existsSync(path.join(__dirname, '..', image.getAttribute('src'))));
  }
  dom.window.close();
});

test('initial backend and static catalog have identical descriptions, ingredients, prices and images', () => {
  assert.equal(defaults.length, seed.length);
  for (const product of defaults) {
    const stored = seed.find(item => item.id === product.id);
    assert.equal(stored.description, product.description, product.id);
    assert.equal(stored.price_cents, Math.round(product.price * 100), product.id);
    assert.equal(stored.image, `assets/${product.id}.webp`, product.id);
  }
  for (const id of ['kinder-classic', 'rabanada']) {
    assert.match(defaults.find(item => item.id === id).description, /^Massa clássica de baunilha,/);
  }
  for (const id of ['classic-nutella', 'double-chocolate', 'red-ninho', 'dark-cacau', 'cenourito']) {
    assert.match(defaults.find(item => item.id === id).description, /^Massa /);
  }
  assert.equal(defaults.find(item => item.id === 'selecao-maravi').description, 'Uma unidade de cada cookie tradicional. Composição fixa, sem alterações.');
  assert.equal(defaults.find(item => item.id === 'aconchego').description, 'Quatro cookies tradicionais à sua escolha. Monte sua combinação.');
});

test('long dough descriptions stay complete in the rendered storefront', () => {
  const dom = new JSDOM(read('index.html'), { url: 'https://test.local/', runScripts: 'outside-only' });
  const window = dom.window;
  window.MaraviBackend = { configurationProvided: false };
  window.eval(read('catalog-model.js'));
  window.eval(app);
  for (const id of ['kinder-classic', 'rabanada']) {
    const card = window.document.querySelector(`[data-add="${id}"]`).closest('.product-card');
    assert.equal(card.querySelector('.product-description').textContent, defaults.find(item => item.id === id).description);
  }
  dom.window.close();
});


test('existing catalog update map is scoped to exact prior descriptions', () => {
  const updates = JSON.parse(read('supabase/client-copy-updates.json'));
  assert.equal(updates.length, 5);
  assert.equal(new Set(updates.map(item => item.id)).size, updates.length);
  for (const update of updates) {
    assert.notEqual(update.previous, update.updated);
    assert.equal(seed.find(item => item.id === update.id).description, update.updated);
    assert.equal(defaults.find(item => item.id === update.id).description, update.updated);
  }
});


test('Nutella and Dark Cacau thumbnail framing contains both cookie halves without changing other photos', () => {
  const dom = new JSDOM(`<style>${read('styles.css')}</style>`);
  const { document } = dom.window;
  const styleFor = (src, className = 'product-img') => {
    const image = document.createElement('img');
    image.className = className;
    image.setAttribute('src', src);
    document.body.append(image);
    return dom.window.getComputedStyle(image);
  };
  // Bounds from inspecting the original 360x480 images; simulate the 4:3
  // cover crop at representative mobile and desktop card widths.
  for (const [id, top, bottom] of [
    ['classic-nutella', 212, 414], ['dark-cacau', 248, 442]
  ]) {
    const style = styleFor(`assets/${id}.webp`);
    assert.equal(style.objectFit, 'cover');
    assert.equal(style.aspectRatio, '4/3');
    assert.equal(style.objectPosition, '50% 88%');
    for (const width of [140, 180, 240, 320]) {
      const height = width * 3 / 4;
      const scale = Math.max(width / 360, height / 480);
      const visibleHeight = height / scale;
      const cropTop = (480 - visibleHeight) * parseFloat(style.objectPosition.split(' ')[1]) / 100;
      assert.ok(cropTop <= top && cropTop + visibleHeight >= bottom, `${id} at ${width}px`);
    }
  }
  for (const id of ['kinder-classic', 'rabanada']) {
    assert.equal(styleFor(`assets/${id}.webp`).objectPosition, '50% 76%');
  }
  assert.equal(styleFor('assets/classic-nutella.webp', 'hero-photo').objectPosition, '50% 65%');
  assert.equal(styleFor('assets/red-ninho.webp').objectPosition, '');
  assert.equal(styleFor('https://test.local/replacement.webp').objectPosition, '');
  dom.window.close();
});
