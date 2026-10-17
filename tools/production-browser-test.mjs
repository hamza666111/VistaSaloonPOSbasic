import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {chromium} from '@playwright/test';
const db=new PGlite();let server,vite,browser;
const actor=randomUUID(),team=randomUUID(),cut=randomUUID();const email='admin@vistasaloon.local',password='VistaLocal123!';
const user={id:actor,email,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString()};
const token=[{alg:'HS256',typ:'JWT'},{sub:actor,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600},'test-only-signature'].map(x=>typeof x==='string'?x:Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
let failSave=false,loseAck=false,holdRead=false,releaseRead,readHeld;let mutationCalls=0;
const errors=[],external=[];
const rpc=(name,b)=>db.transaction(async tx=>{
 await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
 const args={pos_snapshot:['select public.pos_snapshot() data',[]],pos_mutate:['select public.pos_mutate($1,$2,$3,$4::jsonb,$5,$6) data',[b.p_request_id,b.p_entity,b.p_operation,JSON.stringify(b.p_record),b.p_expected_version,b.p_pin_token]],get_service_category_catalog:['select public.get_service_category_catalog() data',[]],get_app_settings:['select public.get_app_settings($1) data',[b.p_known_version??null]],pos_set_pin:['select public.pos_set_pin($1,$2) data',[b.p_current,b.p_next]],pos_authorize_invoice:['select public.pos_authorize_invoice($1,$2,$3) data',[b.p_id,b.p_action,b.p_pin]]};
 if(!args[name])throw new Error('Unexpected RPC '+name);return (await tx.query(...args[name])).rows[0].data;
});
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create publication supabase_realtime;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function public.gen_salt(text,integer) returns text language sql as $$select 'test-only'::text$$;create function public.crypt(text,text) returns text language sql as $$select md5($1)$$;`);
 for(const f of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort())await db.exec((await readFile('supabase/migrations/'+f,'utf8')).replaceAll('create extension if not exists "pgcrypto";',''));
 await db.query('insert into auth.users(id)values($1)',[actor]);await db.query('insert into private.pos_members(user_id)values($1)',[actor]);await db.query('insert into public.barbers(id,name)values($1,$2)',[team,'Stylist']);await db.query('insert into public.services(id,name,price)values($1,$2,500)',[cut,'Test Cut']);
 await db.exec(`insert into public.invoices("customerName",subtotal,total)select 'Historical '||n,100,100 from generate_series(1,1005)n;`);
 server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','POST,GET,PUT,OPTIONS');res.setHeader('Content-Type','application/json');if(req.method==='OPTIONS')return res.end('{}');
  try{
   const url=new URL(req.url,'http://localhost');let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text||'{}');
   if(url.pathname==='/auth/v1/token') {if(body.password!==password||body.email!==email){res.statusCode=400;return res.end(JSON.stringify({error:'invalid_grant',error_description:'Invalid credentials'}));}return res.end(JSON.stringify({access_token:token,refresh_token:'local-test-refresh',token_type:'bearer',expires_in:3600,user}));}
   if(url.pathname==='/auth/v1/user')return res.end(JSON.stringify(user));
   if(url.pathname==='/auth/v1/logout'){res.statusCode=204;return res.end();}
   if(!req.headers.authorization?.includes(token)){res.statusCode=403;return res.end(JSON.stringify({code:'42501',message:'Authentication required'}));}
   if(url.pathname==='/rest/v1/customers'){const from=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);const data=await db.query('select id,name,phone from public.customers order by id offset $1 limit $2',[from,limit]);return res.end(JSON.stringify(data.rows));}
   if(!url.pathname.startsWith('/rest/v1/rpc/')){res.statusCode=404;return res.end('{}');}
   const name=url.pathname.split('/').pop();if(name==='pos_mutate'){mutationCalls++;if(failSave){failSave=false;res.statusCode=503;return res.end(JSON.stringify({code:'NETWORK',message:'Test network failure'}));}}
   const data=await rpc(name,body);
   if(name==='pos_snapshot'&&holdRead){holdRead=false;readHeld?.();await new Promise(resolve=>releaseRead=resolve);}
   if(name==='pos_mutate'&&loseAck){loseAck=false;res.statusCode=503;return res.end(JSON.stringify({code:'NETWORK',message:'Test lost acknowledgement'}));}
   res.end(JSON.stringify(data));
  }catch(error){res.statusCode=400;res.end(JSON.stringify({code:error.code||'TEST',message:error.message}));}
 });server.on('upgrade',(_r,s)=>s.destroy());server.listen(0,'127.0.0.1');await once(server,'listening');const api=`http://127.0.0.1:${server.address().port}`,base='http://127.0.0.1:5189';
 vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5189','--strictPort'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_ENABLE_REMOTE_SYNC:'true',VITE_DEMO_MODE:'false',VITE_SUPABASE_URL:api,VITE_SUPABASE_ANON_KEY:'local-test-public-key'}});let output='';vite.stderr.on('data',c=>output+=c);await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error(output)),15000);vite.stdout.on('data',c=>{output+=c;if(output.includes('Local:')){clearTimeout(timeout);resolve();}});});
 browser=await chromium.launch({channel:'chrome',headless:true});const contexts=await Promise.all([browser.newContext(),browser.newContext()]);const pages=await Promise.all(contexts.map(c=>c.newPage()));
 for(const page of pages){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.context().route('**/*',route=>{if(!['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)){external.push(route.request().url());return route.abort();}return route.continue();});await page.goto(base);await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Enter workspace'}).click();await page.getByRole('heading',{name:'Good service starts here.'}).waitFor();await page.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});}
 const [a,b]=pages;const state=p=>p.evaluate(()=>{const s=window.store.getState();return {services:s.services,customers:s.customers,invoices:s.invoices,cart:s.cart,remoteReady:s.remoteReady,isAuthenticated:s.isAuthenticated,pending:s.pendingMutations};});const sync=p=>p.evaluate(()=>window.store.getState().syncData());
 assert.equal((await state(a)).invoices.length,1005);assert.equal((await state(b)).invoices.length,1005);
 await a.evaluate(({cut,team})=>window.store.getState().addToCart({serviceId:cut,serviceName:'Test Cut',price:500,barberId:team,barberName:'Stylist'}),{cut,team});await sync(a);assert.equal((await state(a)).cart.length,1);
 // A delayed pre-save snapshot cannot erase the newly acknowledged record.
 holdRead=true;const held=new Promise(r=>readHeld=r);await a.evaluate(()=>{window.oldRead=window.store.getState().syncData();});await held;
 const client={id:randomUUID(),name:'New Client',phone:'03001234567'};await a.evaluate(c=>window.store.getState().addCustomer(c),client);releaseRead();await a.evaluate(()=>window.oldRead);await a.waitForFunction(id=>window.store.getState().customers.some(c=>c.id===id),client.id);assert.equal((await state(a)).cart.length,1);
 await sync(b);const stale=(await state(b)).services[0];await a.evaluate(record=>window.store.getState().updateService({...record,name:'Updated on A'}),stale);let conflict=await b.evaluate(async record=>{try{await window.store.getState().updateService({...record,name:'Stale B'});return '';}catch(e){return e.message;}},stale);assert.match(conflict,/another device/);assert.equal((await state(b)).services[0].name,'Updated on A');
 // Server failure must neither insert an optimistic sale nor clear the draft.
 const sale={id:randomUUID(),date:new Date().toISOString(),customerName:'Walk-in Customer',items:[{serviceId:cut,serviceName:'Test Cut',price:500,barberId:team,barberName:'Stylist'}],subtotal:500,discount:0,discountType:'amount',discountValue:0,total:500,status:'paid',paymentMode:'cash'};
 failSave=true;let error=await a.evaluate(async invoice=>{try{await window.store.getState().createInvoice(invoice);return '';}catch(e){return e.message;}},sale);assert.match(error,/could not be confirmed/);assert.equal((await state(a)).invoices.some(i=>i.id===sale.id),false);assert.equal((await state(a)).cart.length,1);
 loseAck=true;error=await a.evaluate(async invoice=>{try{await window.store.getState().createInvoice(invoice);return '';}catch(e){return e.message;}},sale);assert.match(error,/could not be confirmed/);
 await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),sale);assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1',[sale.id])).rows[0].n,1);
 await contexts[0].setOffline(true);const calls=mutationCalls;error=await a.evaluate(async()=>{try{await window.store.getState().addService({id:crypto.randomUUID(),name:'Offline',price:1,active:true});return '';}catch(e){return e.message;}});assert.match(error,/Reconnect/);assert.equal(mutationCalls,calls);assert.deepEqual((await state(a)).pending,[]);assert.equal((await state(a)).cart.length,1);await contexts[0].setOffline(false);await sync(a);
 await a.reload();await a.getByRole('heading',{name:'Good service starts here.'}).waitFor();await a.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});assert.equal((await state(a)).cart.length,1);assert.equal((await state(a)).invoices.length,1006);
 // Exercise the real POS controls: a committed save with a lost reply and
 // a page refresh must retain the checkout UUID and produce only one invoice.
 const invoiceCount=(await db.query('select count(*)::int n from public.invoices')).rows[0].n;
 await a.getByLabel('Discount value').fill('12.5');await a.getByLabel('Payment mode').selectOption('online');
 loseAck=true;await a.getByRole('button',{name:'Save only',exact:true}).click();await a.getByRole('alert').filter({hasText:'could not be confirmed'}).waitFor();
 const pendingBill=await a.evaluate(()=>JSON.parse(Object.entries(sessionStorage).find(([key])=>key.startsWith('vistasaloon-bill-draft:'))[1]));assert.ok(pendingBill.checkoutDraft?.id);
 await a.reload();await a.getByRole('heading',{name:'Good service starts here.'}).waitFor();await a.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});assert.equal(await a.getByLabel('Discount value').inputValue(),'12.5');assert.equal(await a.getByLabel('Payment mode').inputValue(),'online');
 await a.getByRole('button',{name:'Save only',exact:true}).click();await a.getByRole('status').filter({hasText:'Invoice saved.'}).waitFor();assert.equal((await state(a)).cart.length,0);assert.equal((await db.query('select count(*)::int n from public.invoices')).rows[0].n,invoiceCount+1);
 // Verify the cryptographic fallback too, never Math.random or timestamp IDs.
 assert.equal(await a.evaluate(async()=>{const {newUuid,isUuid}=await import('/src/utils/uuid.ts');Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});try{const ids=Array.from({length:1000},newUuid);return ids.every(isUuid)&&new Set(ids).size===1000;}finally{delete crypto.randomUUID;}}),true);
 const cache=await a.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('vistasaloon-production')).map(([,value])=>value).join(''));assert.equal(cache.includes(password),false);assert.equal(cache.includes('invoiceEditPin'),false);assert.equal(cache.includes('isAuthenticated'),false);
 assert.equal(await a.evaluate(()=>window.store.getState().updateInvoicePin('','2468')),true);assert.equal(await a.evaluate(id=>window.store.getState().verifyInvoicePin('2468',id,'delete'),sale.id),true);await a.evaluate(id=>window.store.getState().deleteInvoice(id),sale.id);await sync(b);assert.equal((await state(b)).invoices.some(i=>i.id===sale.id),false);assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1 and deleted_at is not null',[sale.id])).rows[0].n,1);
 await a.evaluate(()=>window.store.getState().logout());await a.getByLabel('Email address').waitFor();assert.equal((await state(a)).invoices.length,0);await a.reload();await a.getByLabel('Email address').waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS: real SQL behind two browser stores; Supabase Auth client flow, 1005+ invoices, cart retention, stale snapshots/edits, failed saves, POS lost-ack/reload retries, UUID fallback, offline blocking, refresh restoration, secret-free cache, PIN deletion and logout. External requests blocked.');
}finally{releaseRead?.();await browser?.close();vite?.kill();await new Promise(resolve=>server?server.close(resolve):resolve());await db.close();}
