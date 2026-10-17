import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { chromium } from '@playwright/test';

const root = process.cwd();
const originalFiles = ['src/store/useStore.ts', 'supabase_schema.sql', 'supabase_packages.sql'];
const hashes = await Promise.all(originalFiles.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
const db = new PGlite();
let server, vite, browser;
let failRead = false, failMutation = false, loseAck = false, delayRead = false, releaseRead;
let readDelayed;
const migration = await readFile('supabase/migrations/202610170001_service_categories.sql', 'utf8');
const rpc = async (name, body = {}, role = 'anon') => db.transaction(async tx => {
  await tx.exec(`set local role ${role}`);
  let result;
  if (name === 'get_service_category_catalog') result = await tx.query('select public.get_service_category_catalog() as catalog');
  else if (name === 'mutate_service_category_catalog') result = await tx.query('select public.mutate_service_category_catalog($1,$2,$3,$4,$5,$6) as catalog', [body.p_action, body.p_category_id, body.p_name ?? null, body.p_service_id ?? null, body.p_included ?? null, body.p_expected_version ?? null]);
  else if (name === 'import_service_category_catalog') result = await tx.query('select public.import_service_category_catalog($1::jsonb,$2::jsonb) as catalog', [JSON.stringify(body.p_categories), JSON.stringify(body.p_memberships)]);
  else if(name==='get_app_settings') result=await tx.query('select public.get_app_settings($1) as catalog',[body.p_known_version??null]);
  else if(name==='save_app_settings') result=await tx.query('select public.save_app_settings($1::jsonb,$2) as catalog',[JSON.stringify(body.p_settings),body.p_expected_version??null]);
  else throw new Error('Unknown RPC');
  return result.rows[0].catalog;
});
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.services(id text primary key, name text, price numeric);
    create table public.invoices(id text primary key, total numeric);
    insert into public.services values ('s1','Hair Cut',400), ('s2','Facial',1200);
    insert into public.invoices values ('existing-sale',1600);
    grant usage on schema public to anon, authenticated;
    create publication supabase_realtime;`);
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual((await rpc('get_service_category_catalog')).categories, []);
  assert.equal((await db.query("select count(*)::integer as count from pg_publication_tables where pubname='supabase_realtime'")).rows[0].count,2);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.exec("insert into public.service_categories(id,name) values ('forbidden','Forbidden')"); }), error => error.code === '42501');
  }
  await rpc('mutate_service_category_catalog', { p_action:'add', p_category_id:'starter', p_name:'Hair' });
  await assert.rejects(rpc('mutate_service_category_catalog', {p_action:'add',p_category_id:'duplicate',p_name:'HAIR'}), error => error.code === '23505');
  await assert.rejects(rpc('mutate_service_category_catalog', {p_action:'add',p_category_id:'reserved',p_name:'All services'}), error => error.code === '23514');
  console.log('PASS: migration is repeatable, RPC grants work, direct writes are denied, category names constrained.');
  const appMigration=await readFile('supabase/migrations/202610170002_app_settings.sql','utf8');
  await db.exec(appMigration);await db.exec(appMigration);
  assert.equal((await db.query("select count(*)::integer as count from pg_publication_tables where pubname='supabase_realtime'")).rows[0].count,3);
  await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec("update public.app_settings set salon_name='Forbidden'");}),error=>error.code==='42501');
  assert.equal((await rpc('get_app_settings')).salonName,'Vista Saloon');

  server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Content-Type', 'application/json');
    if (request.method === 'OPTIONS') return response.end('{}');
    const name = request.url.split('/').pop();
    try {
      if (!request.url.startsWith('/rest/v1/rpc/')) { response.statusCode = 404; return response.end('{}'); }
      let text = ''; for await (const chunk of request) text += chunk;
      const body = JSON.parse(text || '{}');
      if (process.env.DEBUG_CATEGORY_SYNC) console.log('RPC', name, body.p_action || '', body.p_name || '');
      const isRead=['get_service_category_catalog','get_app_settings'].includes(name);
      if ((isRead && failRead) || (!isRead && failMutation)) {
        failMutation = false;
        response.statusCode = 503; return response.end(JSON.stringify({code:'NETWORK',message:'Simulated network failure'}));
      }
      const data = await rpc(name, body);
      if (name === 'get_service_category_catalog' && delayRead) {
        delayRead = false;
        readDelayed?.();
        await new Promise(resolve => { releaseRead = resolve; });
      }
      if (!isRead && loseAck) {
        loseAck = false; response.statusCode = 503; return response.end(JSON.stringify({code:'NETWORK',message:'Simulated lost acknowledgement'}));
      }
      response.end(JSON.stringify(data));
    } catch (error) { response.statusCode = 400; response.end(JSON.stringify({code:error.code || 'TEST_ERROR',message:error.message})); }
  });
  server.on('upgrade', (_request, socket) => socket.destroy());
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const api = `http://127.0.0.1:${server.address().port}`;
  const port = 5187;
  let viteOutput = '';
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'], {
    cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    env: {...process.env, VITE_ENABLE_REMOTE_SYNC:'true', VITE_DEMO_MODE:'false', VITE_SUPABASE_URL:api, VITE_SUPABASE_ANON_KEY:'local-test-public-key'},
  });
  vite.stdout.on('data', data => { viteOutput += data; }); vite.stderr.on('data', data => { viteOutput += data; });
  const base = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server did not start: '+viteOutput)), 15000);
    const inspect = data => { if (String(data).includes('Local:')) { clearTimeout(timeout); resolve(); } };
    vite.stdout.on('data', inspect); vite.once('exit', code => { clearTimeout(timeout); reject(new Error('Test server exited '+code+viteOutput)); });
  });
  browser = await chromium.launch({channel:'chrome',headless:true});
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const [a,b] = pages;
  const errors = [];
  for (const page of pages) {
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.context().route('**/*', route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    await page.goto(base + '/tools/category-sync-harness.html');
    await page.waitForFunction(() => window.catalog?.getState().remoteReady);
  }
  const state = page => page.evaluate(() => { const s = window.catalog.getState(); return {categories:s.categories,serviceCategories:s.serviceCategories,remoteReady:s.remoteReady,isSaving:s.isSaving,syncError:s.syncError}; });
  const sync = page => page.evaluate(() => window.catalog.getState().sync());
  const businessBefore = await a.evaluate(() => ({services:window.sales.getState().services,cart:window.sales.getState().cart}));
  await a.getByLabel('New category', {exact:true}).fill('Shared styles');
  await a.getByRole('button', {name:'Add category',exact:true}).click();
  await a.waitForFunction(() => window.catalog.getState().categories.some(category => category.name === 'Shared styles'));
  const id = (await state(a)).categories.find(category => category.name === 'Shared styles').id;
  await b.evaluate(() => window.dispatchEvent(new Event('focus')));
  await b.waitForFunction(() => window.catalog.getState().categories.some(category => category.name === 'Shared styles'));
  await Promise.all([
    a.evaluate(id => window.catalog.getState().setMembership('s1',id,true), id),
    b.evaluate(id => window.catalog.getState().setMembership('s2',id,true), id),
  ]);
  await sync(a); await sync(b);
  assert.ok((await state(a)).serviceCategories.s1.includes(id));
  assert.ok((await state(a)).serviceCategories.s2.includes(id));
  console.log('PASS: independent browsers share categories and merge concurrent assignment changes.');

  await rpc('mutate_service_category_catalog',{p_action:'add',p_category_id:'polled',p_name:'Polling fallback'});
  await b.waitForFunction(() => window.catalog.getState().categories.some(category => category.id === 'polled'), undefined, {timeout:20000});
  console.log('PASS: polling recovers updates when Realtime is unavailable.');
  await b.evaluate(() => window.stopCatalog());
  await a.evaluate(id => window.catalog.getState().renameCategory(id,'Updated elsewhere'), id);
  await assert.rejects(b.evaluate(id => window.catalog.getState().renameCategory(id,'Stale overwrite'), id), /changed on another device/);
  await b.waitForFunction(() => window.catalog.getState().categories.some(category => category.name === 'Updated elsewhere'));
  assert.ok(!(await state(b)).categories.some(category => category.name === 'Stale overwrite'));
  await assert.rejects(a.evaluate(id => window.catalog.getState().setMembership('missing-service',id,true),id), /not available in the shared catalog/);
  console.log('PASS: stale renames are rejected and missing services cannot create invalid assignments.');

  await b.getByRole('button', {name:/^Updated elsewhere/}).click();
  await b.getByLabel('Category name', {exact:true}).fill('Unsaved draft');
  await a.evaluate(id => window.catalog.getState().renameCategory(id,'Changed while typing'), id);
  await sync(b);
  assert.equal(await b.getByLabel('Category name', {exact:true}).inputValue(),'Unsaved draft');
  await b.getByRole('button',{name:'Save name',exact:true}).click();
  await b.getByRole('alert').filter({hasText:'changed on another device'}).waitFor();
  await b.getByRole('button',{name:'Use latest name'}).click();
  assert.equal(await b.getByLabel('Category name',{exact:true}).inputValue(),'Changed while typing');
  console.log('PASS: live refresh preserves unsaved name drafts and prevents stale form submissions.');
  await sync(a);
  await a.evaluate(() => window.stopCatalog());
  const delayed = new Promise(resolve => { readDelayed = resolve; });
  delayRead = true;
  console.log('Testing delayed snapshot...');
  const oldRead = sync(a); await Promise.race([delayed, new Promise((_,reject)=>setTimeout(()=>reject(new Error('No delayed read reached the server')),10000))]);
  console.log('Delayed snapshot held; making a concurrent save...');
  await a.evaluate(() => window.catalog.getState().addCategory('Newer than the read'));
  console.log('Concurrent save acknowledged; releasing older snapshot...');
  releaseRead(); await oldRead;
  assert.ok((await state(a)).categories.some(category => category.name === 'Newer than the read'));
  failMutation = true;
  await assert.rejects(a.evaluate(() => window.catalog.getState().addCategory('Must not appear')), /could not be confirmed/);
  await a.waitForFunction(() => !window.catalog.getState().isLoading);
  assert.ok(!(await state(a)).categories.some(category => category.name === 'Must not appear'));
  loseAck = true;
  await assert.rejects(a.evaluate(() => window.catalog.getState().addCategory('Committed despite lost reply')), /could not be confirmed/);
  await a.waitForFunction(() => window.catalog.getState().categories.some(category => category.name === 'Committed despite lost reply'));
  assert.equal((await rpc('get_service_category_catalog')).categories.filter(category => category.name === 'Committed despite lost reply').length,1);
  console.log('PASS: stale reads cannot overwrite saves; failed saves show errors; lost acknowledgements reconcile.');

  await contexts[0].setOffline(true);
  await assert.rejects(a.evaluate(() => window.catalog.getState().addCategory('Offline change')), /offline/);
  await contexts[0].setOffline(false);
  await sync(a);
  const importData = {state:{categories:[{id:'local-1',name:'Genuine local'}],serviceCategories:{s1:['local-1'],'missing-service':['local-1']}}};
  await a.evaluate(data => localStorage.setItem('vistasaloon-categories-v1',JSON.stringify(data)), importData);
  const skipped = await a.evaluate(() => window.catalog.getState().importLocalCategories());
  assert.equal(skipped,1);
  await a.evaluate(() => window.catalog.getState().importLocalCategories());
  assert.equal((await state(a)).categories.filter(category => category.name === 'Genuine local').length,1);
  const beforeBadImport = await rpc('get_service_category_catalog');
  await assert.rejects(rpc('import_service_category_catalog',{p_categories:[{id:'valid',name:'Should roll back'},{id:'invalid',name:''}],p_memberships:[]}));
  assert.deepEqual(await rpc('get_service_category_catalog'),beforeBadImport);
  await a.evaluate(id => window.catalog.getState().removeCategory(id),id);
  assert.equal((await db.query('select count(*)::integer as count from services')).rows[0].count,2);
  assert.equal((await db.query('select total from invoices')).rows[0].total,'1600');
  assert.ok(!Object.values((await state(a)).serviceCategories).flat().includes(id));
  console.log('PASS: offline edits are blocked, local imports merge atomically, category deletion preserves services and invoices.');

  await db.exec("insert into public.services select 'bulk-' || i, 'Bulk service', 1 from generate_series(1,1005) i; insert into public.service_category_memberships select id,'starter' from public.services where id like 'bulk-%'");
  await sync(a);
  assert.equal(Object.keys((await state(a)).serviceCategories).filter(id => id.startsWith('bulk-')).length,1005);
  const beforeRerun = await rpc('get_service_category_catalog');
  await db.exec(migration);
  assert.deepEqual(await rpc('get_service_category_catalog'),beforeRerun);
  failRead = true;
  await sync(a);
  assert.equal((await state(a)).remoteReady,false);
  assert.ok((await state(a)).categories.length > 0);
  assert.equal(await a.getByRole('button',{name:'Add category',exact:true}).isDisabled(),true);
  await a.reload();
  await a.waitForFunction(() => window.catalog?.getState().syncError);
  assert.equal((await state(a)).remoteReady,false);
  assert.ok((await state(a)).categories.length > 0);
  failRead = false;
  await a.getByRole('button',{name:'Retry category sync'}).click();
  await a.waitForFunction(() => window.catalog.getState().remoteReady);
  await db.exec('delete from public.service_categories');
  await sync(a); await sync(b);
  assert.deepEqual((await state(a)).categories,[]);
  assert.deepEqual((await state(a)).serviceCategories,{});
  assert.deepEqual(await a.evaluate(() => ({services:window.sales.getState().services,cart:window.sales.getState().cart})),businessBefore);
  assert.equal(await a.evaluate(() => localStorage.getItem('vistasaloon-demo-categories-v1')),null);
  const keys = await a.evaluate(() => Object.keys(localStorage));
  assert.ok(keys.some(key => key.startsWith('vistasaloon-shared-categories-v1:127.0.0.1:')));
  assert.deepEqual(errors,[]);
  for(let i=0;i<originalFiles.length;i++) assert.equal(createHash('sha256').update(await readFile(originalFiles[i])).digest('hex'),hashes[i]);
  console.log('PASS: snapshots exceed 1,000 assignments, offline cache is read-only, retries recover, empty server catalogs remain empty, demo/cache isolation and billing state are preserved.');
  const [c,d]=await Promise.all(contexts.map(context=>context.newPage()));
  for(const page of [c,d]) {page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.goto(base+'/tools/app-settings-sync-harness.html');await page.waitForFunction(()=>window.settingsStore?.getState().remoteReady);}
  const branding=page=>page.evaluate(()=>window.settingsStore.getState().settings);
  const refreshBrand=page=>page.evaluate(()=>window.settingsStore.getState().sync());
  const originalBrand=await branding(c);
  await d.getByLabel('Salon name',{exact:true}).fill('Unsaved other-device name');
  const logo=await c.evaluate(()=>{const x=document.createElement('canvas');x.width=20;x.height=20;const g=x.getContext('2d');g.fillStyle='#5577aa';g.fillRect(0,0,20,20);return x.toDataURL('image/png');});
  const changedBrand={salonName:'Shared Salon',address:'12 Example Avenue',phone:'+92 300 1234567',themeColor:'#245a91',logoDataUrl:logo};
  await c.evaluate(data=>window.settingsStore.getState().save(data.fields,data.version),{fields:changedBrand,version:originalBrand.version});
  await d.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await d.waitForFunction(()=>window.settingsStore.getState().settings.salonName==='Shared Salon');
  assert.equal((await branding(d)).logoDataUrl,logo);
  assert.equal(await d.title(),'Shared Salon POS System');
  assert.equal(await d.getByLabel('Salon name',{exact:true}).inputValue(),'Unsaved other-device name');
  await d.getByRole('button',{name:'Save app settings',exact:true}).click();
  await d.getByRole('alert').filter({hasText:'changed on another device'}).waitFor();
  await d.getByRole('button',{name:'Load latest settings',exact:true}).click();
  assert.equal(await d.getByLabel('Salon name',{exact:true}).inputValue(),'Shared Salon');
  const currentBrand=await branding(c);
  assert.deepEqual(await rpc('get_app_settings',{p_known_version:currentBrand.version}),{unchanged:true,version:currentBrand.version});
  await assert.rejects(rpc('save_app_settings',{p_settings:{...changedBrand,themeColor:'red; color: white'},p_expected_version:currentBrand.version}),error=>error.code==='23514');
  await assert.rejects(rpc('save_app_settings',{p_settings:{...changedBrand,logoDataUrl:'data:image/svg+xml;base64,PHN2Zy8+'},p_expected_version:currentBrand.version}),error=>error.code==='23514');
  assert.equal((await rpc('get_app_settings')).themeColor,'#245a91');
  await db.exec(appMigration);assert.equal((await rpc('get_app_settings')).salonName,'Shared Salon');
  failMutation=true;
  await assert.rejects(c.evaluate(data=>window.settingsStore.getState().save({...data.fields,salonName:'Must not be saved'},data.version),{fields:changedBrand,version:currentBrand.version}),/could not be confirmed/);
  await c.waitForFunction(()=>!window.settingsStore.getState().isLoading);
  assert.equal((await branding(c)).salonName,'Shared Salon');
  await contexts[1].setOffline(true);
  await assert.rejects(d.evaluate(data=>window.settingsStore.getState().save(data.fields,data.version),{fields:changedBrand,version:currentBrand.version}),/offline/);
  await d.waitForFunction(()=>window.settingsStore?.getState().syncError);
  assert.equal((await branding(d)).salonName,'Shared Salon');
  assert.equal(await d.getByLabel('Salon name',{exact:true}).isDisabled(),true);
  await contexts[1].setOffline(false);await refreshBrand(d);await d.waitForFunction(()=>window.settingsStore.getState().remoteReady);
  assert.equal((await branding(d)).logoDataUrl,logo);
  assert.deepEqual(errors,[]);
  console.log('PASS: shared app name/address/phone/color/logo across browsers; version conflicts preserve drafts, invalid color/SVG data rejected, compact unchanged reads, safe migration reruns and offline cache recovery.');
  console.log('All PostgreSQL-backed shared-settings tests passed. No real Supabase project was contacted.');
} finally {
  releaseRead?.();
  await browser?.close();
  if(vite && vite.exitCode === null) { vite.kill(); await once(vite,'exit').catch(()=>{}); }
  if(server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
  await db.close();
}
