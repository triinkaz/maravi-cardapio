const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function setup(instant = '2026-11-11T15:00:00Z', backend) {
  const dom = new JSDOM(read('index.html'), { url: 'https://test.local/', runScripts: 'outside-only' });
  const w = dom.window;
  let now = instant;
  const OriginalDate = w.Date;
  w.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new OriginalDate(now).getTime(); }
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.matchMedia = () => ({ matches: false });
  w.MaraviBackend = backend || { configurationProvided: false };
  w.eval(read('catalog-model.js'));
  w.eval(read('app.js'));
  return { dom, w, doc: w.document, setTime: value => { now = value; } };
}
function choose(w, name, value) {
  const field = w.document.querySelector(`input[name="${name}"][value="${value}"]`);
  field.checked = true;
  field.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function pay(w, value) {
  w.document.getElementById('payment').value = value;
  w.document.getElementById('payment').dispatchEvent(new w.Event('change'));
}
const methods = w => [...w.document.getElementById('payment').options].filter(x => x.value && !x.disabled && !x.hidden).map(x => x.value);
const all = ['Pix', 'Cartão de débito', 'Cartão de crédito', 'Dinheiro'];

test('shop date is fixed to Sao Paulo, read-only and refreshes at midnight', t => {
  const { dom, w, doc, setTime } = setup('2026-11-12T02:59:59Z'); t.after(() => dom.window.close());
  assert.equal(doc.querySelector('#order-date').textContent, '11/11/2026');
  assert.equal(doc.querySelector('#order-date').dateTime, '2026-11-11');
  assert.equal(doc.querySelector('#when, input[type="date"], input[type="time"], input[type="datetime-local"]'), null);
  setTime('2026-11-12T03:00:00Z'); w.dispatchEvent(new w.Event('focus'));
  assert.equal(doc.querySelector('#order-date').textContent, '12/11/2026');
  assert.equal(doc.querySelector('#order-date').dateTime, '2026-11-12');
});

test('weekday delivery restricts only 12:00 <= time < 17:00; weekends, pickup and all other hours stay unrestricted', t => {
  const { dom, w } = setup(); t.after(() => dom.window.close());
  for (const day of ['09', '10', '11', '12', '13']) {
    for (const [time, expected] of [
      ['00:00', all], ['11:59', all], ['12:00', ['Pix']], ['16:59', ['Pix']],
      ['17:00', all], ['18:59', all], ['19:00', all], ['21:59', all], ['22:00', all], ['23:59', all]
    ]) {
      const now = new Date(`2026-11-${day}T${time}:00-03:00`);
      assert.deepEqual(Array.from(w.paymentChoices('entrega', 'hoje', now)), expected, `${day} ${time}`);
      assert.deepEqual(Array.from(w.paymentChoices('retirada', 'hoje', now)), all);
      assert.deepEqual(Array.from(w.paymentChoices('entrega', 'agendar', now)), []);
    }
  }
  for (const day of ['14', '15']) for (const time of ['00:00', '12:00', '16:59', '19:00', '23:59']) {
    assert.deepEqual(Array.from(w.paymentChoices('entrega', 'hoje', new Date(`2026-11-${day}T${time}:00-03:00`))), all);
  }
});

test('delivery/pickup and scheduled/today changes clear invalid payment and change without retaining stale dates', t => {
  const { dom, w, doc } = setup(); t.after(() => dom.window.close());
  assert.deepEqual(methods(w), all);
  pay(w, 'Dinheiro'); doc.querySelector('#change').value = 'R$ 100,00';
  assert.equal(doc.querySelector('#change-wrap').hidden, false);
  choose(w, 'fulfillment', 'entrega');
  assert.deepEqual(methods(w), ['Pix']);
  assert.equal(doc.querySelector('#payment').value, '');
  assert.equal(doc.querySelector('#change').value, '');
  assert.equal(doc.querySelector('#address').required, true);
  assert.equal(doc.querySelector('#delivery-estimate').hidden, false);
  pay(w, 'Pix'); choose(w, 'orderTiming', 'agendar');
  assert.equal(doc.querySelector('#today-details').hidden, true);
  assert.equal(doc.querySelector('#schedule-details').hidden, false);
  assert.equal(doc.querySelector('#payment-wrap').hidden, true);
  assert.equal(doc.querySelector('#payment').required, false);
  assert.equal(doc.querySelector('#payment').disabled, true);
  assert.equal(doc.querySelector('#payment').value, '');
  choose(w, 'fulfillment', 'retirada'); choose(w, 'orderTiming', 'hoje');
  assert.deepEqual(methods(w), all);
  assert.equal(doc.querySelector('#payment').required, true);
  assert.equal(doc.querySelector('#payment').disabled, false);
  assert.equal(doc.querySelector('#today-details').hidden, false);
  assert.equal(doc.querySelector('#address').required, false);
  assert.equal(doc.querySelector('#delivery-estimate').hidden, true);
  assert.equal(doc.querySelector('#pickup-estimate').hidden, false);
});

test('today and scheduled messages match the UI and never duplicate the subtotal', t => {
  const { dom, w, doc } = setup(); t.after(() => dom.window.close());
  doc.querySelector('[data-add="classic-nutella"]').click();
  doc.querySelector('#customer-name').value = 'Teste';
  choose(w, 'fulfillment', 'entrega'); doc.querySelector('#address').value = 'Rua de teste'; pay(w, 'Pix');
  let message = w.buildMessage(w.checkoutData());
  assert.match(message, /para hoje \(11\/11\/2026\)/);
  assert.match(message, /35–75 minutos, a confirmar pelo WhatsApp/);
  assert.match(message, /\*Pagamento:\* Pix/);
  assert.match(message, /\*Taxa de entrega:\* a confirmar/);
  assert.doesNotMatch(message, /Subtotal|Data\/horário desejados/);
  assert.doesNotMatch(doc.querySelector('#cart-totals').textContent, /Subtotal/);
  assert.equal((message.match(/\*Total dos produtos:/g) || []).length, 1);
  choose(w, 'orderTiming', 'agendar');
  message = w.buildMessage(w.checkoutData());
  assert.match(message, /\*Pedido:\* agendamento/);
  assert.match(message, /\*Data e horário:\* a combinar pelo WhatsApp/);
  assert.match(message, /\*Pagamento:\* a combinar pelo WhatsApp/);
  assert.doesNotMatch(message, /11\/11|35–75|para hoje|Troco|\*Pagamento:\* Pix/);
  assert.equal(w.validateCheckout(w.checkoutData()), true);
  choose(w, 'fulfillment', 'retirada'); choose(w, 'orderTiming', 'hoje'); pay(w, 'Dinheiro');
  doc.querySelector('#change').value = '50'; message = w.buildMessage(w.checkoutData());
  assert.match(message, /\*Recebimento:\* Retirada/);
  assert.match(message, /\*Troco para:\* 50/);
  assert.doesNotMatch(message, /Endereço|Taxa de entrega|Estimativa de entrega/);
});

test('quarteto promotion remains correct with one total and an explicit discount', t => {
  const { dom, w, doc } = setup(); t.after(() => dom.window.close());
  for (let i = 0; i < 2; i++) {
    doc.querySelector('[data-add="quarteto-maravi"]').click();
    doc.querySelector('#dialog-add').click();
  }
  assert.deepEqual(JSON.parse(JSON.stringify(w.totals())), { subtotal: 24, discount: 2, total: 22 });
  assert.match(doc.querySelector('#cart-totals').textContent.replace(/\s/g, ' '), /Promo Quarteto Maravi− R\$ 2,00Total dos produtosR\$ 22,00/);
  assert.doesNotMatch(doc.querySelector('#cart-totals').textContent, /Subtotal/);
  const message = w.buildMessage({ orderTiming: 'agendar', fulfillment: 'retirada', name: 'Teste' });
  assert.match(message, /Desconto Quarteto Maravi/);
  assert.doesNotMatch(message, /Subtotal/);
});

test('clock transitions are enforced on focus and again before checkout after a delayed catalog refresh', async t => {
  let finish, requests = 0;
  const product = { id: 'cookie', name: 'Cookie', category: 'Cookies', description: 'Cookie de teste', weight: '100g', price_cents: 1500, image: 'assets/classic-nutella.webp', active: true, stock: null, custom: null, flavors: [] };
  const response = { revision: 1, catalog: { products: [product] } };
  const backend = { configurationProvided: true, getPublicCatalog: () => {
    requests++;
    return requests === 1 ? Promise.resolve(response) : new Promise(resolve => { finish = () => resolve(response); });
  } };
  const { dom, w, doc, setTime } = setup('2026-11-11T14:59:59Z', backend); t.after(() => dom.window.close());
  await settle(); doc.querySelector('[data-add]').click();
  doc.querySelector('#customer-name').value = 'Teste'; choose(w, 'fulfillment', 'entrega');
  doc.querySelector('#address').value = 'Rua teste'; pay(w, 'Dinheiro');
  const submit = () => doc.querySelector('#checkout-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  submit(); submit(); assert.equal(requests, 2, 'double submission stays single-flight');
  setTime('2026-11-11T15:00:00Z'); finish(); await settle();
  assert.equal(doc.querySelector('#payment').value, '');
  assert.match(doc.querySelector('#form-error').textContent, /Selecione uma forma de pagamento disponível/);
  assert.equal(w.location.href, 'https://test.local/');
  setTime('2026-11-11T20:00:00Z'); w.dispatchEvent(new w.Event('focus'));
  assert.deepEqual(methods(w), all);
});
