import { newUuid, isUuid } from '../utils/uuid';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Service } from '../types';
import { isDemoMode } from '../demo/mode';
import { supabase } from '../api/supabase';

export interface ServiceCategory { id: string; name: string; version?: number; }
export const categoryRemoteEnabled = !!supabase;
const projectScope = supabase ? new URL(import.meta.env.VITE_SUPABASE_URL).host : '';
const STORAGE_KEY = categoryRemoteEnabled ? `vistasaloon-shared-categories-v1:${projectScope}` : isDemoMode ? 'vistasaloon-demo-categories-v1' : 'vistasaloon-categories-v1';
const defaults: ServiceCategory[] = [
  { id: 'hair', name: 'Hair & styling' },
  { id: 'color', name: 'Color & treatments' },
  { id: 'grooming', name: 'Grooming' },
  { id: 'skin', name: 'Skin & face' },
  { id: 'nails', name: 'Nails' },
  { id: 'massage', name: 'Massage' },
];
const initialAssignments = (services: Service[]) => Object.fromEntries(services.map(service => {
  const name = service.name.toLowerCase();
  const id = /beard/.test(name) ? 'grooming'
    : /color|balayage|keratin|spa|polish/.test(name) ? 'color'
    : /facial|wax|brow|cleansing/.test(name) ? 'skin'
    : /manicure|pedicure/.test(name) ? 'nails'
    : /massage/.test(name) ? 'massage'
    : /hair|cut|wash|styling|blow/.test(name) ? 'hair' : null;
  return [service.id, id ? [id] : []];
}));
interface CategoryState {
  categories: ServiceCategory[];
  serviceCategories: Record<string, string[]>;
  initialized: boolean;
  isLoading: boolean;
  isSaving: boolean;
  remoteReady: boolean;
  syncError: string | null;
  lastSyncedAt: string | null;
  initialize: (services: Service[]) => void;
  sync: () => Promise<boolean>;
  addCategory: (name: string) => Promise<string>;
  renameCategory: (id: string, name: string, expectedVersion?: number) => Promise<void>;
  removeCategory: (id: string, expectedVersion?: number) => Promise<void>;
  setMembership: (serviceId: string, categoryId: string, included: boolean) => Promise<void>;
  importLocalCategories: () => Promise<number>;
  reset: (services: Service[]) => void;
}
const validateName = (name: string, categories: ServiceCategory[], exceptId?: string) => {
  const cleaned = name.trim();
  if (!cleaned) throw new Error('Enter a category name.');
  if (cleaned.length > 50) throw new Error('Use a category name of 50 characters or fewer.');
  if (['all services', 'uncategorized'].includes(cleaned.toLowerCase())) throw new Error('That name is reserved for a service filter.');
  if (categories.some(category => category.id !== exceptId && category.name.toLowerCase() === cleaned.toLowerCase())) throw new Error('A category with that name already exists.');
  return cleaned;
};

const readableError = (error: any, operation: 'read' | 'write' = 'write') => {
  if (error?.code === '23505') return 'A category with that name already exists. Refresh the list before trying again.';
  if (['40001', 'P0002'].includes(error?.code)) return 'This category changed on another device. Review the refreshed list and try again.';
  if (error?.code === '23503') return 'This service is not available in the shared catalog yet. Sync services before assigning its categories.';
  if (['PGRST202', '42P01', '42883'].includes(error?.code)) return 'Shared categories are not set up yet. Ask your administrator to finish database setup.';
  if (error?.code === '42501') return 'Your account does not have permission to change shared categories.';
  if (['23514', '23502', '22023'].includes(error?.code)) return 'Check the category name and service selection, then try again.';
  return error instanceof Error && !/fetch|network|connection/i.test(error.message) ? error.message : operation === 'read' ? 'Shared categories could not be refreshed. Last saved categories remain visible.' : 'The save could not be confirmed. Refresh categories before retrying.';
};
const decodeSnapshot = (data: any) => {
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.memberships)) throw new Error('The shared category response was incomplete. Refresh and try again.');
  const categories: ServiceCategory[] = data.categories.map((row: any) => {
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || !Number.isSafeInteger(Number(row.version))) throw new Error('The shared category response was invalid.');
    return { id: row.id, name: row.name, version: Number(row.version) };
  });
  const ids = new Set(categories.map(category => category.id));
  const serviceCategories: Record<string, string[]> = Object.create(null);
  for (const row of data.memberships) {
    if (typeof row.service_id !== 'string' || !ids.has(row.category_id)) throw new Error('The shared category assignments were invalid.');
    const current = serviceCategories[row.service_id] || [];
    serviceCategories[row.service_id] = [...new Set([...current, row.category_id])];
  }
  return { categories, serviceCategories, initialized: true, remoteReady: true, syncError: null, lastSyncedAt: new Date().toISOString() };
};
export function localCategoryImportAvailable() {
  if (!categoryRemoteEnabled) return false;
  try { return JSON.parse(localStorage.getItem('vistasaloon-categories-v1') || 'null')?.state?.categories?.length > 0; }
  catch { return false; }
}
let requestGeneration = 0;
let syncPromise: Promise<boolean> | null = null;
let refreshAfterSave = false;

// Local/demo data is isolated from each Supabase project's authoritative cache.
export const useServiceCategories = create<CategoryState>()(persist((set, get) => ({
  categories: categoryRemoteEnabled ? [] : defaults,
  serviceCategories: {}, initialized: false, isLoading: false, isSaving: false,
  remoteReady: !categoryRemoteEnabled, syncError: null, lastSyncedAt: null,
  initialize: services => {
    if (!categoryRemoteEnabled && !get().initialized) set({ serviceCategories: initialAssignments(services), initialized: true });
  },
  sync: async () => {
    if (!supabase) return true;
    if (get().isSaving) { refreshAfterSave = true; return false; }
    if (syncPromise) return syncPromise;
    const generation = ++requestGeneration;
    set({ isLoading: true });
    syncPromise = Promise.resolve().then(async () => {
      try {
        if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You are offline. Reconnect to refresh shared categories.');
        const { data, error } = await supabase.rpc('get_service_category_catalog').abortSignal(AbortSignal.timeout(15000));
        if (error) throw error;
        if (generation !== requestGeneration) return false;
        set({ ...decodeSnapshot(data), isLoading: false });
        return true;
      } catch (error) {
        if (generation === requestGeneration) set({ isLoading: false, remoteReady: false, syncError: readableError(error, 'read') });
        return false;
      } finally { syncPromise = null; }
    });
    return syncPromise;
  },
  addCategory: async name => {
    const cleaned = validateName(name, get().categories);
    const id = newUuid();
    if (supabase) await remoteMutation('mutate_service_category_catalog', { p_action: 'add', p_category_id: id, p_name: cleaned });
    else set(state => ({ categories: [...state.categories, { id, name: cleaned }] }));
    return id;
  },
  renameCategory: async (id, name, expectedVersion) => {
    const cleaned = validateName(name, get().categories, id);
    if (supabase) await remoteMutation('mutate_service_category_catalog', { p_action: 'rename', p_category_id: id, p_name: cleaned, p_expected_version: expectedVersion ?? get().categories.find(category => category.id === id)?.version });
    else set(state => ({ categories: state.categories.map(category => category.id === id ? { ...category, name: cleaned } : category) }));
  },
  removeCategory: async (id, expectedVersion) => {
    if (supabase) await remoteMutation('mutate_service_category_catalog', { p_action: 'remove', p_category_id: id, p_expected_version: expectedVersion ?? get().categories.find(category => category.id === id)?.version });
    else set(state => ({
      categories: state.categories.filter(category => category.id !== id),
      serviceCategories: Object.fromEntries(Object.entries(state.serviceCategories).map(([serviceId, ids]) => [serviceId, ids.filter(categoryId => categoryId !== id)])),
    }));
  },
  setMembership: async (serviceId, categoryId, included) => {
    if (!get().categories.some(category => category.id === categoryId)) throw new Error('This category no longer exists. Refresh the list.');
    if (supabase) await remoteMutation('mutate_service_category_catalog', { p_action: 'membership', p_category_id: categoryId, p_service_id: serviceId, p_included: included });
    else set(state => {
      const current = state.serviceCategories[serviceId] || [];
      const next = included ? [...new Set([...current, categoryId])] : current.filter(id => id !== categoryId);
      return { serviceCategories: { ...state.serviceCategories, [serviceId]: next } };
    });
  },
  importLocalCategories: async () => {
    if (!supabase) return 0;
    const saved = JSON.parse(localStorage.getItem('vistasaloon-categories-v1') || 'null')?.state;
    if (!saved || !Array.isArray(saved.categories)) throw new Error('No local categories are available to import.');
    const importedIds=new Map<string,string>(saved.categories.map((category:ServiceCategory)=>[category.id,isUuid(category.id)?category.id:newUuid()]));
    const memberships = Object.entries(saved.serviceCategories || {}).flatMap(([serviceId, ids]) => {
      if (!Array.isArray(ids)) throw new Error('The local category assignments are invalid.');
      return ids.map(categoryId => ({ service_id: serviceId, category_id: importedIds.get(categoryId) || categoryId }));
    });
    const result = await remoteMutation('import_service_category_catalog', { p_categories: saved.categories.map(({ id, name }: ServiceCategory) => ({ id:importedIds.get(id), name })), p_memberships: memberships });
    return Number(result.skipped_memberships || 0);
  },
  reset: services => {
    if (categoryRemoteEnabled) throw new Error('Shared categories cannot be reset from a demo.');
    set({ categories: defaults, serviceCategories: initialAssignments(services), initialized: true });
  },
}), {
  name: STORAGE_KEY,
  partialize: state => ({ categories: state.categories, serviceCategories: state.serviceCategories, initialized: state.initialized, lastSyncedAt: state.lastSyncedAt }),
}));

async function remoteMutation(rpc: string, args: Record<string, unknown>) {
  if (!supabase) throw new Error('Shared categories are not configured.');
  const state = useServiceCategories.getState();
  if (state.isSaving) throw new Error('Wait for the current save to finish.');
  if (!navigator.onLine) throw new Error('You are offline. Reconnect before changing shared categories.');
  if (!state.remoteReady) throw new Error('Refresh shared categories before making changes.');
  ++requestGeneration; // An older read must not overwrite a newer acknowledged save.
  useServiceCategories.setState({ isSaving: true, isLoading: false });
  let shouldRefresh = false;
  try {
    const { data, error } = await supabase.rpc(rpc, args).abortSignal(AbortSignal.timeout(15000));
    if (error) throw error;
    useServiceCategories.setState(decodeSnapshot(data));
    return data;
  } catch (error) {
    shouldRefresh = true;
    throw new Error(readableError(error));
  } finally {
    useServiceCategories.setState({ isSaving: false });
    if (shouldRefresh || refreshAfterSave) {
      refreshAfterSave = false;
      // Let a prior in-flight read settle before requesting a fresh snapshot.
      void Promise.resolve(syncPromise).then(() => useServiceCategories.getState().sync());
    }
  }
}

export function startCategorySync() {
  if (!supabase) return () => {};
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  const refresh = () => {
    if (!stopped && document.visibilityState !== 'hidden') void useServiceCategories.getState().sync();
  };
  const schedule = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 120); };
  const visibility = () => { if (document.visibilityState === 'visible') refresh(); };
  const channel = supabase.channel(`service-categories-${newUuid()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'service_categories' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'service_category_memberships' }, schedule)
    .subscribe(status => { if (status === 'SUBSCRIBED') schedule(); });
  const interval = setInterval(refresh, 15000);
  window.addEventListener('focus', refresh);
  window.addEventListener('online', refresh);
  window.addEventListener('offline', refresh);
  document.addEventListener('visibilitychange', visibility);
  refresh();
  return () => {
    stopped = true; clearInterval(interval); clearTimeout(debounce);
    window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh);
    document.removeEventListener('visibilitychange', visibility);
    void supabase.removeChannel(channel);
  };
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  // Remote tabs refresh through Realtime/polling, avoiding cache-write feedback loops.
  if (event.key === STORAGE_KEY && !categoryRemoteEnabled) void useServiceCategories.persist.rehydrate();
});
