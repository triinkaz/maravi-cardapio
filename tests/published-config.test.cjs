const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('temporary test publication uses only the public project configuration and remains unindexed',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('config.js','utf8'),{window});
 assert.equal(window.MARAVI_CONFIG.supabaseUrl,'https://dkllcttqkyazbkqygixv.supabase.co');
 assert.match(window.MARAVI_CONFIG.supabasePublishableKey,/^sb_publishable_[A-Za-z0-9_-]+$/);
 for(const file of ['index.html','admin.html']){const html=fs.readFileSync(file,'utf8');assert.match(html,/name="robots" content="noindex,nofollow"/);}
});
test('the two screenshot notices are absent without removing other guidance',()=>{
 const menu=fs.readFileSync('index.html','utf8');const admin=fs.readFileSync('admin.html','utf8');
 for(const html of [menu,admin])assert.doesNotMatch(html,/Ambiente de testes\.|Não faça pedidos reais por este site\.|Fotos enviadas são públicas por URL\.|Publicar alterações atualiza o catálogo deste teste\./);
 assert.match(menu,/Produtos e prazos sujeitos à confirmação pela Maravi\./);
 assert.match(admin,/id="setup-notice"/);assert.match(admin,/Estoque manual\./);assert.match(admin,/id="promotion-notice"/);
});
