import type { Invoice } from '../types';
import { newUuid } from '../utils/uuid';

// IndexedDB transactions protect independent tabs from overwriting each other's
// bills. This database is the source of truth for unsynchronized sales; the
// ordinary localStorage snapshot is only a disposable viewing cache.
export interface QueuedInvoice {
  id: string;
  owner: string;
  requestId: string;
  invoice: Invoice;
  createdAt: string;
  status: 'pending'|'blocked';
  error?: string;
  attempts: number;
  nextAttemptAt: number;
  leaseOwner?: string;
  leaseUntil?: number;
}
const scope=import.meta.env.VITE_SUPABASE_URL ? new URL(import.meta.env.VITE_SUPABASE_URL).host : 'local';
const databaseName=`vistasaloon-invoice-outbox-v1:${scope}`;
const eventName=`${databaseName}:changed`;
let database:Promise<IDBDatabase>|null=null;
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(eventName):null;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function openDatabase():Promise<IDBDatabase>{
  if(!database)database=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB){reject(new Error('Browser storage is unavailable. Keep this bill open and enable browser storage before saving.'));return;}
    const request=indexedDB.open(databaseName,2);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('invoices')){const store=request.result.createObjectStore('invoices',{keyPath:'id'});store.createIndex('owner','owner');}if(!request.result.objectStoreNames.contains('acknowledgements'))request.result.createObjectStore('acknowledgements',{keyPath:'owner'});};
    request.onerror=()=>{database=null;reject(new Error('Unable to open the local invoice queue. Keep the bill open.'));};
    request.onblocked=()=>{database=null;reject(new Error('Close older app tabs so the local invoice queue can open.'));};
    request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();database=null;};resolve(db);};
  });
  return database;
}
async function transaction<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore,resolve:(value:T)=>void,tx:IDBTransaction)=>void,stores=['invoices']):Promise<T>{
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(stores,mode,{durability:'strict'});
    let result:T;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(new Error('The invoice could not be stored safely on this device. Browser storage may be full or disabled. Keep this bill open.'));
    tx.onerror=()=>{/* onabort handles failed transactions; never acknowledge early. */};
    try{work(tx.objectStore('invoices'),value=>{result=value;},tx);}catch(error){tx.abort();reject(error);}
  });
}
function announce(){
  window.dispatchEvent(new Event(eventName));
  channel?.postMessage('changed');
  // Storage events are a fallback for browsers without BroadcastChannel.
  if(!channel)try{localStorage.setItem(eventName,newUuid());}catch{/* IndexedDB commit has already succeeded. */}
}
export function onOutboxChange(listener:()=>void){
  const storage=(event:StorageEvent)=>{if(event.key===eventName)listener();};
  window.addEventListener(eventName,listener);channel?.addEventListener('message',listener);window.addEventListener('storage',storage);
  return ()=>{window.removeEventListener(eventName,listener);channel?.removeEventListener('message',listener);window.removeEventListener('storage',storage);};
}
// Read entries and the acknowledged server floor in ONE transaction. A stale
// HTTP response cannot hide a bill another tab has just uploaded and removed.
export function readInvoiceOutbox(owner:string):Promise<{entries:QueuedInvoice[];revision:number}>{
  return transaction('readonly',(store,done,tx)=>{
    const rows=store.index('owner').getAll(owner);const metadata=tx.objectStore('acknowledgements').get(owner);
    let entries:QueuedInvoice[]|undefined;let revision:number|undefined;
    const complete=()=>{if(entries&&revision!==undefined)done({entries:entries.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)),revision});};
    rows.onsuccess=()=>{entries=rows.result;complete();};metadata.onsuccess=()=>{revision=metadata.result?.revision||0;complete();};
  },['invoices','acknowledgements']);
}
export async function storeQueuedInvoice(owner:string,invoice:Invoice):Promise<QueuedInvoice>{
  // Strip view-only metadata; the saved payload remains immutable until acknowledged.
  const {syncStatus:_status,syncError:_error,...payload}=invoice;
  const clean=JSON.parse(JSON.stringify(payload)) as Invoice;
  let conflict=false;
  const result=await transaction<QueuedInvoice>('readwrite',(store,done)=>{
    const request=store.get(invoice.id);
    request.onsuccess=()=>{
      const existing=request.result as QueuedInvoice|undefined;
      if(existing){if(existing.owner!==owner||canonical(existing.invoice)!==canonical(clean)){conflict=true;done(existing);}else done(existing);return;}
      const entry:QueuedInvoice={id:invoice.id,owner,requestId:newUuid(),invoice:clean,createdAt:new Date().toISOString(),status:'pending',attempts:0,nextAttemptAt:0};
      store.add(entry);done(entry);
    };
  });
  if(conflict)throw new Error('This invoice UUID already has a different saved bill. Review it in Invoices before starting a new bill.');
  announce();return result;
}
export async function claimQueuedInvoice(owner:string,worker:string):Promise<QueuedInvoice|null>{
  return transaction('readwrite',(store,done)=>{
    const request=store.index('owner').getAll(owner);
    request.onsuccess=()=>{
      const now=Date.now();
      const next=(request.result as QueuedInvoice[]).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).find(entry=>entry.status==='pending'&&entry.nextAttemptAt<=now&&(entry.leaseUntil||0)<=now);
      if(!next){done(null);return;}
      const claimed={...next,leaseOwner:worker,leaseUntil:now+60000,attempts:next.attempts+1};store.put(claimed);done(claimed);
    };
  });
}
export async function acknowledgeQueuedInvoice(id:string,requestId:string,owner:string,revision:number){
  await transaction<void>('readwrite',(store,done,tx)=>{
    const request=store.get(id);request.onsuccess=()=>{if(request.result?.requestId===requestId)store.delete(id);};
    const acknowledgements=tx.objectStore('acknowledgements');const metadata=acknowledgements.get(owner);
    metadata.onsuccess=()=>{acknowledgements.put({owner,revision:Math.max(metadata.result?.revision||0,revision)});done();};
  },['invoices','acknowledgements']);announce();
}
export async function failQueuedInvoice(entry:QueuedInvoice,error:string,blocked:boolean){
  await transaction<void>('readwrite',(store,done)=>{
    const request=store.get(entry.id);request.onsuccess=()=>{
      const current=request.result as QueuedInvoice|undefined;
      if(current?.leaseOwner===entry.leaseOwner&&current.requestId===entry.requestId)store.put({...current,status:blocked?'blocked':'pending',error,leaseOwner:undefined,leaseUntil:0,nextAttemptAt:Date.now()+Math.min(300000,5000*2**Math.min(current.attempts-1,6))});
      done();
    };
  });announce();
}
export async function retryQueuedInvoices(owner:string,includeBlocked=false){
  await transaction<void>('readwrite',(store,done)=>{const request=store.index('owner').getAll(owner);request.onsuccess=()=>{
    for(const entry of request.result as QueuedInvoice[])if(entry.status==='pending'||includeBlocked)store.put({...entry,status:'pending',error:undefined,nextAttemptAt:0});done();
  };});announce();
}
export function mergeQueuedInvoices(invoices:Invoice[],queued:QueuedInvoice[]):Invoice[]{
  const byId=new Map(queued.map(entry=>[entry.id,entry]));
  const result=invoices.map(invoice=>{
    const entry=byId.get(invoice.id);byId.delete(invoice.id);
    if(entry)return {...entry.invoice,syncStatus:entry.status,syncError:entry.error};
    const {syncStatus:_status,syncError:_error,...saved}=invoice;return saved;
  });
  return [...Array.from(byId.values(),entry=>({...entry.invoice,syncStatus:entry.status,syncError:entry.error})),...result];
}
