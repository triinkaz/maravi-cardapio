const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const product=(extra={})=>({id:'classic-nutella',name:'Classic Nutella',category:'Cookies',description:'Descrição',weight:'100g',price_cents:1500,image:'assets/classic-nutella.webp',active:true,stock:4,custom:null,flavors:[],...extra});
function setup(file){const dom=new JSDOM(read(file),{url:'https://test.local/',runScripts:'outside-only'});const w=dom.window;w.matchMedia=()=>({matches:false});w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.confirm=()=>true;return dom}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function submit(w,id){w.document.getElementById(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}))}
const click=(w,id)=>w.document.getElementById(id).click();
const set=(w,id,v)=>{w.document.getElementById(id).value=v};
function prepareAdmin(backend){const dom=setup('admin.html');dom.window.MaraviBackend=backend;dom.window.eval(read('catalog-model.js'));dom.window.eval(read('admin.js'));return dom}
async function login(w){set(w,'email','test@example.test');set(w,'password','local-test-only');submit(w,'login-form');await settle()}
function backend(overrides={}){return {configured:true,login:async()=>({accessToken:'test-memory-only',expiresAt:Date.now()+3600000}),getAdminCatalog:async()=>({revision:1,catalog:{products:[product()]}}),saveAdminCatalog:async(token,revision,catalog)=>({revision:revision+1,catalog}),logout:async()=>{},...overrides}}
test('admin is closed until configured and no password or session persists',async()=>{
 const dom=prepareAdmin({configured:false});const w=dom.window;assert.equal(w.document.getElementById('login-button').disabled,true);assert.equal(w.document.getElementById('setup-notice').hidden,false);dom.window.close();
 const d=prepareAdmin(backend());await login(d.window);assert.equal(d.window.document.getElementById('workspace').hidden,false);assert.equal(d.window.document.getElementById('password').value,'');assert.equal(d.window.localStorage.length,0);assert.equal(d.window.sessionStorage.length,0);d.window.close();
});
test('admin edit, stock, publication, conflict, reload and signout',async()=>{
 let conflict=false,saves=0;const b=backend({saveAdminCatalog:async(t,r,c)=>{saves++;if(conflict)throw Object.assign(new Error('Conflict'),{status:409});return {revision:r+1,catalog:c}}});const d=prepareAdmin(b),w=d.window;await login(w);
 w.document.querySelector('[data-edit]').click();set(w,'product-name','Cookie atualizado');set(w,'product-stock','0');submit(w,'product-form');assert.match(w.document.getElementById('products').textContent,/Cookie atualizado/);assert.equal(w.document.getElementById('publish').disabled,false);
 click(w,'publish');click(w,'publish');await settle();assert.equal(saves,1);assert.match(w.document.getElementById('revision').textContent,/Versão 2/);assert.equal(w.document.getElementById('publish').disabled,true);
 w.document.querySelector('[data-toggle]').click();conflict=true;click(w,'publish');await settle();assert.match(w.document.getElementById('status').textContent,/Outra sessão/);assert.match(w.document.getElementById('products').textContent,/Cookie atualizado/);
 click(w,'reload');await settle();assert.match(w.document.getElementById('products').textContent,/Classic Nutella/);click(w,'logout');await settle();assert.equal(w.document.querySelectorAll('.product').length,0);assert.equal(w.document.getElementById('workspace').hidden,true);d.window.close();
});
test('admin new box, inactive flavor, deletion cancellation and escaped HTML',async()=>{
 const d=prepareAdmin(backend()),w=d.window;await login(w);click(w,'new-product');set(w,'product-id','caixa-nova');set(w,'product-name','<img src=x onerror=alert(1)>');set(w,'product-category','Caixas');set(w,'product-price','12');set(w,'product-type','quarteto');w.document.getElementById('product-type').dispatchEvent(new w.Event('change'));w.document.querySelector('.flavor-input').value='Ninho';submit(w,'product-form');assert.equal(w.document.querySelectorAll('.product').length,2);assert.equal(w.document.querySelectorAll('#products [onerror]').length,0);
 w.confirm=()=>false;w.document.querySelector('[data-delete="caixa-nova"]').click();assert.equal(w.document.querySelectorAll('.product').length,2);w.confirm=()=>true;w.document.querySelector('[data-delete="caixa-nova"]').click();assert.equal(w.document.querySelectorAll('.product').length,1);d.window.close();
});
test('session expiration clears admin data and ignores delayed save response',async()=>{
 let resolveSave,expire;const d=prepareAdmin(backend({saveAdminCatalog:()=>new Promise(r=>resolveSave=r)})),w=d.window;w.setTimeout=(fn)=>{expire=fn;return 1};await login(w);w.document.querySelector('[data-toggle]').click();click(w,'publish');expire();resolveSave({revision:2,catalog:{products:[product()]}});await settle();assert.equal(w.document.getElementById('workspace').hidden,true);assert.equal(w.document.querySelectorAll('.product').length,0);d.window.close();
});
test('storefront works without backend, restores sanitized cart and respects box size',async()=>{
 const d=setup('index.html'),w=d.window;w.MaraviBackend={configurationProvided:false};w.eval(read('catalog-model.js'));w.localStorage.setItem('maravi-cart-v1',JSON.stringify([{id:'classic-nutella',qty:1},{id:'missing',qty:1}]));w.eval(read('app.js'));assert.equal(w.document.querySelectorAll('.product-card').length,14);assert.equal(w.document.getElementById('cart-count').textContent,'1');w.document.querySelector('[data-add="aconchego"]').click();assert.match(w.document.getElementById('dialog-counter').textContent,/4 de 4/);click(w,'dialog-add');assert.equal(w.document.getElementById('cart-count').textContent,'2');d.window.close();
});
test('live storefront stock cap, inactive products and checkout revalidation',async()=>{
 let p=product({stock:2}),fail=false;const d=setup('index.html'),w=d.window;w.MaraviBackend={configurationProvided:true,getPublicCatalog:async()=>{if(fail)throw new Error('offline');return {revision:1,catalog:{products:[p,product({id:'inactive',active:false})]}}}};w.eval(read('catalog-model.js'));w.eval(read('app.js'));await settle();assert.equal(w.document.querySelectorAll('.product-card').length,1);for(let i=0;i<3;i++)w.document.querySelector('[data-add]').click();assert.equal(w.document.getElementById('cart-count').textContent,'2');set(w,'customer-name','Teste');set(w,'payment','Pix');p=product({stock:1});submit(w,'checkout-form');await settle();assert.match(w.document.getElementById('form-error').textContent,/cardápio foi atualizado/);assert.equal(w.document.getElementById('cart-count').textContent,'1');fail=true;submit(w,'checkout-form');await settle();assert.match(w.document.getElementById('form-error').textContent,/Não foi possível confirmar/);d.window.close();
});
test('configured storefront never falls back to stale defaults on connection failure',async()=>{
 const d=setup('index.html'),w=d.window;w.MaraviBackend={configurationProvided:true,getPublicCatalog:async()=>{throw new Error('offline')}};w.eval(read('catalog-model.js'));w.eval(read('app.js'));await settle();assert.equal(w.document.querySelectorAll('.product-card').length,0);assert.ok(w.document.getElementById('retry-catalog'));assert.equal(w.document.getElementById('order-button').disabled,true);d.window.close();
});

test('live storefront recovers malformed stored cart without blocking catalog load',async()=>{
 const d=setup('index.html'),w=d.window;w.localStorage.setItem('maravi-cart-v1','[null,1,{"id":"missing"}]');w.MaraviBackend={configurationProvided:true,getPublicCatalog:async()=>({revision:1,catalog:{products:[product()]}})};w.eval(read('catalog-model.js'));w.eval(read('app.js'));await settle();assert.equal(w.document.querySelectorAll('.product-card').length,1);assert.equal(w.document.getElementById('cart-count').textContent,'0');d.window.close();
});
