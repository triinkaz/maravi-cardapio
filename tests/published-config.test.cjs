const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('temporary test publication uses only the public project configuration and clear notices',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('config.js','utf8'),{window});
 assert.equal(window.MARAVI_CONFIG.supabaseUrl,'https://dkllcttqkyazbkqygixv.supabase.co');
 assert.match(window.MARAVI_CONFIG.supabasePublishableKey,/^sb_publishable_[A-Za-z0-9_-]+$/);
 for(const file of ['index.html','admin.html']){const html=fs.readFileSync(file,'utf8');assert.match(html,/name="robots" content="noindex,nofollow"/);assert.match(html,/Ambiente de testes/);}
});
