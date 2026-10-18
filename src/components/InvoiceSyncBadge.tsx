import type { Invoice } from '../types';
import { isSupabaseConfigured } from '../api/supabase';
export function InvoiceSyncBadge({invoice}:{invoice:Invoice}){
  if(!isSupabaseConfigured())return null;
  const blocked=invoice.syncStatus==='blocked';const pending=!!invoice.syncStatus;
  return <span className={`mt-2 block w-fit rounded-md px-2 py-1 text-[10px] font-medium ${blocked?'bg-red-50 text-red-700':pending?'bg-amber-50 text-amber-800':'bg-gray-100 text-gray-500'}`} title={invoice.syncError|| (pending?'Saved on this device. Keep browser data until it is synced.':'Saved to Supabase.')}>
    {blocked?'Sync needs attention':pending?'Pending sync':'Synced'}
  </span>;
}
