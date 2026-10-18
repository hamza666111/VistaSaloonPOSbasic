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
let failSave=false,loseAck=false,holdRead=false,releaseRead,readHeld;let mutationCalls=0;let holdUpload=false,uploadHeld,releaseUpload;
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
   if(name==='pos_mutate'&&holdUpload){holdUpload=false;uploadHeld?.();await new Promise(resolve=>releaseUpload=resolve);}
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
 // Failed delivery keeps a durably queued local sale and retries the SAME UUID.
 const sale={id:randomUUID(),date:new Date().toISOString(),customerName:'Walk-in Customer',items:[{serviceId:cut,serviceName:'Test Cut',price:500,barberId:team,barberName:'Stylist'}],subtotal:500,discount:0,discountType:'amount',discountValue:0,total:500,status:'paid',paymentMode:'cash'};
 failSave=true;await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),sale);assert.equal((await state(a)).pending.length,1);assert.equal((await state(a)).invoices.find(i=>i.id===sale.id).syncStatus,'pending');assert.equal((await state(a)).cart.length,1);
 await a.evaluate(()=>window.store.getState().flushPendingMutations());assert.equal((await state(a)).pending.length,0);
 loseAck=true;await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),sale);assert.equal((await state(a)).pending.length,1);
 await a.evaluate(()=>window.store.getState().flushPendingMutations());assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1',[sale.id])).rows[0].n,1);
 let error='';
 await contexts[0].setOffline(true);const calls=mutationCalls;error=await a.evaluate(async()=>{try{await window.store.getState().addService({id:crypto.randomUUID(),name:'Offline',price:1,active:true});return '';}catch(e){return e.message;}});assert.match(error,/Reconnect/);assert.equal(mutationCalls,calls);assert.deepEqual((await state(a)).pending,[]);assert.equal((await state(a)).cart.length,1);await contexts[0].setOffline(false);await sync(a);
 await a.reload();await a.getByRole('heading',{name:'Good service starts here.'}).waitFor();await a.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});assert.equal((await state(a)).cart.length,1);assert.equal((await state(a)).invoices.length,1006);
 // A lost server acknowledgement still completes LOCAL checkout durably.
 // The persisted queue, not a second checkout, resumes after a reload.
 const invoiceCount=(await db.query('select count(*)::int n from public.invoices')).rows[0].n;
 await a.getByLabel('Discount value').fill('12.5');await a.getByLabel('Payment mode').selectOption('online');
 loseAck=true;await a.getByRole('button',{name:'Save only',exact:true}).click();await a.getByRole('status').filter({hasText:'Invoice saved on this device.'}).waitFor();assert.equal((await state(a)).cart.length,0);
 await a.waitForFunction(()=>window.store.getState().pendingMutations.some(entry=>!!entry.error));
 const queuedCheckout=(await state(a)).pending[0];assert.ok(queuedCheckout);assert.equal(queuedCheckout.payload.invoice.discountValue,12.5);
 await a.reload();await a.getByRole('heading',{name:'Good service starts here.'}).waitFor();await a.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});assert.equal((await state(a)).cart.length,0);
 assert.ok((await state(a)).pending.some(entry=>entry.id===queuedCheckout.id),'A reload must retain the durable queue, not just the cached invoice');
 await a.evaluate(()=>window.dispatchEvent(new Event('online')));await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);
 assert.equal((await db.query('select count(*)::int n from public.invoices')).rows[0].n,invoiceCount+1);
 // Same-origin tabs share a transactional queue; reconnecting both tabs must
 // not send/overwrite each other's offline bills or clear them on a read.
 const tab=await contexts[0].newPage();tab.setDefaultTimeout(15000);tab.on('pageerror',e=>errors.push(e.message));await tab.goto(base);await tab.getByRole('heading',{name:'Good service starts here.'}).waitFor();await tab.evaluate(async()=>{window.store=(await import('/src/store/useStore.ts')).useStore;});
 // Another tab's acknowledgement must fence an older HTTP snapshot.
 holdRead=true;const heldAgain=new Promise(resolve=>readHeld=resolve);await tab.evaluate(()=>{window.oldRead=window.store.getState().syncData();});await heldAgain;
 const concurrentSale={...sale,id:randomUUID(),customerName:'Cross-tab snapshot'};
 await tab.evaluate(id=>{window.ghostRemovals=0;window.watchInvoice=window.store.subscribe((next,before)=>{if(before.invoices.some(i=>i.id===id)&&!next.invoices.some(i=>i.id===id))window.ghostRemovals++;});},concurrentSale.id);
 await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),concurrentSale);await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);releaseRead();await tab.evaluate(()=>window.oldRead);await tab.waitForFunction(id=>window.store.getState().invoices.some(i=>i.id===id),concurrentSale.id);assert.equal(await tab.evaluate(()=>{window.watchInvoice();return window.ghostRemovals;}),0);
 await contexts[0].setOffline(true);
 const offlineA={...sale,id:randomUUID(),customerName:'Offline A'},offlineB={...sale,id:randomUUID(),customerName:'Offline B'};
 const callsBefore=mutationCalls;
 await Promise.all([a.evaluate(invoice=>window.store.getState().createInvoice(invoice),offlineA),tab.evaluate(invoice=>window.store.getState().createInvoice(invoice),offlineB)]);
 await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),offlineB);
 await a.waitForFunction(()=>window.store.getState().pendingMutations.length===2);await tab.waitForFunction(()=>window.store.getState().pendingMutations.length===2);assert.equal(mutationCalls,callsBefore);
 const offlineEdit=await a.evaluate(async id=>{try{await window.store.getState().deleteInvoice(id);return '';}catch(e){return e.message;}},offlineA.id);assert.match(offlineEdit,/awaiting sync/);
 // Simulate a browser-storage transaction failure. Checkout must retain the
 // current bill and must not print or claim an additional local save.
 await a.evaluate(({cut,team,existing})=>{window.printCount=0;window.print=()=>window.printCount++;window.store.getState().addToCart({serviceId:cut,serviceName:'Test Cut',price:500,barberId:team,barberName:'Stylist'});window.realOutboxAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(value,...keys){return window.realOutboxAdd.call(this,this.name==='invoices'?{...value,id:existing}:value,...keys);};},{cut,team,existing:offlineA.id});
 await a.getByRole('button',{name:'Save only',exact:true}).click();await a.getByRole('alert').filter({hasText:'could not be stored safely'}).waitFor();assert.equal((await state(a)).cart.length,1);assert.equal((await state(a)).pending.length,2);assert.equal(await a.evaluate(()=>window.printCount),0);
 await a.evaluate(()=>{IDBObjectStore.prototype.add=window.realOutboxAdd;});
 await a.getByRole('button',{name:'Save + Print',exact:true}).click();await a.getByRole('status').filter({hasText:'Invoice saved on this device.'}).waitFor();assert.equal(await a.evaluate(()=>window.printCount),1);assert.equal((await state(a)).cart.length,0);await tab.waitForFunction(()=>window.store.getState().pendingMutations.length===3);
 const printId=(await state(a)).pending.find(entry=>![offlineA.id,offlineB.id].includes(entry.id)).id;
 await a.setViewportSize({width:390,height:844});await a.getByRole('navigation',{name:'Quick navigation'}).getByRole('link',{name:'Invoices',exact:true}).click();await a.getByRole('heading',{name:'Sales & invoices'}).waitFor();
 assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const pendingRow=a.locator('.invoice-row').filter({hasText:'Offline A'});assert.equal(await pendingRow.getByRole('button',{name:'Edit',exact:true}).isDisabled(),true);await pendingRow.locator('[data-label="Customer"]').click();const pendingReceipt=a.getByRole('dialog',{name:'Invoice Receipt'});await pendingReceipt.getByText('Pending sync',{exact:true}).waitFor();await pendingReceipt.getByRole('button',{name:'Close',exact:true}).click();await a.getByRole('navigation',{name:'Quick navigation'}).getByRole('link',{name:'POS',exact:true}).click();await a.setViewportSize({width:1280,height:720});
 await contexts[0].setOffline(false);await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);await tab.waitForFunction(()=>window.store.getState().pendingMutations.length===0);
 assert.equal(mutationCalls,callsBefore+3);assert.equal((await db.query('select count(*)::int n from public.invoices where id in($1,$2)',[offlineA.id,offlineB.id])).rows[0].n,2);
 // A permanent server validation rejection remains visible and is never dropped.
 await db.query('update public.services set active=false where id=$1',[cut]);const blockedSale={...sale,id:randomUUID(),customerName:'Needs review'};
 await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),blockedSale);await a.waitForFunction(id=>window.store.getState().pendingMutations.some(entry=>entry.id===id&&entry.status==='blocked'),blockedSale.id);assert.equal((await state(a)).pending.find(i=>i.id===blockedSale.id).status,'blocked');
 await a.getByRole('status').filter({hasText:'invoice needs attention'}).waitFor();
 await db.query('update public.services set active=true where id=$1',[cut]);await a.getByRole('button',{name:'Retry sync',exact:true}).click();await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1',[blockedSale.id])).rows[0].n,1);
 await tab.close();
 // A reconnect backlog must not block the operator's next local checkout.
 holdUpload=true;const heldUpload=new Promise(resolve=>uploadHeld=resolve);const delayedSale={...sale,id:randomUUID(),customerName:'Slow upload'},nextSale={...sale,id:randomUUID(),customerName:'Next checkout'};
 await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),delayedSale);await heldUpload;await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),nextSale);assert.equal((await state(a)).pending.length,2);releaseUpload();await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);
 // Verify the cryptographic fallback too, never Math.random or timestamp IDs.
 assert.equal(await a.evaluate(async()=>{const {newUuid,isUuid}=await import('/src/utils/uuid.ts');Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});try{const ids=Array.from({length:1000},newUuid);return ids.every(isUuid)&&new Set(ids).size===1000;}finally{delete crypto.randomUUID;}}),true);
 const cache=await a.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('vistasaloon-production')).map(([,value])=>value).join(''));assert.equal(cache.includes(password),false);assert.equal(cache.includes('invoiceEditPin'),false);assert.equal(cache.includes('isAuthenticated'),false);
 assert.equal(await a.evaluate(()=>window.store.getState().updateInvoicePin('','2468')),true);assert.equal(await a.evaluate(id=>window.store.getState().verifyInvoicePin('2468',id,'delete'),sale.id),true);await a.evaluate(id=>window.store.getState().deleteInvoice(id),sale.id);await sync(b);assert.equal((await state(b)).invoices.some(i=>i.id===sale.id),false);assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1 and deleted_at is not null',[sale.id])).rows[0].n,1);
 await contexts[0].setOffline(true);const signedOutSale={...sale,id:randomUUID(),customerName:'Retained across sign-out'};await a.evaluate(invoice=>window.store.getState().createInvoice(invoice),signedOutSale);
 await a.evaluate(()=>window.store.getState().logout());await a.getByLabel('Email address').waitFor();assert.equal((await state(a)).invoices.length,0);
 const storedAfterLogout=await a.evaluate(async owner=>{const {readInvoiceOutbox}=await import('/src/store/invoiceOutbox.ts');return (await readInvoiceOutbox(owner)).entries;},actor);assert.equal(storedAfterLogout.length,1);assert.equal(storedAfterLogout[0].id,signedOutSale.id);assert.equal(await a.evaluate(async()=>{const {readInvoiceOutbox}=await import('/src/store/invoiceOutbox.ts');return (await readInvoiceOutbox(crypto.randomUUID())).entries.length;}),0);
 await contexts[0].setOffline(false);await a.getByLabel('Email address').fill(email);await a.getByLabel('Password',{exact:true}).fill(password);await a.getByRole('button',{name:'Enter workspace'}).click();await a.getByRole('heading',{name:'Good service starts here.'}).waitFor();await a.waitForFunction(()=>window.store.getState().pendingMutations.length===0);assert.equal((await db.query('select count(*)::int n from public.invoices where id=$1',[signedOutSale.id])).rows[0].n,1);
 await a.evaluate(()=>window.store.getState().logout());await a.getByLabel('Email address').waitFor();await a.reload();await a.getByLabel('Email address').waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log('PASS: real SQL behind two browser stores; Supabase Auth client flow, 1005+ invoices, cart retention, stale snapshots/edits, durable offline queue, automatic reconnect, cross-tab leases/snapshot fencing, storage-failure recovery, offline printing/mobile preview, account-isolated queue retention, blocked-row recovery, nonblocking backlog uploads, POS lost-ack/reload retries, UUID fallback, online-only edits, refresh restoration, secret-free cache, PIN deletion and logout. External requests blocked.');
}finally{releaseRead?.();releaseUpload?.();await browser?.close();vite?.kill();await new Promise(resolve=>server?server.close(resolve):resolve());await db.close();}
