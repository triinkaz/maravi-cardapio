const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../backend-client.js'),'utf8');
function client(config,fetchImpl){const context={URL,atob,AbortController,setTimeout,clearTimeout,fetch:fetchImpl,window:{MARAVI_CONFIG:config}};vm.runInNewContext(source,context);return context.window.MaraviBackend}
const config={supabaseUrl:'https://example.supabase.co',supabasePublishableKey:'sb_publishable_test'};
test('unconfigured clients and secret keys fail closed',()=>{
 assert.equal(client({}).configured,false);assert.equal(client({...config,supabasePublishableKey:'sb_secret_test'}).configured,false);
 assert.equal(client({...config,supabaseUrl:'http://example.com'}).configured,false);
 const jwt='a.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.b';
 assert.equal(client({...config,supabasePublishableKey:jwt}).configured,false);
 const legacy='a.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.b';
 assert.equal(client({...config,supabasePublishableKey:legacy}).configured,false);
});
test('public read sends only public API key and omits credentials',async()=>{
 let args;const api=client(config,async(...input)=>{args=input;return {ok:true,status:200,json:async()=>({revision:1,catalog:{products:[]}})}});
 await api.getPublicCatalog();assert.equal(args[1].headers.Authorization,undefined);assert.equal(args[1].credentials,'omit');assert.equal(args[1].headers.apikey,'sb_publishable_test');
});
test('login returns session only in memory and computes expiration',async()=>{
 let args;const api=client(config,async(...input)=>{args=input;return {ok:true,status:200,json:async()=>({access_token:'ephemeral-test-token',expires_in:3600})}});
 const result=await api.login('maravi','not-a-real-password');assert.equal(result.accessToken,'ephemeral-test-token');assert.ok(result.expiresAt>Date.now());
 assert.equal(args[0],'https://example.supabase.co/functions/v1/admin-login');assert.deepEqual(JSON.parse(args[1].body),{username:'maravi',password:'not-a-real-password'});assert.equal(args[1].headers.Authorization,undefined);
 assert.equal(args[1].redirect,'error');
});
test('login rejects malformed tokens and expiry before exposing a session',async()=>{
 for(const data of [{access_token:1,expires_in:3600},{access_token:'',expires_in:3600},...[-1,0,86401,'3600',null].map(expires_in=>({access_token:'test-token',expires_in}))]){
  const api=client(config,async()=>({ok:true,status:200,json:async()=>data}));
  await assert.rejects(api.login('maravi','test-password'),/Resposta de autenticação inválida/);
 }
});
test('save uses expected revision and token; conflicts expose safe message',async()=>{
 let args;const api=client(config,async(...input)=>{args=input;return {ok:false,status:409,json:async()=>({code:'40001',message:'private server detail'})}});
 await assert.rejects(api.saveAdminCatalog('ephemeral-test-token',2,{products:[]}),e=>e.status===409&&!e.message.includes('private server detail'));
 assert.equal(args[1].headers.Authorization,'Bearer ephemeral-test-token');assert.equal(JSON.parse(args[1].body).expected_revision,2);
});
