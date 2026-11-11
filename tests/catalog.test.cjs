const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProducts, sanitizeCart, validOptions, available } = require('../catalog-model.js');
const product = (extra = {}) => ({ id:'cookie', name:'Cookie', category:'Cookies', price_cents:1500, weight:'110g', description:'Chocolate', image:'assets/classic-nutella.webp', active:true, stock:null, custom:null, flavors:[], ...extra });
const box = extra => product({ id:'box', custom:'quarteto', flavors:[{name:'Ninho',active:true},{name:'Coco',active:false}], ...extra });
test('normalizes cents and rejects script paths, duplicate IDs and secret object keys',()=>{
 assert.equal(normalizeProducts([product()])[0].price,15);
 for (const bad of [product({image:'javascript:alert(1)'}),product({price_cents:-1}),product({stock:-1}),box({flavors:[{name:'__proto__',active:true}]})]) assert.throws(()=>normalizeProducts([bad]));
 assert.throws(()=>normalizeProducts([product(),product()]));
});
test('inactive products, exhausted stock and boxes without active flavors are unavailable',()=>{
 assert.equal(available(product({active:false})),false);assert.equal(available(product({stock:0})),false);
 assert.equal(available(box({flavors:[]})),false);assert.equal(available(product()),true);
});
test('box requires exactly four active flavors; simple product cannot receive flavor data',()=>{
 assert.equal(validOptions(box(),{Ninho:4}),true);assert.equal(validOptions(box(),{Ninho:3}),false);
 assert.equal(validOptions(box(),{Coco:4}),false);assert.equal(validOptions(box(),{Ninho:4,Coco:0}),true);
 assert.equal(validOptions(product(),{Ninho:4}),false);assert.equal(validOptions(box(),{Ninho:-1,Coco:5}),false);
});
test('saved cart is trimmed to manual stock across different box combinations',()=>{
 const p=box({stock:3,flavors:[{name:'Ninho',active:true},{name:'Coco',active:true}]});
 const clean=sanitizeCart([{id:'box',qty:2,options:{Ninho:4}},{id:'box',qty:4,options:{Coco:4}}],[p]);
 assert.deepEqual(clean.map(x=>x.qty),[2,1]);
});
test('restored cart drops removed/inactive flavors and normalizes duplicate rows',()=>{
 const entries=[{id:'cookie',qty:1},{id:'cookie',qty:2},{id:'missing',qty:1},{id:'box',qty:1,options:{Coco:4}},{id:'cookie',qty:1.5}];
 assert.deepEqual(sanitizeCart(entries,[product(),box()]),[{id:'cookie',qty:3}]);
 assert.deepEqual(sanitizeCart(entries,[product({active:false})]),[]);
});
test('unlimited catalog still enforces per-cart cap of 99 and sanitizes malformed storage',()=>{
 assert.equal(sanitizeCart([{id:'cookie',qty:100000}],[product()])[0].qty,99);
 assert.deepEqual(sanitizeCart({},[product()]),[]);
});
