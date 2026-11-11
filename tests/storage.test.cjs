const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
test('storage policies enforce admin-only immutable uploads and controlled paths',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to anon, authenticated;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id serial primary key,bucket_id text,name text,unique(bucket_id,name)); alter table storage.objects enable row level security; grant usage on schema storage to anon,authenticated; grant select,insert,update,delete on storage.objects to anon,authenticated; grant usage on sequence storage.objects_id_seq to anon,authenticated;`);
 await db.exec(fs.readFileSync('supabase/schema.sql','utf8'));
 const sql=fs.readFileSync('supabase/product-images.sql','utf8');await db.exec(sql);await db.exec(sql);
 const admin='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 await db.query('insert into auth.users values ($1),($2)',[admin,other]);await db.query('insert into maravi_private.admins(user_id) values ($1)',[admin]);
 const path='products/12345678-1234-4234-8234-123456789abc.webp';
 async function role(name,id=''){await db.exec(`reset role; set role ${name}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);}
 const insert=(name=path,bucket='product-images')=>db.query('insert into storage.objects(bucket_id,name) values ($1,$2)',[bucket,name]);
 for(const [r,id] of [['anon',''],['authenticated',''],['authenticated',other]]){await role(r,id);await assert.rejects(insert(),e=>e.code==='42501');}
 await role('authenticated',admin);await insert();await assert.rejects(insert(),e=>e.code==='23505');
 for(const bad of ['products/a.svg','../'+path,path+'?x=1',path.replace('.webp','.jpg'),path.replace('products/','products/../products/')])await assert.rejects(insert(bad),e=>e.code==='42501');
 await assert.rejects(insert(path,'other-bucket'),e=>e.code==='42501');
 assert.equal((await db.query('update storage.objects set name=$1',[path+'new'])).affectedRows,0);
 assert.equal((await db.query('delete from storage.objects')).affectedRows,0);
 await assert.rejects(db.query('select * from maravi_private.admins'),e=>e.code==='42501');
 const catalog=(await db.query('select public.admin_get_catalog() as data')).rows[0].data;
 catalog.catalog.products[0].image=`https://dkllcttqkyazbkqygixv.supabase.co/storage/v1/object/public/product-images/${path}`;
 await db.query('select public.admin_save_catalog(1,$1)',[catalog.catalog]);
 for(const suffix of ['?query=1','#fragment','/../x.webp']){const bad=structuredClone(catalog.catalog);bad.products[0].image+=suffix;await assert.rejects(db.query('select public.admin_save_catalog(2,$1)',[bad]),e=>e.code==='22023');}
 await role('postgres');const bucket=(await db.query('select * from storage.buckets')).rows[0];assert.equal(bucket.public,true);assert.equal(bucket.file_size_limit,5242880);assert.deepEqual(bucket.allowed_mime_types,['image/webp']);
 await db.query('delete from maravi_private.admins where user_id=$1',[admin]);await role('authenticated',admin);await assert.rejects(insert(path.replace('12345678','87654321')),e=>e.code==='42501');
 } finally {await db.close();}
});
