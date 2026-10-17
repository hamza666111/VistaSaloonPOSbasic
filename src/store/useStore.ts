import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { isDemoMode } from '../demo/mode';
import { supabase } from '../api/supabase';
import type { Barber, Service, ServicePackage, Customer, Invoice, InvoiceItem } from '../types';
import { DuplicateCustomerError, findDuplicateCustomers } from '../utils/customerDuplicates';
import { initialBarbers, initialServices, initialPackages } from './localDefaults';
import { newUuid, isUuid } from '../utils/uuid';

interface PendingMutation { id: string; type: string; payload: any; createdAt: string; }
type Collection = 'barbers'|'services'|'packages'|'customers'|'invoices';
type Operation = 'add'|'update'|'remove'|'status';
type RecordData = (Barber|Service|ServicePackage|Customer|Invoice) & { version?: number; deleted_at?: string|null };
export interface AppState {
  barbers: Barber[]; services: Service[]; packages: ServicePackage[]; customers: Customer[]; invoices: Invoice[]; cart: InvoiceItem[];
  pendingMutations: PendingMutation[]; lastSyncMessage: string|null; isSaving: boolean; remoteReady: boolean; lastVerifiedUserId: string|null; authInitializing: boolean; cacheWarning: string|null;
  isAuthenticated: boolean; userEmail: string; userPassword: string; userId: string|null; invoiceEditPin: string;
  addBarber: (record: Barber)=>Promise<void>; updateBarber: (record: Barber)=>Promise<void>; removeBarber: (id:string)=>Promise<void>;
  addService: (record: Service)=>Promise<void>; updateService: (record: Service)=>Promise<void>; removeService: (id:string)=>Promise<void>;
  addPackage: (record: ServicePackage)=>Promise<void>; updatePackage: (record: ServicePackage)=>Promise<void>; removePackage: (id:string)=>Promise<void>;
  addCustomer: (record: Customer)=>Promise<void>; updateCustomer: (record: Customer)=>Promise<void>; removeCustomer: (id:string)=>Promise<void>;
  createInvoice: (record: Invoice)=>Promise<void>; updateInvoice: (record: Invoice)=>Promise<void>; deleteInvoice: (id:string)=>Promise<void>;
  updateInvoiceStatus: (id:string,status:Invoice['status'])=>Promise<void>;
  reorderServices: (from:number,to:number)=>void; reorderPackages: (from:number,to:number)=>void;
  addToCart: (item:InvoiceItem)=>void; removeFromCart: (index:number)=>void; clearCart: ()=>void;
  login: (email:string,password:string)=>Promise<boolean>; logout: ()=>void;
  updateCredentials: (email:string,password:string)=>Promise<void>;
  verifyInvoicePin: (pin:string,id?:string,action?:'edit'|'delete')=>Promise<boolean>;
  updateInvoicePin: (current:string,next:string)=>Promise<boolean>;
  syncData: ()=>Promise<void>; flushPendingMutations: ()=>Promise<void>; enqueuePendingMutation:(mutation:PendingMutation)=>void;
}
const scope = supabase ? new URL(import.meta.env.VITE_SUPABASE_URL).host : '';
const STORAGE_KEY = supabase ? `vistasaloon-production-v2:${scope}` : isDemoMode ? 'vistasaloon-demo-storage-v1' : 'vistasaloon-basic-storage';
const SIGNED_OUT_KEY=`vistasaloon-signed-out:${scope}`;
const emptyData = { barbers: [], services: [], packages: [], customers: [], invoices: [] };
let authEpoch=0;
let cacheUnavailable=false;
let restoringAuth=false;
let minimumRevision=0;
let snapshotRevision=-1;
let staleReadRetries=0;
let syncPromise:Promise<void>|null=null;
let mutationChain:Promise<unknown>=Promise.resolve();
const approvals=new Map<string,string>();
const message=(error:any)=>{
  if(error?.code==='NETWORK') return 'The server save could not be confirmed. Your draft is kept. Reconnect and retry.';
  if (error?.code==='40001') return 'This record changed on another device. Review the refreshed data before retrying.';
  if (error?.code==='P0002') return 'This record was removed on another device. It has not been recreated.';
  if (['PGRST202','42883','42P01'].includes(error?.code)) return 'Finish the production database migrations before using this workspace.';
  return typeof error?.message==='string' && !/fetch|network|connection/i.test(error.message) ? error.message : 'The server save could not be confirmed. Your draft is kept. Reconnect and retry.';
};
const assertOnline=()=>{ if(typeof navigator!=='undefined'&&!navigator.onLine) throw new Error('Reconnect to save. Your current draft is kept on this device.'); };
function decodeSnapshot(data:any) {
  if(!data || !Number.isSafeInteger(Number(data.revision))) throw new Error('Incomplete server snapshot. Cached data has been kept.');
  for(const key of ['barbers','services','packages','customers','invoices'] as const) {
    if(!Array.isArray(data[key]) || data[key].some((row:any)=>!row||!isUuid(row.id)||!Number.isSafeInteger(Number(row.version)))) throw new Error('Invalid server data. Cached data has been kept.');
    if(new Set(data[key].map((row:any)=>row.id)).size!==data[key].length) throw new Error('Duplicate server IDs. Cached data has been kept.');
  }
  for(const collection of ['barbers','services','packages','customers'] as const){
    if(data[collection].some((row:any)=>typeof row.name!=='string'))throw new Error('Invalid catalog data. Cached records have been kept.');
  }
  if(data.packages.some((row:any)=>!Array.isArray(row.services)) || data.invoices.some((row:any)=>!Array.isArray(row.items)||!Number.isFinite(Number(row.total))||!Number.isFinite(Date.parse(row.date))||row.items.some((item:any)=>!item||typeof item.serviceName!=='string'||!Number.isFinite(Number(item.price)))))throw new Error('Invalid invoice/deal data. Cached records have been kept; ask an administrator to inspect the source records.');
  return {barbers:data.barbers,services:data.services,packages:data.packages,customers:data.customers,invoices:data.invoices};
}
// Persist request IDs BEFORE sending: a timeout/reload must not create a second sale.
function requestId(entity:Collection,operation:Operation,record:RecordData,version?:number) {
  const key=`vistasaloon-requests:${scope}:${useStore.getState().userId}`;
  const fingerprint=JSON.stringify([entity,operation,record,version]);
  const entries:Record<string,string>=JSON.parse(sessionStorage.getItem(key)||'{}');
  if(!entries[fingerprint]) {entries[fingerprint]=newUuid();sessionStorage.setItem(key,JSON.stringify(entries));}
  return {id:entries[fingerprint],done:()=>{const current=JSON.parse(sessionStorage.getItem(key)||'{}');delete current[fingerprint];sessionStorage.setItem(key,JSON.stringify(current));}};
}
export const useStore=create<AppState>()(persist((set,get)=>{
  const applyRecord=(entity:Collection,operation:Operation,record:RecordData)=>set(state=>{
    const current=state[entity] as RecordData[];
    if(record.deleted_at || (operation==='remove' && (entity==='invoices'||entity==='packages'))) return {[entity]:current.filter(row=>row.id!==record.id)};
    return {[entity]:current.some(row=>row.id===record.id)?current.map(row=>row.id===record.id?record:row):entity==='invoices'?[record,...current]:[...current,record]};
  });
  const mutate=async(entity:Collection,operation:Operation,record:RecordData)=>{
    if(!isUuid(record.id) && supabase) throw new Error('This record needs a valid UUID. Refresh the catalog before saving.');
    if(!supabase) {
      if(import.meta.env.PROD) throw new Error('Connect Supabase before using this production build.');
      const current=(get()[entity] as RecordData[]).find(row=>row.id===record.id);
      if(operation==='add'&&current) throw new Error('This record ID already exists.');
      if(operation!=='add'&&!current) throw new Error('This record no longer exists.');
      if(entity==='customers' && ['add','update'].includes(operation)) {
        const duplicates=findDuplicateCustomers(get().customers,record as Customer,operation==='update'?record.id:undefined);
        if(duplicates.length) throw new DuplicateCustomerError(duplicates);
      }
      applyRecord(entity,operation,operation==='remove'?entity==='invoices'||entity==='packages'?{...record,deleted_at:new Date().toISOString()}:{...current,...record,active:false}:operation==='status'?{...current,...record}:record);
      return;
    }
    const epoch=authEpoch;
    const existing=(get()[entity] as RecordData[]).find(row=>row.id===record.id);
    const expected=operation==='add'?undefined:record.version??existing?.version;
    const job=async()=>{
      if(epoch!==authEpoch || !get().isAuthenticated) throw new Error('Sign in before saving.');
      assertOnline();
      if(!get().remoteReady) throw new Error('Refresh the workspace successfully before saving. Your draft is kept.');
      set({isSaving:true,lastSyncMessage:'Saving...'});
      try {
        const journal=requestId(entity,operation,record,expected);
        const {data,error}=await supabase!.rpc('pos_mutate',{p_request_id:journal.id,p_entity:entity,p_operation:operation,p_record:record,p_expected_version:expected??null,p_pin_token:approvals.get(`${record.id}:${operation}`)??null}).abortSignal(AbortSignal.timeout(20000));
        if(error) throw error;
        if(!data?.record || data.record.id!==record.id || !Number.isSafeInteger(Number(data.revision))) throw new Error('The server save could not be confirmed. Retry this same operation.');
        if(epoch!==authEpoch) return;
        minimumRevision=Math.max(minimumRevision,Number(data.revision));
        if(Number(data.revision)>=snapshotRevision) applyRecord(entity,operation,data.record);
        approvals.delete(`${record.id}:${operation}`);
        try{journal.done();}catch{console.warn('Server save confirmed; request journal cleanup deferred.');}
        set({lastSyncMessage:null});
      } catch(error) {
        if(epoch===authEpoch) {
          set({lastSyncMessage:message(error)});
          if((error as any)?.code==='42501'){set({remoteReady:false});}
          if(['40001','P0002'].includes((error as any)?.code)) await get().syncData().catch(()=>{});
        }
        throw new Error(message(error));
      } finally {if(epoch===authEpoch)set({isSaving:false});}
      // Fetch other devices' changes without replacing the active cart.
      void get().syncData().catch(()=>{});
    };
    const result=mutationChain.then(job,job);mutationChain=result.catch(()=>{});await result;
  };
  const remove=(entity:Collection,id:string)=>mutate(entity,'remove',{id} as RecordData);
  const reorder=(entity:'services'|'packages',from:number,to:number)=>{
    const rows=[...get()[entity]];
    if(from<0||from>=rows.length||to<0||to>=rows.length)return;
    const [row]=rows.splice(from,1); rows.splice(to,0,row);set({[entity]:rows});
  };
  return {
    ...(supabase?emptyData:{barbers:initialBarbers,services:initialServices,packages:initialPackages,customers:[],invoices:[]}),
    cart:[],pendingMutations:[],lastSyncMessage:null,isSaving:false,remoteReady:!supabase,lastVerifiedUserId:null,authInitializing:!!supabase,cacheWarning:null,
    isAuthenticated:false,userEmail:supabase?'':'admin@vistasaloon.local',userPassword:supabase?'':'VistaLocal123!',userId:null,invoiceEditPin:supabase?'':'9999',
    addBarber:record=>mutate('barbers','add',record),updateBarber:record=>mutate('barbers','update',record),removeBarber:id=>remove('barbers',id),
    addService:record=>mutate('services','add',record),updateService:record=>mutate('services','update',record),removeService:id=>remove('services',id),
    addPackage:record=>mutate('packages','add',record),updatePackage:record=>mutate('packages','update',record),removePackage:id=>remove('packages',id),
    addCustomer:record=>mutate('customers','add',record),updateCustomer:record=>mutate('customers','update',record),removeCustomer:id=>remove('customers',id),
    createInvoice:record=>mutate('invoices','add',record),updateInvoice:record=>mutate('invoices','update',record),deleteInvoice:id=>remove('invoices',id),
    updateInvoiceStatus:(id,status)=>mutate('invoices','status',{id,status} as Invoice),
    reorderServices:(from,to)=>reorder('services',from,to),reorderPackages:(from,to)=>reorder('packages',from,to),
    addToCart:item=>set(state=>({cart:[...state.cart,item]})),removeFromCart:index=>set(state=>({cart:state.cart.filter((_,i)=>i!==index)})),clearCart:()=>set({cart:[]}),
    login:async(email,password)=>{
      if(!supabase) {
        if(import.meta.env.PROD) throw new Error('Connect Supabase before using this production build.');
        const valid=email===get().userEmail&&password===get().userPassword;set({isAuthenticated:valid});return valid;
      }
      assertOnline();
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error||!data.user)return false;
      try{await establishSession(data.user);localStorage.removeItem(SIGNED_OUT_KEY);return true;}catch(error){await supabase.auth.signOut({scope:'local'});throw error;}
    },
    logout:()=>{
      authEpoch++;syncPromise=null;minimumRevision=0;snapshotRevision=-1;approvals.clear();
      if(supabase) {localStorage.setItem(SIGNED_OUT_KEY,'true');set({...emptyData,cart:[],isAuthenticated:false,userId:null,userEmail:'',userPassword:'',invoiceEditPin:'',remoteReady:false,isSaving:false,lastVerifiedUserId:null});void supabase.auth.signOut({scope:'local'});}
      else set({isAuthenticated:false});
    },
    updateCredentials:async(email,password)=>{
      if(!supabase){set({userEmail:email,userPassword:password});return;}
      assertOnline();
      const {data,error}=await supabase.auth.updateUser({email,...(password?{password}:{})});
      if(error)throw new Error(message(error));
      set({userEmail:data.user?.email||get().userEmail,userPassword:''});
      if(data.user?.new_email) set({lastSyncMessage:'Confirm the email change using the links sent by Supabase Auth.'});
    },
    verifyInvoicePin:async(pin,id,action)=>{
      if(!supabase)return get().invoiceEditPin===pin;
      assertOnline();
      if(!id||!action)return false;
      const {data,error}=await supabase.rpc('pos_authorize_invoice',{p_id:id,p_action:action==='edit'?'update':'delete',p_pin:pin});
      if(error)throw new Error(message(error));
      if(!data)return false;
      approvals.set(`${id}:${action==='edit'?'update':'remove'}`,data);return true;
    },
    updateInvoicePin:async(current,next)=>{
      if(!supabase){if(current!==get().invoiceEditPin)return false;set({invoiceEditPin:next});return true;}
      assertOnline();
      const {data,error}=await supabase.rpc('pos_set_pin',{p_current:current,p_next:next});
      if(error)throw new Error(message(error));return data===true;
    },
    syncData:async()=>{
      if(!supabase||!get().isAuthenticated)return;
      if(syncPromise)return syncPromise;
      const epoch=authEpoch;
      const run=async()=>{
        try{
          assertOnline();
          const {data,error}=await supabase!.rpc('pos_snapshot').abortSignal(AbortSignal.timeout(20000));
          if(error)throw error;
          const decoded=decodeSnapshot(data);
          if(epoch!==authEpoch)return;
          if(Number(data.revision)<minimumRevision||Number(data.revision)<snapshotRevision){if(staleReadRetries++<1){setTimeout(()=>void get().syncData().catch(()=>{}),0);return;}throw new Error('The server returned older data than a confirmed save. Cached data is kept. Contact your administrator before continuing.');}
          staleReadRetries=0;
          snapshotRevision=Number(data.revision);set({...decoded,remoteReady:true,lastVerifiedUserId:get().userId,lastSyncMessage:null});
        }catch(error){if(epoch===authEpoch){set({lastSyncMessage:message(error),remoteReady:false});if((error as any)?.code==='42501')get().logout();}throw new Error(message(error));}
      };
      const pending=run();syncPromise=pending;
      try{await pending;}finally{if(syncPromise===pending)syncPromise=null;}
    },
    // Legacy unsynchronized mutations are retained in their OLD storage key for
    // manual recovery; never replay old/demo writes into a newly connected salon.
    flushPendingMutations:async()=>{if(supabase)await get().syncData();},
    enqueuePendingMutation:()=>{throw new Error('Offline database writes are disabled. Reconnect to save.');},
  };
},{
  name:STORAGE_KEY,
  storage:createJSONStorage(()=>({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>{try{localStorage.setItem(key,value);}catch(error){if(!supabase)throw error;if(!cacheUnavailable){cacheUnavailable=true;queueMicrotask(()=>useStore.setState({cacheWarning:'Browser cache is full or unavailable. Server records are safe; offline viewing may be incomplete.'}));}}},removeItem:key=>localStorage.removeItem(key)})),
  partialize:state=>({...{lastVerifiedUserId:state.lastVerifiedUserId,barbers:state.barbers,services:state.services,packages:state.packages,customers:state.customers,invoices:state.invoices},...(!supabase?{pendingMutations:[],cart:state.cart,userEmail:state.userEmail,userPassword:state.userPassword,isAuthenticated:state.isAuthenticated,invoiceEditPin:state.invoiceEditPin}:{} )}),
}));

const draftKey=()=>`vistasaloon-bill-draft:${scope}:${useStore.getState().userId}`;
async function establishSession(user:{id:string;email?:string}) {
  const epoch=++authEpoch;syncPromise=null;minimumRevision=0;snapshotRevision=-1;
  const {data,error}=await supabase!.rpc('pos_snapshot').abortSignal(AbortSignal.timeout(20000));
  if(error)throw new Error(message(error));
  const decoded=decodeSnapshot(data);
  if(epoch!==authEpoch)return;
  snapshotRevision=Number(data.revision);staleReadRetries=0;
  let cart:InvoiceItem[]=[];
  try{const saved=JSON.parse(sessionStorage.getItem(`vistasaloon-bill-draft:${scope}:${user.id}`)||'null');if(Array.isArray(saved?.cart))cart=saved.cart;}catch{ /* A draft is never uploaded automatically. */ }
  restoringAuth=true;
  useStore.setState({...decoded,cart,isAuthenticated:true,userId:user.id,userEmail:user.email||'',userPassword:'',invoiceEditPin:'',remoteReady:true,lastVerifiedUserId:user.id,lastSyncMessage:null});
  restoringAuth=false;
}
export function startProductionSync(){
  if(!supabase)return ()=>{};
  let stopped=false;const initialEpoch=authEpoch;
  const refresh=()=>{if(!stopped&&useStore.getState().isAuthenticated&&document.visibilityState!=='hidden')void useStore.getState().syncData().catch(()=>{});};
  // Do not await Auth calls inside onAuthStateChange (the Auth lock is held there).
  const {data:{subscription}}=supabase.auth.onAuthStateChange((event)=>{
    if(event==='SIGNED_OUT'){authEpoch++;syncPromise=null;approvals.clear();useStore.setState({...emptyData,isAuthenticated:false,userId:null,cart:[],remoteReady:false,lastVerifiedUserId:null});}
  });
  void (async()=>{
    if(localStorage.getItem(SIGNED_OUT_KEY)==='true')return;
    const {data:{session}}=await supabase.auth.getSession();
    if(stopped||initialEpoch!==authEpoch||!session||useStore.getState().isAuthenticated)return;
    if(!navigator.onLine && session.user.id===useStore.getState().lastVerifiedUserId && (session.expires_at||0)>Date.now()/1000){
      let cart:InvoiceItem[]=[];
      try{const saved=JSON.parse(sessionStorage.getItem(`vistasaloon-bill-draft:${scope}:${session.user.id}`)||'null');if(Array.isArray(saved?.cart))cart=saved.cart;}catch{}
      restoringAuth=true;useStore.setState({isAuthenticated:true,userId:session.user.id,userEmail:session.user.email||'',cart,remoteReady:false,lastSyncMessage:'Offline: showing cached data. Reconnect to save.'});restoringAuth=false;return;
    }
    const {data,error}=await supabase.auth.getUser();
    if(stopped||initialEpoch!==authEpoch||error||!data.user||useStore.getState().isAuthenticated)return;
    try{await establishSession(data.user);}catch{if(!stopped)useStore.getState().logout();}
  })().catch(()=>{/* Sign-in stays required unless a verified cached session can be used offline. */}).finally(()=>{if(!stopped)useStore.setState({authInitializing:false});});
  const offline=()=>useStore.setState({remoteReady:false,lastSyncMessage:'Offline: cached data is available. Reconnect to save; your bill draft is kept.'});
  window.addEventListener('offline',offline);
  const unsubscribe=useStore.subscribe((state,previous)=>{
    if(!restoringAuth && state.isAuthenticated && state.cart!==previous.cart){try{sessionStorage.setItem(draftKey(),JSON.stringify({...JSON.parse(sessionStorage.getItem(draftKey())||'{}'),cart:state.cart}));}catch{useStore.setState({lastSyncMessage:'Browser storage is full. Keep this tab open until the bill is saved.'});}}
  });
  window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  const interval=setInterval(refresh,15000);
  return ()=>{stopped=true;subscription.unsubscribe();unsubscribe();clearInterval(interval);window.removeEventListener('offline',offline);window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
}
