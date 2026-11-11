const test = require('node:test');
const assert = require('node:assert/strict');
const load = import('../supabase/functions/admin-login/handler.mjs');
const key = 'sb_publishable_test';
const origin = 'https://menu.example.test';
const values = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: key }), MARAVI_ADMIN_USERNAME: 'maravi', MARAVI_ADMIN_EMAIL: 'recovery@example.test', MARAVI_ALLOWED_ORIGINS: origin };
const config = async overrides => (await load).readConfig(name => ({ ...values, ...overrides })[name]);
const req = (body = { username: 'maravi', password: ' spaces stay ' }, extra = {}) => new Request('https://project.supabase.co/functions/v1/admin-login', { method: 'POST', headers: { origin, apikey: key, 'content-type': 'application/json', ...extra.headers }, body: JSON.stringify(body), ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'headers')) });
const json = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const session = { access_token: 'test-session-only', expires_in: 3600, refresh_token: 'never-return-this', user: { email: values.MARAVI_ADMIN_EMAIL } };
const catalog = { revision: 1, catalog: { products: [] } };

test('login config is private, validates origins and requires publishable credentials', async () => {
 assert.ok(await config());
 for (const override of [ { MARAVI_ADMIN_EMAIL: '' }, { MARAVI_ADMIN_USERNAME: 'Bad Username' }, { SUPABASE_URL: 'http://project.supabase.co' }, { SUPABASE_PUBLISHABLE_KEYS: '{broken' }, { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_secret_private' }) }, { MARAVI_ALLOWED_ORIGINS: '*' }, { MARAVI_ALLOWED_ORIGINS: 'https://menu.example.test/path' }, { MARAVI_ALLOWED_ORIGINS: 'http://menu.example.test' }, { MARAVI_ALLOWED_ORIGINS: 'null' } ]) assert.equal(await config(override), null);
 assert.ok(await config({ MARAVI_ALLOWED_ORIGINS: 'http://127.0.0.1:8080,https://menu.example.test' }));
});
test('login fails closed without configuration or an allowed browser origin', async () => {
 const { createHandler } = await load;
 assert.equal((await createHandler(null)(req())).status, 503);
 const handler = createHandler(await config(), () => assert.fail('No upstream call expected'));
 for (const headers of [{ origin: 'https://evil.example' }, { origin: 'null' }, { origin: '' }]) {
  const response = await handler(req(undefined, { headers }));
  assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
 }
 const preflight = await handler(new Request('https://project.supabase.co/functions/v1/admin-login', { method: 'OPTIONS', headers: { origin } }));
 assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin); assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
});
test('login validates method, public key, content type, shape, bounds and actual streamed body bytes', async () => {
 const handler = (await load).createHandler(await config(), () => assert.fail('No upstream call expected'));
 assert.equal((await handler(req(undefined, { method: 'GET', body: undefined }))).status, 405);
 assert.equal((await handler(req(undefined, { headers: { apikey: 'wrong' } }))).status, 401);
 assert.equal((await handler(req(undefined, { headers: { 'content-type': 'text/plain' } }))).status, 415);
 for (const body of [null, [], {}, {username:'maravi',password:1}, {username:'maravi',password:''}, {username:'maravi',password:'x'.repeat(1025)}, {username:'maravi',password:'valid',email:'attacker@example.test'}]) assert.equal((await handler(req(body))).status, 400);
 assert.equal((await handler(req(undefined,{body:'{not json'}))).status,400);
 assert.equal((await handler(req(undefined,{headers:{'content-length':'9000'}}))).status,400);
 const stream = new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(8193)));controller.close();}});
 assert.equal((await handler(req(undefined,{body:stream,duplex:'half'}))).status,400);
});
test('username and incorrect password receive the same generic error without email disclosure', async () => {
 const {createHandler}=await load;
 const unknown=await createHandler(await config(),()=>assert.fail('unknown username does not resolve email'))(req({username:'other',password:'password'}));
 const bad=await createHandler(await config(),async()=>json({message:'private error recovery@example.test'},400))(req());
 assert.equal(unknown.status,401);assert.equal(bad.status,401);assert.deepEqual(await unknown.json(),await bad.json());
});
test('login normalizes only username, verifies the admin allowlist, and strips user/refresh data', async () => {
 const calls=[];
 const handler=(await load).createHandler(await config(),async(url,options)=>{calls.push({url,options});return calls.length===1?json(session):json(catalog);});
 const response=await handler(req({username:' MARAVI ',password:' spaces stay '}));
 assert.equal(response.status,200); assert.deepEqual(await response.json(),{access_token:'test-session-only',expires_in:3600});
 assert.equal(calls[0].url,'https://project.supabase.co/auth/v1/token?grant_type=password');
 assert.deepEqual(JSON.parse(calls[0].options.body),{email:'recovery@example.test',password:' spaces stay '});
 assert.equal(calls[0].options.headers.Authorization,undefined);
 assert.equal(calls[1].url,'https://project.supabase.co/rest/v1/rpc/admin_get_catalog');
 assert.equal(calls[1].options.headers.Authorization,'Bearer test-session-only');
 assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.credentials,'omit');
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('non-admin session is rejected and revoked without returning tokens', async () => {
 const calls=[];
 const handler=(await load).createHandler(await config(),async(url)=>{calls.push(url);return calls.length===1?json(session):calls.length===2?json({code:'42501'},403):new Response(null,{status:204});});
 const response=await handler(req());assert.equal(response.status,401);assert.equal(calls.length,3);assert.match(calls[2],/logout\?scope=local$/);assert.doesNotMatch(await response.text(),/test-session-only|recovery@example/);
});
test('login preserves throttling and hides upstream service failures', async () => {
 const {createHandler}=await load;
 const throttled=await createHandler(await config(),async()=>json({private:'detail'},429,{'retry-after':'30'}))(req());
 assert.equal(throttled.status,429);assert.equal(throttled.headers.get('retry-after'),'30');assert.doesNotMatch(await throttled.text(),/detail/);
 for(const upstream of [async()=>json({private:'detail'},500),async()=>{throw new Error('private network details');},async()=>new Response('not json',{status:200})]){
  const response=await createHandler(await config(),upstream)(req());assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private|detail|recovery@example/);assert.equal(response.headers.get('cache-control'),'no-store');
 }
});
test('malformed expiry and admin response fail closed and clean up sessions', async()=>{
 const {createHandler}=await load;
 for(const expires_in of [0,-1,Infinity,'3600',86401]){
  let calls=0;const response=await createHandler(await config(),async()=>++calls===1?json({...session,expires_in}):new Response(null,{status:204}))(req());assert.equal(response.status,503);assert.equal(calls,2);
 }
 let calls=0;const response=await createHandler(await config(),async()=>++calls===1?json(session):calls===2?json({revision:1}):new Response(null,{status:204}))(req());assert.equal(response.status,503);assert.equal(calls,3);
});
test('frontend sources contain no private email or admin key and have a username-only login field',()=>{
 const fs=require('node:fs');const files=['admin.html','admin.js','backend-client.js','config.js'];
 for(const file of files)assert.doesNotMatch(fs.readFileSync(require('node:path').join(__dirname,'..',file),'utf8'),/rafaelfoschi@|recovery@example|MARAVI_ADMIN_EMAIL|SUPABASE_SECRET_KEYS|SUPABASE_SERVICE_ROLE_KEY/);
 const html=fs.readFileSync(require.resolve('../admin.html'),'utf8');assert.match(html,/id="username" type="text"/);assert.doesNotMatch(html,/id="email"/);
});


test('slow request bodies are cancelled before contacting Auth', async()=>{
 let cancelled=false;
 const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
 const handler=(await load).createHandler(await config(),()=>assert.fail('No upstream request expected'),{bodyTimeoutMs:5});
 const response=await handler(req(undefined,{body:stream,duplex:'half'}));
 assert.equal(response.status,400);assert.equal(cancelled,true);
});

test('username pattern is valid with modern HTML Unicode semantics',()=>{
 const fs=require('node:fs');const html=fs.readFileSync(require.resolve('../admin.html'),'utf8');
 const pattern=html.match(/id="username"[^>]*pattern="([^"]+)"/)[1];
 const regex=new RegExp('^(?:'+pattern+')$','v');
 assert.equal(regex.test('maravi'),true);assert.equal(regex.test('maravi-admin'),true);assert.equal(regex.test('invalid space'),false);
});


test('authorization throttling is not reported as invalid credentials',async()=>{
 let calls=0;const handler=(await load).createHandler(await config(),async()=>++calls===1?json(session):calls===2?json({},429,{'retry-after':'15'}):new Response(null,{status:204}));
 const response=await handler(req());assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'15');assert.equal(calls,3);
});
