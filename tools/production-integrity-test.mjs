import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const actor=randomUUID(),stranger=randomUUID();
const files=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
const embedded=s=>s.replaceAll('create extension if not exists "pgcrypto";','');
let checks=0;
async function rejects(work,code){await assert.rejects(work,e=>e.code===code);checks++;}
async function mutate(entity,operation,record,version=null,request=randomUUID(),token=null){return (await db.query('select public.pos_mutate($1,$2,$3,$4::jsonb,$5,$6) result',[request,entity,operation,JSON.stringify(record),version,token])).rows[0].result;}
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create publication supabase_realtime;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 // PGlite lacks pgcrypto. These TEST-ONLY shims exercise PIN flow and throttling,
 // not bcrypt implementation. Supabase's real pgcrypto must pass staging checks.
 await db.exec(`create function public.gen_salt(text,integer) returns text language sql as $$select 'test-only'::text$$;create function public.crypt(text,text) returns text language sql as $$select md5($1)$$;`);
 for(const f of files.slice(0,-1))await db.exec(embedded(await readFile('supabase/migrations/'+f,'utf8')));
 // Upgrade existing label IDs with actual historical relationships.
 await db.exec(`insert into public.barbers(id,name)values('legacy-team','Stylist');insert into public.services(id,name,price)values('legacy-cut','Cut',400);insert into public.service_packages(id,name,price)values('legacy-deal','Deal',900);insert into public.service_package_items("packageId","serviceName")values('legacy-deal','Cut');insert into public.service_categories(id,name)values('hair','Hair');insert into public.service_category_memberships(service_id,category_id)values('legacy-cut','hair');`);
 const historic=randomUUID();
 await db.query(`insert into public.invoices(id,"customerName",items,subtotal,total)values($1,'Old client',$2::jsonb,400,400)`,[historic,JSON.stringify([{serviceId:'legacy-cut',serviceName:'Cut',price:400,barberId:'legacy-team',barberName:'Stylist'}])]);
 await db.query(`insert into public.invoice_items("invoiceId","serviceId","serviceName",price,"barberId","barberName")values($1,'legacy-cut','Cut',400,'legacy-team','Stylist')`,[historic]);
 const upgrade=embedded(await readFile('supabase/migrations/'+files.at(-1),'utf8'));
 await db.exec(upgrade);
 await db.query('insert into auth.users(id) values($1),($2)',[actor,stranger]);await db.query('insert into private.pos_members(user_id)values($1)',[actor]);
 const legacy=(await db.query('select items from public.invoices where id=$1',[historic])).rows[0].items;
 assert.match(legacy[0].serviceId,/^[0-9a-f-]{36}$/);assert.match(legacy[0].barberId,/^[0-9a-f-]{36}$/);
 assert.equal((await db.query('select "serviceId" from public.invoice_items where "invoiceId"=$1',[historic])).rows[0].serviceId,legacy[0].serviceId);
 await db.exec('set role anon');await rejects(db.query('select * from public.invoices'),'42501');await rejects(db.query('select public.pos_snapshot()'),'42501');await rejects(db.query('select public.get_app_settings()'),'42501');await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger]);await db.exec('set role authenticated');assert.equal((await db.query('select count(*)::int n from public.invoices')).rows[0].n,0);await rejects(db.query('select public.pos_snapshot()'),'42501');await rejects(db.query("select public.mutate_service_category_catalog('add','unauthorized','No')"),'42501');await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');
 await rejects(db.query('delete from public.invoices'),'42501');await rejects(db.query('select * from public.app_users'),'42501');await rejects(db.query('select * from private.pos_members'),'42501');
 const team=await mutate('barbers','add',{id:randomUUID(),name:'Team',active:true,commissionRate:20});
 const service=await mutate('services','add',{id:randomUUID(),name:'New Cut',price:500,active:true});
 const client=await mutate('customers','add',{id:randomUUID(),name:'Client',phone:'03001234567'});
 await rejects(mutate('customers','add',{id:randomUUID(),name:'Duplicate',phone:'0300 1234567'}),'23505');
 const deal=await mutate('packages','add',{id:randomUUID(),name:'Deal',price:800,services:['New Cut','Wash']});
 await rejects(mutate('packages','update',{...deal.record,name:'Corrupt',services:['Good','']},deal.record.version),'22023');
 assert.equal((await db.query('select name from public.service_packages where id=$1',[deal.record.id])).rows[0].name,'Deal');
 assert.equal((await db.query('select count(*)::int n from public.service_package_items where "packageId"=$1',[deal.record.id])).rows[0].n,2);
 const invoice={id:randomUUID(),date:new Date().toISOString(),customerId:client.record.id,customerName:'Client',items:[{serviceId:service.record.id,serviceName:'New Cut',price:500,barberId:team.record.id,barberName:'Team'},{serviceId:deal.record.id,serviceName:'Package: Deal',price:800,barberId:team.record.id,barberName:'Team'}],subtotal:1300,discount:130,discountType:'percent',discountValue:10,total:1170,status:'paid',paymentMode:'cash'};
 const req=randomUUID(),sale=await mutate('invoices','add',invoice,null,req);
 assert.deepEqual(await mutate('invoices','add',invoice,null,req),sale);await rejects(mutate('invoices','add',{...invoice,total:999},null,req),'23505');
 assert.equal((await db.query('select count(*)::int n from public.invoice_items where "invoiceId"=$1',[invoice.id])).rows[0].n,2);
 const bad={...invoice,id:randomUUID(),total:1};await rejects(mutate('invoices','add',bad),'23514');assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1',[bad.id])).rows[0].n,0);
 await rejects(mutate('invoices','remove',{id:invoice.id},sale.record.version),'42501');
 assert.equal((await db.query('select public.pos_set_pin($1,$2) ok',['','2468'])).rows[0].ok,true);
 assert.equal((await db.query('select public.pos_authorize_invoice($1,$2,$3) token',[invoice.id,'update','bad'])).rows[0].token,null);
 const authorize=async(id,action='update')=>(await db.query('select public.pos_authorize_invoice($1,$2,$3) token',[id,action,'2468'])).rows[0].token;
 let token=await authorize(invoice.id);
 await rejects(mutate('invoices','update',{...invoice,total:1},sale.record.version,randomUUID(),token),'23514');
 assert.equal((await db.query('select total::int n from public.invoices where id=$1',[invoice.id])).rows[0].n,1170);
 const edit=await mutate('invoices','update',{...invoice,customerName:'Edited'},sale.record.version,randomUUID(),token);
 await rejects(mutate('invoices','update',invoice,edit.record.version,randomUUID(),token),'42501');
 await rejects(mutate('invoices','status',{id:invoice.id,status:'pending'},sale.record.version),'40001');
 const status=await mutate('invoices','status',{id:invoice.id,status:'pending'},edit.record.version);
 token=await authorize(invoice.id,'delete');await mutate('invoices','remove',{id:invoice.id},status.record.version,randomUUID(),token);
 await rejects(mutate('invoices','update',invoice,status.record.version),'P0002');await rejects(mutate('invoices','add',invoice),'23505');
 assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1 and deleted_at is not null',[invoice.id])).rows[0].n,1);
 let snapshot=(await db.query('select public.pos_snapshot() data')).rows[0].data;assert.equal(snapshot.invoices.some(i=>i.id===invoice.id),false);assert.equal(snapshot.invoices.some(i=>i.id===historic),true);
 await mutate('packages','remove',{id:deal.record.id},deal.record.version);snapshot=(await db.query('select public.pos_snapshot() data')).rows[0].data;assert.equal(snapshot.packages.some(p=>p.id===deal.record.id),false);
 const serviceEdit=await mutate('services','update',{...service.record,name:'Changed'},service.record.version);await rejects(mutate('services','update',service.record,service.record.version),'40001');
 // Cross-entity IDs and physically deleted IDs remain reserved forever.
 await rejects(mutate('barbers','add',{id:service.record.id,name:'Same ID'}),'23505');
 await db.exec('reset role');await db.query('delete from public.services where id=$1',[serviceEdit.record.id]).catch(()=>{}); // Historical FK protects referenced services.
 const disposable=await mutate('customers','add',{id:randomUUID(),name:'Disposable',phone:'03005559999'});await db.query('delete from public.customers where id=$1',[disposable.record.id]);await rejects(mutate('customers','add',{...disposable.record}),'23505');
 await db.exec('insert into public.customers(name,phone) select \'Bulk \'||n,\'031\'||lpad(n::text,8,\'0\') from generate_series(1,1100)n;');
 await db.exec(upgrade); // rerunning THIS upgrade preserves existing PIN, records, memberships, audit.
 await db.exec('set role authenticated');snapshot=(await db.query('select public.pos_snapshot() data')).rows[0].data;assert.ok(snapshot.customers.length>1000);
 assert.ok((await db.query('select public.get_app_settings() data')).rows[0].data.salonName);
 await db.query("select public.mutate_service_category_catalog('add',$1,'Production Category')",[randomUUID()]);
 // Migration replay must preserve the original child deletion behavior.
 await db.exec('reset role');
 const fk=(await db.query("select confdeltype from pg_constraint where contype='f' and conrelid='public.service_package_items'::regclass and confrelid='public.service_packages'::regclass")).rows[0];assert.equal(fk.confdeltype,'c');
 await db.exec('set role authenticated');
 for(let i=0;i<5;i++)assert.equal((await db.query('select public.pos_authorize_invoice($1,$2,$3) token',[historic,'update','wrong'])).rows[0].token,null);
 assert.equal((await db.query('select public.pos_authorize_invoice($1,$2,$3) token',[historic,'update','2468'])).rows[0].token,null,'Correct PIN must also be blocked during lockout');
 await db.exec('reset role');await db.query("update private.pin_attempts set locked_until=now()-interval '1 second' where actor=$1",[actor]);await db.exec('set role authenticated');assert.ok(await authorize(historic));
 const missingId=await db.query("select public.pos_mutate($1,'services','add',jsonb_build_object('id',gen_random_uuid(),'name','Server UUID','price',100),null,null) data",[randomUUID()]);assert.match(missingId.rows[0].data.record.id,/^[0-9a-f-]{36}$/);
 await db.exec('reset role');assert.ok((await db.query('select count(*)::int n from private.pos_audit')).rows[0].n>1100);
 console.log(`PASS: full migration chain, legacy UUID/reference conversion, Auth allowlist/RLS, atomic invoice/deal rollback, retries, version conflicts, PIN scope, recoverable deletion, no ID reuse, >1000 records and upgrade replay (${checks} rejection cases). No live project contacted. PIN cryptography requires real Supabase staging validation.`);
}finally{await db.close();}
