import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const files=(await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort();
const sql=await Promise.all(files.map(file=>readFile(`supabase/migrations/${file}`,'utf8')));
const original=['supabase_schema.sql','supabase_packages.sql','src/store/useStore.ts'];
const hashes=await Promise.all(original.map(async file=>createHash('sha256').update(await readFile(file)).digest('hex')));
const db=new PGlite();
const setup=async db=>db.exec('create role anon; create role authenticated; create role service_role; create publication supabase_realtime;');
// Supabase ships pgcrypto; PGlite provides built-in gen_random_uuid but not that
// extension. Only its installation statement is omitted in this local test.
const embedded=source=>source.replaceAll('create extension if not exists "pgcrypto";','');
const customer='10000000-0000-4000-8000-000000000001';const invoice='20000000-0000-4000-8000-000000000001';
try{
 await setup(db);for(let i=0;i<files.length;i++)await db.exec(embedded(sql[i]));
 assert.equal((await db.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('app_users','barbers','services','customers','invoices','invoice_items','service_packages','service_package_items','service_categories','service_category_memberships','app_settings')")).rows[0].n,11);
 // Core payload checks run as the isolated database owner. Deployment permissions
 // remain untouched and must be validated against the real project's auth model.
 await db.query('insert into public.barbers(id,name,"commissionRate") values ($1,$2,$3)',['team','Generic Stylist',20]);
 await db.query('insert into public.services(id,name,price,duration) values ($1,$2,$3,$4)',['cut','Hair Cut',400,30]);
 await db.query('insert into public.customers(id,name,phone,email,notes,active) values ($1,$2,$3,$4,$5,$6)',[customer,'Example Customer','03001234567','client@example.test','Example note',true]);
 await db.query('update public.customers set active=false where id=$1',[customer]);assert.equal((await db.query('select active from public.customers where id=$1',[customer])).rows[0].active,false);
 await db.query('insert into public.service_packages(id,name,price,active) values ($1,$2,$3,$4)',['deal','Generic Deal',1000,true]);await db.query('insert into public.service_package_items("packageId","serviceName",position) values ($1,$2,$3)',['deal','Hair Cut',0]);
 const items=[{serviceId:'cut',serviceName:'Hair Cut',price:400,barberId:'team',barberName:'Generic Stylist'},{serviceId:'deal',serviceName:'Package: Generic Deal',price:1000,barberId:'team',barberName:'Generic Stylist'}];
 await db.query('insert into public.invoices(id,date,"customerId","customerName",items,subtotal,discount,"discountType","discountValue",total,status,"paymentMode") values ($1,now(),$2,$3,$4::jsonb,1400,140,$5,10,1260,$6,$7)',[invoice,customer,'Example Customer',JSON.stringify(items),'percent','paid','cash']);
 for(const [position,item] of items.entries())await db.query('insert into public.invoice_items("invoiceId","serviceId","serviceName",price,"barberId","barberName",position) values ($1,$2,$3,$4,$5,$6,$7)',[invoice,item.serviceId==='cut'?'cut':null,item.serviceName,item.price,item.barberId,item.barberName,position]);
 await db.query('update public.invoices set status=$1,"paymentMode"=$2 where id=$3',['pending','online',invoice]);assert.equal((await db.query('select total::int total from public.invoices where id=$1',[invoice])).rows[0].total,1260);
 await db.query('select public.mutate_service_category_catalog($1,$2,$3)', ['add','hair','Hair']);await db.query('select public.mutate_service_category_catalog($1,$2,null,$3,true)', ['membership','hair','cut']);await db.query('select public.import_service_category_catalog($1::jsonb,$2::jsonb)',[JSON.stringify([{id:'skin',name:'Skin'}]),'[]']);
 let settings=(await db.query('select public.get_app_settings() settings')).rows[0].settings;await db.query('select public.save_app_settings($1::jsonb,$2)',[JSON.stringify({...settings,salonName:'Verified Salon',phone:'+92 300 1234567'}),settings.version]);
 for(let i=1;i<sql.length;i++)await db.exec(sql[i]);assert.equal((await db.query('select public.get_app_settings() settings')).rows[0].settings.salonName,'Verified Salon');assert.equal((await db.query('select count(*)::int n from public.invoices')).rows[0].n,1);assert.equal((await db.query('select active from public.customers where id=$1',[customer])).rows[0].active,false);
 const permissions=await db.query("select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' order by grantee,table_name,privilege_type");await db.exec(sql.at(-1));assert.deepEqual(await db.query("select grantee,table_name,privilege_type from information_schema.role_table_grants where table_schema='public' order by grantee,table_name,privilege_type"),permissions);
 await assert.rejects(db.exec(embedded(sql[0])),e=>e.code==='55000');await db.exec('rollback;');
 const legacy=new PGlite();try{await setup(legacy);await legacy.exec(embedded(await readFile('supabase_schema.sql','utf8')));await legacy.exec(embedded(await readFile('supabase_packages.sql','utf8')));await legacy.exec("update public.app_users set password='ChangedLocalTestPassword'; insert into public.customers(name,phone) values('Existing Client','03009999999');");for(let i=1;i<sql.length;i++)await legacy.exec(sql[i]);await legacy.exec('update public.customers set active=false;');for(let i=1;i<sql.length;i++)await legacy.exec(sql[i]);assert.equal((await legacy.query('select active from public.customers')).rows[0].active,false);assert.equal((await legacy.query('select password from public.app_users')).rows[0].password,'ChangedLocalTestPassword');}finally{await legacy.close();}
 for(let i=0;i<original.length;i++)assert.equal(createHash('sha256').update(await readFile(original[i])).digest('hex'),hashes[i]);
 console.log(`PASS: ${files.length} migrations initialize an empty database; customer activity, mixed service/deal invoice payloads, categories/import and branding work. Repeated upgrades preserve sales, inactive clients, credentials and permissions. Original billing files unchanged; no live Supabase contacted.`);
}finally{await db.close();}
