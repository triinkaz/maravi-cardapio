import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url),'utf8');
await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon, authenticated;`);
await db.exec(schema);
let checks=0;
const admin='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
async function role(name,id=''){await db.exec(`reset role; set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
async function expectError(fn,code){await assert.rejects(fn,e=>{assert.equal(e.code,code);checks++;return true;});}
async function get(fn){return (await db.query(`select public.${fn}() as data`)).rows[0].data;}
await role('anon');
let pub=await get('get_public_catalog');assert.equal(pub.catalog.products.length,14);checks++;
await expectError(()=>db.query('select * from maravi_private.catalog'),'42501');
await expectError(()=>db.query('select * from maravi_private.admins'),'42501');
await expectError(()=>get('admin_get_catalog'),'42501');
await expectError(()=>db.query('select public.admin_save_catalog(1,$1)',[pub.catalog]),'42501');
await role('authenticated',other);
await expectError(()=>get('admin_get_catalog'),'42501');
await expectError(()=>db.query('select public.admin_save_catalog(1,$1)',[pub.catalog]),'42501');
await role('postgres');
await db.query('insert into auth.users(id) values ($1),($2)',[admin,other]);
await db.query('insert into maravi_private.admins(user_id) values ($1)',[admin]);
await role('authenticated',admin);
let original=await get('admin_get_catalog');assert.equal(original.revision,1);checks++;
await expectError(()=>db.query('update maravi_private.catalog set revision=999'),'42501');
await expectError(()=>db.query('insert into maravi_private.admins values ($1)',[other]),'42501');
let modified=structuredClone(original.catalog);
modified.products[0].active=false;
modified.products.find(p=>p.custom==='quarteto').flavors[0].active=false;
let saved=(await db.query('select public.admin_save_catalog($1,$2) as data',[1,modified])).rows[0].data;
assert.equal(saved.revision,2);checks++;
await expectError(()=>db.query('select public.admin_save_catalog(1,$1)',[original.catalog]),'40001');
await role('anon');pub=await get('get_public_catalog');assert.equal(pub.catalog.products.length,13);assert.equal(pub.catalog.products.find(p=>p.custom==='quarteto').flavors.length,3);checks+=2;
await role('authenticated',admin);
const invalids=[null,{},[],{products:{}},{products:[],extra:1}];
for(const mutation of [
 p=>p.id='Bad/id',p=>p.name='',p=>p.category=' ',p=>p.description='x'.repeat(1001),p=>p.weight=1,
 p=>p.price_cents=1.5,p=>p.price_cents=-1,p=>p.price_cents=1000001,p=>p.price_cents='100',
 p=>p.stock=-1,p=>p.stock=1.5,p=>p.stock=100000,p=>p.stock='1',p=>p.active='true',
 p=>p.image='https://evil.test/a.webp',p=>p.image='assets/../a.webp',p=>p.custom='other',
 p=>p.flavors=[{name:'flavor',active:true}],p=>delete p.name,p=>p.unknown=1
]) {let c=structuredClone(original.catalog);mutation(c.products[0]);invalids.push(c);}
for(const mutation of [p=>p.flavors=[],p=>p.flavors[0].name='__proto__',p=>p.flavors[0].name='constructor',p=>p.flavors[0].name=' ',p=>p.flavors[1].name=p.flavors[0].name,p=>p.flavors[0].extra=1,p=>p.flavors[0].active=1]){let c=structuredClone(original.catalog);mutation(c.products.find(p=>p.custom));invalids.push(c);}
let dup=structuredClone(original.catalog);dup.products.push(dup.products[0]);invalids.push(dup);
let tooMany=structuredClone(original.catalog);tooMany.products=Array.from({length:201},(_,i)=>({...tooMany.products[0],id:`p-${i}`}));invalids.push(tooMany);
for(const c of invalids)await expectError(()=>db.query('select public.admin_save_catalog(2,$1)',[c]),'22023');
assert.equal((await get('admin_get_catalog')).revision,2);checks++;
await role('postgres');await db.exec(schema);await role('authenticated',admin);assert.equal((await get('admin_get_catalog')).revision,2);checks++;
await role('postgres');await db.query('delete from maravi_private.admins where user_id=$1',[admin]);await role('authenticated',admin);await expectError(()=>get('admin_get_catalog'),'42501');
console.log(`PASS: ${checks} database checks (PostgreSQL/PGlite), including schema rerun, authorization, public filtering, revisions and invalid payloads`);
await db.close();
