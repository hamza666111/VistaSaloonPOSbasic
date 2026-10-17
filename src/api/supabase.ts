import { createClient } from '@supabase/supabase-js';

const remoteEnabled = import.meta.env.VITE_ENABLE_REMOTE_SYNC === 'true';
const supabaseUrl = remoteEnabled ? import.meta.env.VITE_SUPABASE_URL : ''; 
const supabaseKey = remoteEnabled ? import.meta.env.VITE_SUPABASE_ANON_KEY : ''; 

if (remoteEnabled && (!supabaseUrl || !supabaseKey)) {
  console.warn('[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Remote sync is disabled.');
}

export const supabase = supabaseUrl && supabaseKey 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

export const isSupabaseConfigured = () => !!supabase;

