const PHONE = '5512981402888';
const DEFAULT_PRODUCTS = [
  {id:'classic-nutella',name:'Classic Nutella',category:'Cookies clássicos',price:15,weight:'Aprox. 110g',description:'Massa clássica de baunilha, chocolate 40% e recheio de Nutella.'},
  {id:'double-chocolate',name:'Double Chocolate',category:'Cookies clássicos',price:14,weight:'Aprox. 110g',description:'Massa de cacau Black 100%, chocolates 40% e branco, com brigadeiro de chocolate branco.'},
  {id:'red-ninho',name:'Red Ninho',category:'Cookies clássicos',price:13,weight:'Aprox. 110g',description:'Massa red velvet com cacau, chocolate branco e brigadeiro de leite em pó Ninho.'},
  {id:'dark-cacau',name:'Dark Cacau',category:'Cookies clássicos',price:16,weight:'Aprox. 110g',description:'Massa de cacau Black e cacau 100% com muito chocolate 40%. Sem recheio.'},
  {id:'kinder-classic',name:'Kinder Classic',category:'Cookies especiais',price:24,weight:'Aprox. 128g',description:'Massa clássica de baunilha, chocolates 40% e branco, creme de Kinder Bueno White e finalização especial.'},
  {id:'rabanada',name:'Rabanada',category:'Cookie natalino',price:13,weight:'Aprox. 120g',description:'Massa clássica de baunilha, manteiga noisette, especiarias, chocolate 40% e doce de leite caseiro.'},
  {id:'selecao-maravi',name:'Seleção Maravi',category:'Cookies tradicionais',price:11.5,weight:'Aprox. 75g · 3 unidades',description:'Uma unidade de cada cookie tradicional. Composição fixa, sem alterações.'},
  {id:'aconchego',name:'Aconchego',category:'Cookies tradicionais',price:15.5,weight:'Aprox. 100g · 4 unidades',description:'Quatro cookies tradicionais à sua escolha. Monte sua combinação.',custom:'aconchego'},
  {id:'cenourito',name:'Cenourito',category:'Caseirinhos',price:16,weight:'Aprox. 170g',description:'Massa de cenoura e brigadeiro de chocolate 50%, finalizado com granulado Melken.'},
  {id:'ninho-frutas',name:'Ninho com Frutas Vermelhas',category:'Cremosos',price:14,weight:'Aprox. 125g',description:'Brigadeiro de Ninho e compota artesanal de frutas vermelhas.'},
  {id:'maracuja-chocolate',name:'Maracujá com Chocolate',category:'Cremosos',price:14,weight:'Aprox. 115g',description:'Mousse de maracujá e ganache de chocolate 40%.'},
  {id:'quarteto-maravi',name:'Quarteto Maravi',category:'Brigadeiros',price:12,weight:'4 unidades · aprox. 84g',description:'Escolha quatro brigadeiros. Duas caixinhas elegíveis saem por R$ 22.',custom:'quarteto'},
  {id:'com-carinho',name:'Bilhete Com Carinho',category:'Para presentear',price:.8,weight:'Bilhete com envelope',description:'Um toque de carinho para acompanhar seu presente.'},
  {id:'feliz-aniversario',name:'Bilhete Feliz Aniversário',category:'Para presentear',price:1.05,weight:'Bilhete com envelope e vela',description:'Para deixar a comemoração completa.'}
];
const DEFAULT_OPTIONS = {
  aconchego:['Baunilha com chocolate 40%','Cacau Black com chocolates 40% e branco','Red Velvet com chocolate branco'],
  quarteto:['Ninho','Moranguinho','Coco tradicional','Chocolate 50%']
};
const backend = window.MaraviBackend;
const catalogModel = window.MaraviCatalog;
const usesBackend = backend.configurationProvided;
let PRODUCTS = usesBackend ? [] : catalogModel.normalizeProducts(DEFAULT_PRODUCTS.map(p => ({
  ...p, price_cents: Math.round(p.price * 100), image: `assets/${p.id}.webp`, active: true,
  stock: null, custom: p.custom || null,
  flavors: (DEFAULT_OPTIONS[p.custom] || []).map(name => ({ name, active: true }))
})));
let catalogReady = !usesBackend;
let checkingOrder = false;
const flavorNames = product => product.flavors.filter(f => f.active).map(f => f.name);
const fmt = value => value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byId = id => document.getElementById(id);
const getProduct = id => PRODUCTS.find(p=>p.id===id);
let cart=[];
try { cart=JSON.parse(localStorage.getItem('maravi-cart-v1')||'[]'); if(!Array.isArray(cart))cart=[]; } catch {}
let activeCategory='Todos';
let customProduct=null;
let customCounts=[];
let toastTimer;

function showToast(message){const el=byId('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2600)}
function saveCart(){try{localStorage.setItem('maravi-cart-v1',JSON.stringify(cart))}catch{}renderCart()}
function renderFilters(){const categories=['Todos',...new Set(PRODUCTS.filter(p=>p.active).map(p=>p.category))];if(!categories.includes(activeCategory))activeCategory='Todos';byId('filters').innerHTML=categories.map(c=>`<button type="button" class="filter-btn ${c===activeCategory?'active':''}" data-filter="${esc(c)}" aria-pressed="${c===activeCategory}">${esc(c)}</button>`).join('')}
function renderProducts(){
  const visible=PRODUCTS.filter(p=>p.active&&(activeCategory==='Todos'||p.category===activeCategory));
  byId('menu-grid').innerHTML=visible.map(p=>`<article class="product-card ${p.category==='Para presentear'?'gift':''}"><img class="product-img" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"><div class="product-body"><span class="product-category">${esc(p.category)}</span><h3>${esc(p.name)}</h3><p class="product-description">${esc(p.description)}</p><small class="product-weight">${esc(p.weight)}</small><div class="product-foot"><strong class="product-price">${fmt(p.price)}</strong><button class="add-btn" type="button" data-add="${esc(p.id)}" aria-label="Adicionar ${esc(p.name)} ao pedido" ${catalogModel.available(p)?'':'disabled'}>${!catalogModel.available(p)?'Indisponível':p.custom?'Montar +':'Adicionar +'}</button></div></div></article>`).join('') || '<p class="catalog-status">Nenhum produto disponível nesta categoria.</p>';
}
function itemDetails(item){if(!item.options)return '';return Object.entries(item.options).filter(([,n])=>n>0).map(([name,n])=>`${n}× ${name}`).join(', ')}
function quartetoEligible(item){return item.id==='quarteto-maravi'&&item.options&&item.options['Chocolate 50%']!==4}
function totals(){const subtotalCents=cart.reduce((sum,item)=>sum+getProduct(item.id).price_cents*item.qty,0);const eligible=cart.filter(quartetoEligible);const count=eligible.reduce((sum,item)=>sum+item.qty,0);const eligibleCents=eligible.reduce((sum,item)=>sum+getProduct(item.id).price_cents*item.qty,0);const discountCents=Math.min(Math.floor(count/2)*200,eligibleCents);return {subtotal:subtotalCents/100,discount:discountCents/100,total:(subtotalCents-discountCents)/100}}
function renderCart(){const count=cart.reduce((sum,item)=>sum+item.qty,0);byId('cart-count').textContent=count;byId('nav-count').textContent=count;byId('mobile-count').textContent=count;byId('mobile-total').textContent=fmt(totals().total);byId('order-button').disabled=!count||!catalogReady||checkingOrder;
  byId('cart-items').innerHTML=count?cart.map((item,index)=>{const p=getProduct(item.id);return `<div class="cart-item"><img class="cart-thumb" src="${esc(p.image)}" alt=""><div class="cart-item-main"><div class="cart-item-name">${esc(p.name)}</div>${item.options?`<div class="cart-item-detail">${esc(itemDetails(item))}</div>`:''}<div class="cart-item-price">${fmt(p.price*item.qty)}</div><div class="qty-row"><button class="qty-btn" type="button" data-qty="${index}" data-delta="-1" aria-label="Diminuir ${esc(p.name)}">−</button><span>${item.qty}</span><button class="qty-btn" type="button" data-qty="${index}" data-delta="1" aria-label="Aumentar ${esc(p.name)}">+</button><button class="remove-btn" type="button" data-remove="${index}">remover</button></div></div></div>`}).join(''):`<div class="empty-cart"><span class="empty-icon">♡</span><strong>Seu pedido começa aqui</strong><p>Escolha os doces que vão deixar o seu dia mais gostoso.</p></div>`;
  const t=totals();byId('cart-totals').innerHTML=`${t.discount?`<div class="total-line discount"><span>Promo Quarteto Maravi</span><strong>− ${fmt(t.discount)}</strong></div>`:''}<div class="total-line grand"><span>Total dos produtos</span><strong>${fmt(t.total)}</strong></div><p class="total-note">Taxa de entrega, se houver, confirmada pelo WhatsApp.</p>`;
}
function canAdd(product){const used=cart.filter(x=>x.id===product.id).reduce((n,x)=>n+x.qty,0);return catalogModel.available(product)&&used<catalogModel.maxQuantity(product)}
function addItem(product,options){if(!canAdd(product)||!catalogModel.validOptions(product,options)){showToast('Quantidade ou sabores indisponíveis. Revise seu pedido.');return false}const key=JSON.stringify(options||null);const existing=cart.find(x=>x.id===product.id&&JSON.stringify(x.options||null)===key);if(existing)existing.qty++;else cart.push({id:product.id,qty:1,...(options?{options}:{})});saveCart();showToast(`${product.name} adicionado ao pedido`);return true}
function openCustom(product){if(!canAdd(product)){showToast('Limite disponível deste produto atingido.');return}customProduct=product;const options=flavorNames(product);customCounts=options.map(()=>0);for(let i=0;i<4;i++)customCounts[i%options.length]++;byId('dialog-title').textContent=product.name;byId('dialog-description').textContent=product.custom==='aconchego'?'Escolha os sabores dos seus 4 cookies tradicionais.':'Escolha os sabores dos seus 4 brigadeiros.';renderCustom();byId('custom-dialog').showModal()}
function renderCustom(){const options=flavorNames(customProduct);byId('dialog-options').innerHTML=options.map((o,i)=>`<div class="option-row"><span>${esc(o)}</span><div class="option-qty"><button type="button" data-option="${i}" data-change="-1" aria-label="Diminuir ${esc(o)}">−</button><strong>${customCounts[i]}</strong><button type="button" data-option="${i}" data-change="1" aria-label="Aumentar ${esc(o)}">+</button></div></div>`).join('');const total=customCounts.reduce((a,b)=>a+b,0);byId('dialog-counter').textContent=`${total} de 4 unidades selecionadas`;byId('dialog-add').disabled=total!==4}
function openCart(){updateConditionalFields();byId('pedido').classList.add('open');byId('cart-backdrop').hidden=false;byId('cart-backdrop').classList.add('open');document.body.style.overflow='hidden'}
function closeCart(){byId('pedido').classList.remove('open');byId('cart-backdrop').classList.remove('open');byId('cart-backdrop').hidden=true;document.body.style.overflow=''}
// The storefront uses the shop's clock, never the visitor's device timezone.
function shopClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    label: `${parts.day}/${parts.month}/${parts.year}`,
    weekday: !['Sat', 'Sun'].includes(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}
function paymentChoices(fulfillment, timing, now = new Date()) {
  if (timing === 'agendar') return [];
  const clock = shopClock(now);
  // Only this delivery window has a restriction. No extra out-of-hours rule.
  if (fulfillment === 'entrega' && clock.weekday && clock.minutes >= 12 * 60 && clock.minutes < 17 * 60) return ['Pix'];
  return ['Pix', 'Cartão de débito', 'Cartão de crédito', 'Dinheiro'];
}
function updateConditionalFields() {
  const form = byId('checkout-form');
  const delivery = form.elements.fulfillment.value === 'entrega';
  const scheduled = form.elements.orderTiming.value === 'agendar';
  const clock = shopClock();
  byId('address-wrap').hidden = !delivery;
  byId('address').required = delivery;
  byId('today-details').hidden = scheduled;
  byId('schedule-details').hidden = !scheduled;
  byId('order-date').dateTime = clock.date;
  byId('order-date').textContent = clock.label;
  byId('delivery-estimate').hidden = !delivery;
  byId('pickup-estimate').hidden = delivery;
  const payment = byId('payment');
  const choices = paymentChoices(form.elements.fulfillment.value, form.elements.orderTiming.value);
  for (const option of payment.options) {
    option.disabled = !!option.value && !choices.includes(option.value);
    option.hidden = option.disabled;
  }
  if (!choices.includes(payment.value)) payment.value = '';
  payment.required = !scheduled;
  payment.disabled = scheduled;
  byId('payment-wrap').hidden = scheduled;
  byId('payment-hint').hidden = !delivery || scheduled;
  byId('payment-hint').textContent = choices.length === 1
    ? 'Para entregas de segunda a sexta, das 12h às 17h, o pagamento é por Pix.'
    : 'Entrega: de segunda a sexta, das 12h às 17h, Pix; das 19h às 22h e aos fins de semana, todas as formas disponíveis.';
  byId('change-wrap').hidden = payment.value !== 'Dinheiro';
  if (payment.value !== 'Dinheiro') byId('change').value = '';
}
function checkoutData() {
  const form = byId('checkout-form');
  return {
    name: byId('customer-name').value.trim(), fulfillment: form.elements.fulfillment.value,
    address: byId('address').value.trim(), orderTiming: form.elements.orderTiming.value,
    date: shopClock().label, payment: byId('payment').value,
    change: byId('change').value.trim(), notes: byId('notes').value.trim()
  };
}
function validateCheckout(data) {
  let message, field;
  if (!data.name) { message = 'Informe seu nome para continuar.'; field = 'customer-name'; }
  else if (data.fulfillment === 'entrega' && !data.address) { message = 'Informe o endereço de entrega.'; field = 'address'; }
  else if (data.orderTiming !== 'agendar' && !paymentChoices(data.fulfillment, data.orderTiming).includes(data.payment)) {
    message = 'Selecione uma forma de pagamento disponível para continuar.'; field = 'payment';
  }
  if (!message) return true;
  byId('form-error').textContent = message;
  byId('form-error').hidden = false;
  byId(field).focus();
  return false;
}
function buildMessage(data) {
  const t = totals();
  const scheduled = data.orderTiming === 'agendar';
  const lines = ['Olá, Maravi! Gostaria de fazer um pedido. ✨', '', `*Nome:* ${data.name}`, '', '*Itens:*'];
  for (const item of cart) {
    const p = getProduct(item.id);
    lines.push(`• ${item.qty}× ${p.name} — ${fmt(p.price * item.qty)}`);
    if (item.options) lines.push(`   Sabores: ${itemDetails(item)}`);
  }
  lines.push('');
  if (t.discount) lines.push(`*Desconto Quarteto Maravi:* − ${fmt(t.discount)}`);
  lines.push(`*Total dos produtos:* ${fmt(t.total)}`, '', `*Recebimento:* ${data.fulfillment === 'entrega' ? 'Entrega' : 'Retirada'}`);
  if (data.fulfillment === 'entrega') lines.push(`*Endereço:* ${data.address}`, '*Taxa de entrega:* a confirmar');
  if (scheduled) {
    lines.push('*Pedido:* agendamento', '*Data e horário:* a combinar pelo WhatsApp', '*Pagamento:* a combinar pelo WhatsApp');
  } else {
    lines.push(`*Pedido:* para hoje (${data.date})`);
    lines.push(data.fulfillment === 'entrega'
      ? '*Estimativa de entrega:* 35–75 minutos, a confirmar pelo WhatsApp'
      : '*Prazo de retirada:* a confirmar pelo WhatsApp');
    lines.push(`*Pagamento:* ${data.payment}`);
    if (data.payment === 'Dinheiro' && data.change) lines.push(`*Troco para:* ${data.change}`);
  }
  if (data.notes) lines.push(`*Observações:* ${data.notes}`);
  lines.push('', 'Podem confirmar a disponibilidade, o prazo e o valor final?');
  return lines.join('\n');
}

byId('filters').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;activeCategory=button.dataset.filter;renderFilters();renderProducts()});
byId('menu-grid').addEventListener('click',event=>{const button=event.target.closest('[data-add]');if(!button)return;const product=getProduct(button.dataset.add);if(!catalogReady||!catalogModel.available(product))return;if(product.custom)openCustom(product);else addItem(product)});
byId('cart-items').addEventListener('click',event=>{const remove=event.target.closest('[data-remove]');if(remove){cart.splice(Number(remove.dataset.remove),1);saveCart();return}const qty=event.target.closest('[data-qty]');if(!qty)return;const index=Number(qty.dataset.qty);if(Number(qty.dataset.delta)>0&&!canAdd(getProduct(cart[index].id))){showToast('Limite disponível deste produto atingido.');return}cart[index].qty+=Number(qty.dataset.delta);if(cart[index].qty<=0)cart.splice(index,1);saveCart()});
byId('dialog-options').addEventListener('click',event=>{const button=event.target.closest('[data-option]');if(!button)return;const i=Number(button.dataset.option),delta=Number(button.dataset.change),total=customCounts.reduce((a,b)=>a+b,0);if(customCounts[i]+delta<0||delta>0&&total>=4)return;customCounts[i]+=delta;renderCustom()});
byId('dialog-add').addEventListener('click',()=>{const options=Object.fromEntries(flavorNames(customProduct).map((name,i)=>[name,customCounts[i]]));addItem(customProduct,options);byId('custom-dialog').close();if(matchMedia('(max-width:800px)').matches)openCart()});
byId('dialog-close').addEventListener('click',()=>byId('custom-dialog').close());
byId('mobile-cart-button').addEventListener('click',openCart);byId('cart-close').addEventListener('click',closeCart);byId('cart-backdrop').addEventListener('click',closeCart);
document.querySelector('.nav-order').addEventListener('click',event=>{if(matchMedia('(max-width:800px)').matches){event.preventDefault();openCart()}});
document.querySelectorAll('input[name="fulfillment"], input[name="orderTiming"]').forEach(x=>x.addEventListener('change',updateConditionalFields));byId('payment').addEventListener('change',updateConditionalFields);
byId('checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (checkingOrder) return;
  const error = byId('form-error');
  error.hidden = true;
  if (!cart.length) { error.textContent = 'Escolha pelo menos um produto.'; error.hidden = false; return; }
  updateConditionalFields();
  const data = checkoutData();
  if (!validateCheckout(data)) return;
  if (usesBackend) {
    checkingOrder = true;
    renderCart();
    try {
      const changed = await refreshCatalog();
      if (changed) {
        error.textContent = 'O cardápio foi atualizado. Confira os itens, sabores, quantidades e valores antes de enviar novamente.';
        error.hidden = false;
        return;
      }
    } catch {
      error.textContent = 'Não foi possível confirmar o cardápio. Tente novamente antes de enviar.';
      error.hidden = false;
      return;
    } finally { checkingOrder = false; renderCart(); }
  }
  if (!cart.length) return;
  // Recheck the clock and form after the asynchronous catalog refresh.
  updateConditionalFields();
  const latest = checkoutData();
  if (!validateCheckout(latest)) return;
  if (JSON.stringify(latest) !== JSON.stringify(data)) {
    error.textContent = 'Os detalhes do pedido foram atualizados. Confira antes de enviar novamente.';
    error.hidden = false;
    return;
  }
  window.location.href = `https://wa.me/${PHONE}?text=${encodeURIComponent(buildMessage(latest))}`;
});
async function refreshCatalog(){
  const before=JSON.stringify({cart,prices:cart.map(x=>[getProduct(x?.id)?.price_cents,getProduct(x?.id)?.name])});
  const response=await backend.getPublicCatalog();
  const products=catalogModel.normalizeProducts(response?.catalog?.products);
  PRODUCTS=products;catalogReady=true;cart=catalogModel.sanitizeCart(cart,PRODUCTS);
  renderFilters();renderProducts();saveCart();
  return before!==JSON.stringify({cart,prices:cart.map(x=>[getProduct(x?.id)?.price_cents,getProduct(x?.id)?.name])});
}
async function startCatalog(){
  if(!usesBackend){cart=catalogModel.sanitizeCart(cart,PRODUCTS);renderFilters();renderProducts();saveCart();return}
  byId('menu-grid').innerHTML='<p class="catalog-status" role="status">Carregando cardápio…</p>';
  byId('order-button').disabled=true;
  try{const changed=await refreshCatalog();if(changed&&cart.length)showToast('Pedido atualizado conforme o cardápio disponível.')}catch{
    catalogReady=false;byId('menu-grid').innerHTML='<div class="catalog-status" role="alert"><p>Não foi possível carregar o cardápio atualizado.</p><button type="button" id="retry-catalog" class="primary-btn">Tentar novamente</button></div>';
    byId('retry-catalog').addEventListener('click',startCatalog,{once:true});
  }
}
window.addEventListener('focus', updateConditionalFields);
window.addEventListener('pageshow', updateConditionalFields);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateConditionalFields(); });
setInterval(updateConditionalFields, 30000);
updateConditionalFields();startCatalog();
