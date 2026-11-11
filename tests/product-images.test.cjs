const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { validProductImage } = require('../catalog-model.js');
const origin = 'https://dkllcttqkyazbkqygixv.supabase.co';
const path = 'products/12345678-1234-4234-8234-123456789abc.webp';
const image = `${origin}/storage/v1/object/public/product-images/${path}`;
function setup(status=200, overrides={}) {
 const calls=[];
 const bitmap={width:3200,height:1600,close(){this.closed=true;}};
 const canvas={getContext:()=>({drawImage(){}}),toBlob:fn=>fn(new Blob(['safe'],{type:'image/webp'}))};
 const window={MARAVI_CONFIG:{supabaseUrl:origin,supabasePublishableKey:'sb_publishable_test'},crypto:{randomUUID:()=>path.slice(9,-5)},createImageBitmap:async()=>bitmap,document:{createElement:()=>canvas},...overrides};
 vm.runInNewContext(fs.readFileSync(require.resolve('../backend-client.js'),'utf8'),{window,URL,Uint8Array,AbortController,setTimeout,clearTimeout,fetch:async(...args)=>{calls.push(args);return {ok:status===200,status};}});
 return {api:window.MaraviBackend,calls,bitmap,canvas};
}
const file=()=>new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'});
test('image allowlist rejects arbitrary origins, traversal, query, scripts and non-WebP',()=>{
 assert.equal(validProductImage(image),true);assert.equal(validProductImage('assets/classic-nutella.webp'),true);
 for(const bad of [image+'?x=1',image+'#a',image.replace('.co/','.co.evil/'),image.replace('https:','http:'),image.replace('products/','products/../products/'),image.replace('.webp','.svg'),image.replace('public/','sign/'),image.replace('12345678','%31'+'2345678'), 'data:image/webp,xxx','assets/../x.webp',null])assert.equal(validProductImage(bad),false,String(bad));
});
test('upload requires session and bounded raster input before network',async()=>{
 const {api,calls}=setup();
 await assert.rejects(api.uploadProductImage('',file()),e=>e.status===401);
 for(const bad of [new Blob(['svg'],{type:'image/svg+xml'}),new Blob(['not jpeg'],{type:'image/jpeg'}),new Blob([],{type:'image/png'}),{type:'image/png',size:5242881,arrayBuffer(){}}])await assert.rejects(api.uploadProductImage('token',bad));
 assert.equal(calls.length,0);
});
test('upload decodes, rescales, reencodes and sends immutable unique WebP',async()=>{
 const {api,calls,bitmap,canvas}=setup();const result=await api.uploadProductImage('token',file());
 assert.equal(result.image,image);assert.equal(result.path,path);assert.equal(bitmap.closed,true);assert.equal(canvas.width,1600);assert.equal(canvas.height,800);
 assert.equal(calls[0][0],`${origin}/storage/v1/object/product-images/${path}`);
 const req=calls[0][1];assert.equal(req.headers.Authorization,'Bearer token');assert.equal(req.headers['x-upsert'],'false');assert.equal(req.body.type,'image/webp');assert.equal(req.redirect,'error');assert.equal(req.credentials,'omit');
});
test('upload exposes authorization errors without leaking server body',async()=>{
 for(const status of [401,403,409,413,500]){const {api}=setup(status);await assert.rejects(api.uploadProductImage('token',file()),e=>e.status===status);}
});
test('invalid decode, excessive pixels, unsupported encoder and wrong project fail closed',async()=>{
 for(const overrides of [{createImageBitmap:async()=>{throw Error();}},{createImageBitmap:async()=>({width:10000,height:10000,close(){}})},{document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:fn=>fn(new Blob(['png'],{type:'image/png'}))})}},{MARAVI_CONFIG:{supabaseUrl:'https://evil.test',supabasePublishableKey:'sb_publishable_test'}}]){const {api,calls}=setup(200,overrides);await assert.rejects(api.uploadProductImage('token',file()));assert.equal(calls.length,0);}
});
