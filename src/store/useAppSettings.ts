import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../api/supabase';
import { isDemoMode } from '../demo/mode';
import { applyAppTheme } from '../theme/appTheme';

export interface AppBranding { salonName: string; address: string; phone: string; themeColor: string; logoDataUrl: string | null; }
export interface AppSettings extends AppBranding { version: number; }
export const defaultAppSettings: AppSettings = { salonName:'Vista Saloon', address:'', phone:'', themeColor:'#245b49', logoDataUrl:null, version:1 };
export const appSettingsRemoteEnabled = !!supabase;
const storageKey = supabase ? `vistasaloon-shared-app-v1:${new URL(import.meta.env.VITE_SUPABASE_URL).host}` : isDemoMode ? 'vistasaloon-demo-app-v1' : 'vistasaloon-app-v1';
export function validateAppBranding(value: AppBranding): AppBranding {
  const salonName = value.salonName?.trim();
  if (!salonName || salonName.length > 80 || /[\u0000-\u001f]/.test(salonName)) throw new Error('Enter a salon name of 1 to 80 characters.');
  if (typeof value.address !== 'string' || value.address.length > 300) throw new Error('Keep the address under 300 characters.');
  if (typeof value.phone !== 'string' || value.phone.length > 40) throw new Error('Keep the contact number under 40 characters.');
  if (!/^#[0-9a-f]{6}$/i.test(value.themeColor)) throw new Error('Choose a valid six-digit theme color.');
  if (value.logoDataUrl !== null && (typeof value.logoDataUrl !== 'string' || value.logoDataUrl.length > 360000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.logoDataUrl))) throw new Error('Choose a valid PNG, JPG, or WebP logo.');
  return { salonName, address:value.address.trim(), phone:value.phone.trim(), themeColor:value.themeColor.toLowerCase(), logoDataUrl:value.logoDataUrl };
}
const decode = (value: any): AppSettings => {
  if (!value || !Number.isSafeInteger(Number(value.version)) || Number(value.version) < 1) throw new Error('The shared app settings response was invalid.');
  return { ...validateAppBranding(value), version:Number(value.version) };
};
const readableError = (error: any) => {
  if (['40001','P0002'].includes(error?.code)) return 'App settings changed on another device. Review the latest version before saving.';
  if (['PGRST202','42P01','42883'].includes(error?.code)) return 'Shared app settings are not set up yet. Ask your administrator to finish database setup.';
  if (['23514','23502','22023'].includes(error?.code)) return 'Check the salon details, color, and logo before saving.';
  if (error?.code === '42501') return 'Your account cannot update shared app settings.';
  return error instanceof Error ? error.message : 'App settings could not be confirmed. Refresh and try again.';
};
interface State {
  settings: AppSettings; isLoading:boolean; isSaving:boolean; remoteReady:boolean; syncError:string|null;
  sync:()=>Promise<boolean>;
  save:(settings:AppBranding, expectedVersion:number)=>Promise<void>;
}
let generation = 0;
let reading:Promise<boolean>|null = null;
let refreshAfterSave = false;
export const useAppSettings = create<State>()(persist((set,get)=>({
  settings:defaultAppSettings, isLoading:false, isSaving:false, remoteReady:!supabase, syncError:null,
  sync:async()=>{
    if (!supabase) return true;
    if (get().isSaving) { refreshAfterSave=true; return false; }
    if (reading) return reading;
    const token=++generation;
    set({isLoading:true});
    reading=Promise.resolve().then(async()=>{
      try {
        if (!navigator.onLine) throw new Error('You are offline. Reconnect to refresh shared app settings.');
        const {data,error}=await supabase.rpc('get_app_settings',{p_known_version:get().remoteReady ? get().settings.version : null}).abortSignal(AbortSignal.timeout(15000));
        if(error) throw error;
        if(token!==generation) return false;
        const settings=data?.unchanged===true && Number(data.version)===get().settings.version ? get().settings : decode(data);
        set({settings,isLoading:false,remoteReady:true,syncError:null}); return true;
      } catch(error) { if(token===generation) set({isLoading:false,remoteReady:false,syncError:readableError(error)}); return false; }
      finally { reading=null; }
    }); return reading;
  },
  save:async(value,expectedVersion)=>{
    const fields=validateAppBranding(value);
    if(get().isSaving) throw new Error('Wait for the current save to finish.');
    if (!supabase) {
      if(get().settings.version!==expectedVersion) throw new Error('App settings changed in another tab. Load the latest version before saving.');
      set({settings:{...fields,version:get().settings.version+1}}); return;
    }
    if(!navigator.onLine) throw new Error('You are offline. Reconnect before changing shared app settings.');
    if(!get().remoteReady) throw new Error('Refresh shared app settings before making changes.');
    ++generation; set({isSaving:true,isLoading:false}); let failed=false;
    try {
      const {data,error}=await supabase.rpc('save_app_settings',{p_settings:fields,p_expected_version:expectedVersion}).abortSignal(AbortSignal.timeout(15000));
      if(error) throw error;
      set({settings:decode(data),remoteReady:true,syncError:null});
    } catch(error) { failed=true; throw new Error(readableError(error)); }
    finally { set({isSaving:false}); if(failed||refreshAfterSave) {refreshAfterSave=false;void Promise.resolve(reading).then(()=>get().sync());} }
  },
}),{
  name:storageKey,
  partialize:state=>({settings:state.settings}),
  merge:(persisted:any,current)=>{
    try {return {...current,settings:decode(persisted?.settings)};} catch {return current;}
  },
}));
export function applyBranding(settings:AppSettings) {
  applyAppTheme(settings.themeColor);
  if(typeof document==='undefined') return;
  document.title=`${settings.salonName} POS System`;
  const favicon=document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if(favicon) favicon.href=settings.logoDataUrl||'/logo.svg';
}
applyBranding(useAppSettings.getState().settings);
useAppSettings.subscribe((state,previous)=>{if(state.settings!==previous.settings) applyBranding(state.settings);});
if(typeof window!=='undefined') window.addEventListener('storage',event=>{if(event.key===storageKey && !supabase) void useAppSettings.persist.rehydrate();});

export function startAppSettingsSync() {
  if(!supabase) return ()=>{};
  let stopped=false; let debounce:ReturnType<typeof setTimeout>|undefined;
  const refresh=()=>{if(!stopped && document.visibilityState!=='hidden') void useAppSettings.getState().sync();};
  const schedule=()=>{clearTimeout(debounce);debounce=setTimeout(refresh,120);};
  const visibility=()=>{if(document.visibilityState==='visible')refresh();};
  const channel=supabase.channel(`app-settings-${crypto.randomUUID()}`).on('postgres_changes',{event:'*',schema:'public',table:'app_settings'},schedule).subscribe(status=>{if(status==='SUBSCRIBED')schedule();});
  const interval=setInterval(refresh,30000);
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);window.addEventListener('offline',refresh);document.addEventListener('visibilitychange',visibility);
  refresh();
  return()=>{stopped=true;clearInterval(interval);clearTimeout(debounce);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',refresh);document.removeEventListener('visibilitychange',visibility);void supabase.removeChannel(channel);};
}
