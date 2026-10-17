import { create } from 'zustand';
import { isDemoMode } from '../demo/mode';
import { persist } from 'zustand/middleware';
import { Barber, Service, ServicePackage, Customer, Invoice, InvoiceItem } from '../types';
import { supabase } from '../api/supabase';
import { DuplicateCustomerError, findDuplicateCustomers } from '../utils/customerDuplicates';

type PendingMutationType =
  | 'service:add'
  | 'service:update'
  | 'service:remove'
  | 'package:add'
  | 'package:update'
  | 'package:remove'
  | 'barber:add'
  | 'barber:update'
  | 'barber:remove'
  | 'customer:add'
  | 'customer:update'
  | 'customer:remove'
  | 'invoice:create'
  | 'invoice:update'
  | 'invoice:delete'
  | 'invoice:updateStatus'
  | 'credentials:update';

interface PendingMutation {
  id: string;
  type: PendingMutationType;
  payload: any;
  createdAt: string;
}

const uuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const isNavigatorOffline = () => {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
};

const isLikelyOfflineError = (error: any) => {
  if (isNavigatorOffline()) return true;
  if (!error) return false;
  const message = typeof error === 'string' ? error : error?.message;
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('fetch') || lower.includes('network') || lower.includes('connection');
};

const STORAGE_KEY = isDemoMode ? 'vistasaloon-demo-storage-v1' : 'vistasaloon-basic-storage';

interface AppState {
  barbers: Barber[];
  services: Service[];
  packages: ServicePackage[];
  customers: Customer[];
  invoices: Invoice[];
  cart: InvoiceItem[];
  pendingMutations: PendingMutation[];
  lastSyncMessage: string | null;
  
  // Actions
  addBarber: (barber: Barber) => Promise<void>;
  updateBarber: (barber: Barber) => Promise<void>;
  removeBarber: (id: string) => Promise<void>;
  
  addService: (service: Service) => Promise<void>;
  updateService: (service: Service) => Promise<void>;
  removeService: (id: string) => Promise<void>;
  reorderServices: (fromIndex: number, toIndex: number) => void;

  addPackage: (pkg: ServicePackage) => Promise<void>;
  updatePackage: (pkg: ServicePackage) => Promise<void>;
  removePackage: (id: string) => Promise<void>;
  reorderPackages: (fromIndex: number, toIndex: number) => void;
  
  addCustomer: (customer: Customer) => Promise<void>;
  updateCustomer: (customer: Customer) => Promise<void>;
  removeCustomer: (id: string) => Promise<void>;
  
  addToCart: (item: InvoiceItem) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  
  createInvoice: (invoice: Invoice) => Promise<void>;
  updateInvoiceStatus: (id: string, status: 'paid' | 'pending' | 'cancelled') => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  updateInvoice: (invoice: Invoice) => Promise<void>;
  
  // Auth
  isAuthenticated: boolean;
  userEmail: string;
  userPassword: string;
  userId: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  updateCredentials: (email: string, password: string) => Promise<void>;

  // Protected invoice edit PIN
  invoiceEditPin: string;
  verifyInvoicePin: (pin: string) => boolean;
  updateInvoicePin: (current: string, next: string) => Promise<boolean>;

  // Sync (placeholder for now)
  syncData: () => Promise<void>;
  enqueuePendingMutation: (mutation: PendingMutation) => void;
  flushPendingMutations: () => Promise<void>;
}

const initialBarbers: Barber[] = [
  { id: '1', name: 'Stylist 01', active: true, commissionRate: 0 },
  { id: '2', name: 'Stylist 02', active: true, commissionRate: 0 },
  { id: '3', name: 'Stylist 03', active: true, commissionRate: 0 },
  { id: '4', name: 'Stylist 04', active: true, commissionRate: 0 },
];

const initialServices: Service[] = [
  // Hair Cut
  { id: 'hc-1', name: 'Hair Cut - Regular', price: 400, active: true },
  { id: 'hc-2', name: 'Hair Cut - Kids', price: 400, active: true },
  { id: 'hc-3', name: 'Hair Cut - Fade', price: 600, active: true },
  
  // Beard Cut
  { id: 'bc-1', name: 'Beard Cut - Trim', price: 300, active: true },
  { id: 'bc-2', name: 'Beard Cut - Fade', price: 350, active: true },
  { id: 'bc-3', name: 'Beard Cut - Clean', price: 300, active: true },
  
  // Waxing
  { id: 'wx-1', name: 'Waxing - Full Face', price: 600, active: true },
  { id: 'wx-2', name: 'Waxing - Cheeks', price: 200, active: true },
  { id: 'wx-3', name: 'Waxing - Nose', price: 200, active: true },
  { id: 'wx-4', name: 'Waxing - Ear', price: 200, active: true },
  
  // Massage
  { id: 'ms-1', name: 'Massage - Head', price: 300, active: true },
  { id: 'ms-2', name: 'Massage - Half Body', price: 600, active: true },
  { id: 'ms-3', name: 'Massage - Full Body', price: 1000, active: true },
  
  // Hair Color
  { id: 'clr-1', name: 'Hair Color - Head Keune', price: 1500, active: true },
  { id: 'clr-2', name: 'Hair Color - Beard Keune', price: 700, active: true },
  { id: 'clr-3', name: 'Hair Color - Head Eletik', price: 800, active: true },
  { id: 'clr-4', name: 'Hair Color - Beard Eletik', price: 400, active: true },
  { id: 'clr-5', name: 'Hair Color - Head Service', price: 250, active: true },
  { id: 'clr-6', name: 'Hair Color - Beard Service', price: 150, active: true },
  
  // Others
  { id: 'oth-1', name: 'Hair Polish', price: 1000, active: true },
  { id: 'oth-2', name: 'Head Wash', price: 250, active: true },
  
  // Facial
  { id: 'fac-1', name: 'Facial - Nature Life', price: 4500, active: true },
  { id: 'fac-2', name: 'Facial - Derma Shine', price: 3000, active: true },
  { id: 'fac-3', name: 'Facial - Dr Rashiel', price: 2500, active: true },
  { id: 'fac-4', name: 'Facial - Cleansing', price: 1000, active: true },
];

const initialPackages: ServicePackage[] = [
  {
    id: 'pkg-groom-basic',
    name: 'Gentlemen Starter',
    price: 1200,
    services: ['Hair Cut - Regular', 'Beard Cut - Trim', 'Head Wash'],
    active: true,
  },
  {
    id: 'pkg-groom-premium',
    name: 'Signature Glow',
    price: 2800,
    services: ['Hair Cut - Fade', 'Beard Cut - Fade', 'Facial - Cleansing', 'Massage - Head'],
    active: true,
  },
  {
    id: 'pkg-color-relax',
    name: 'Color & Relax',
    price: 3200,
    services: ['Hair Color - Head Keune', 'Head Wash', 'Massage - Head'],
    active: true,
  },
];

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const enqueuePendingMutationInternal = (mutation: PendingMutation) => {
        set((state) => ({
          pendingMutations: [...state.pendingMutations, mutation],
          lastSyncMessage: `Pending sync (${state.pendingMutations.length + 1})`,
        }));
        console.warn('[OfflineQueue] Queued mutation', mutation.type, mutation.payload);
      };

      const queueMutation = (type: PendingMutationType, payload: any) => {
        const mutation: PendingMutation = {
          id: uuid(),
          type,
          payload,
          createdAt: new Date().toISOString(),
        };
        enqueuePendingMutationInternal(mutation);
        return mutation;
      };

      const runOrQueue = async (
        type: PendingMutationType,
        payload: any,
        executor: () => Promise<void>,
        rollback?: () => void
      ) => {
        if (!supabase) {
          queueMutation(type, payload);
          return false;
        }
        try {
          await executor();
          return true;
        } catch (error) {
          if (isLikelyOfflineError(error)) {
            queueMutation(type, payload);
            return false;
          }
          if (rollback) rollback();
          throw error;
        }
      };

      const fetchValidServiceIds = async (items: InvoiceItem[]) => {
        if (!supabase) return new Set<string>();
        const serviceIds = Array.from(new Set(items.map((item) => item.serviceId).filter(Boolean)));
        if (!serviceIds.length) return new Set<string>();

        const { data, error } = await supabase.from('services').select('id').in('id', serviceIds);
        if (error) throw error;

        return new Set((data ?? []).map((service: { id: string }) => service.id));
      };

      const buildInvoiceItemsPayload = async (invoice: Invoice) => {
        const validServiceIds = await fetchValidServiceIds(invoice.items);

        return invoice.items.map((item: InvoiceItem, idx: number) => ({
          invoiceId: invoice.id,
          serviceId: item.serviceId && validServiceIds.has(item.serviceId) ? item.serviceId : null,
          serviceName: item.serviceName,
          price: item.price,
          barberId: item.barberId || null,
          barberName: item.barberName,
          position: idx,
        }));
      };

      const executePendingMutation = async (mutation: PendingMutation) => {
        if (!supabase) throw new Error('Supabase client not configured');
        switch (mutation.type) {
          case 'service:add': {
            const { service } = mutation.payload;
            const { error } = await supabase.from('services').upsert(service);
            if (error) throw error;
            return;
          }
          case 'service:update': {
            const { service } = mutation.payload;
            const { error } = await supabase.from('services').upsert(service);
            if (error) throw error;
            return;
          }
          case 'service:remove': {
            const { id } = mutation.payload;
            const { error: deleteError } = await supabase.from('services').update({ active: false }).eq('id', id);
            if (deleteError) throw deleteError;
            return;
          }
          case 'package:add':
          case 'package:update': {
            const { pkg } = mutation.payload;
            const { error } = await supabase
              .from('service_packages')
              .upsert({ id: pkg.id, name: pkg.name, price: pkg.price, active: pkg.active ?? true });
            if (error) throw error;
            await supabase.from('service_package_items').delete().eq('packageId', pkg.id);
            const itemsPayload = pkg.services.map((name: string, idx: number) => ({
              packageId: pkg.id,
              serviceName: name,
              position: idx,
            }));
            if (itemsPayload.length) {
              const { error: itemsError } = await supabase.from('service_package_items').insert(itemsPayload);
              if (itemsError) throw itemsError;
            }
            return;
          }
          case 'package:remove': {
            const { id } = mutation.payload;
            const { error: itemsError } = await supabase.from('service_package_items').delete().eq('packageId', id);
            if (itemsError) throw itemsError;
            const { error } = await supabase.from('service_packages').delete().eq('id', id);
            if (error) throw error;
            return;
          }
          case 'barber:add':
          case 'barber:update': {
            const { barber } = mutation.payload;
            const { error } = await supabase.from('barbers').upsert(barber);
            if (error) throw error;
            return;
          }
          case 'barber:remove': {
            const { id } = mutation.payload;
            const { error } = await supabase.from('barbers').update({ active: false }).eq('id', id);
            if (error) throw error;
            return;
          }
          case 'customer:add':
          case 'customer:update': {
            const { customer } = mutation.payload;
            const { error } = await supabase.from('customers').upsert(customer);
            if (error) throw error;
            return;
          }
          case 'customer:remove': {
            const { id } = mutation.payload;
            const { error } = await supabase.from('customers').update({ active: false }).eq('id', id);
            if (error) throw error;
            return;
          }
          case 'invoice:create': {
            const { invoice, customer, barberRows } = mutation.payload;
            const tasks: PromiseLike<any>[] = [];
            if (customer) tasks.push(supabase.from('customers').upsert(customer));
            if (barberRows?.length) tasks.push(supabase.from('barbers').upsert(barberRows));
            const results = await Promise.all(tasks);
            for (const r of results) {
              if (r?.error) throw r.error;
            }
            const itemsPayload = await buildInvoiceItemsPayload(invoice);
            const { error: rpcError } = await supabase.rpc('create_invoice_with_items', {
              invoice_data: invoice,
              items_data: itemsPayload,
            });
            if (rpcError) throw rpcError;
            return;
          }
          case 'invoice:update': {
            const { invoice, customer, barberRows } = mutation.payload;
            const tasks: PromiseLike<any>[] = [];
            if (customer) tasks.push(supabase.from('customers').upsert(customer));
            if (barberRows?.length) tasks.push(supabase.from('barbers').upsert(barberRows));
            const results = await Promise.all(tasks);
            for (const r of results) {
              if (r?.error) throw r.error;
            }
            const itemsPayload = await buildInvoiceItemsPayload(invoice);
            const { error: rpcError } = await supabase.rpc('update_invoice_with_items', {
              invoice_data: invoice,
              items_data: itemsPayload,
            });
            if (rpcError) throw rpcError;
            return;
          }
          case 'invoice:delete': {
            const { id } = mutation.payload;
            const { error } = await supabase.from('invoices').delete().eq('id', id);
            if (error) throw error;
            return;
          }
          case 'invoice:updateStatus': {
            const { id, status } = mutation.payload;
            const { error } = await supabase.from('invoices').update({ status }).eq('id', id);
            if (error) throw error;
            return;
          }
          case 'credentials:update': {
            const { user } = mutation.payload;
            if (!supabase) throw new Error('Supabase client not configured');
            let userId = user.id ?? undefined;
            if (!userId) {
              const { data: existing, error: fetchError } = await supabase
                .from('app_users')
                .select('id')
                .order('createdAt', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fetchError) throw fetchError;
              userId = existing?.id ?? undefined;
            }
            const payload = {
              id: userId,
              email: user.email,
              password: user.password,
              role: 'admin',
              active: true,
              pin: user.pin,
            };
            const { error, data } = await supabase.from('app_users').upsert(payload).select().single();
            if (error) throw error;
            set({
              userId: data?.id ?? userId ?? null,
              userEmail: user.email,
              userPassword: user.password,
              invoiceEditPin: user.pin,
            });
            return;
          }
          default:
            console.warn('[OfflineQueue] Unknown mutation type', mutation.type);
        }
      };

      const flushPendingMutations = async () => {
        const queued = get().pendingMutations;
        if (!queued.length) {
          set({ lastSyncMessage: null });
          return;
        }
        if (!supabase) {
          set({ lastSyncMessage: `Waiting for connection (${queued.length})` });
          return;
        }
        set({ lastSyncMessage: `Syncing ${queued.length} pending change${queued.length === 1 ? '' : 's'}...` });
        while (true) {
          const next = get().pendingMutations[0];
          if (!next) break;
          try {
            await executePendingMutation(next);
            set((state) => ({
              pendingMutations: state.pendingMutations.filter((m) => m.id !== next.id),
            }));
          } catch (error) {
            if (isLikelyOfflineError(error)) {
              set({ lastSyncMessage: `Waiting for connection (${get().pendingMutations.length})` });
              return;
            }
            set({ lastSyncMessage: 'Sync failed' });
            if (error instanceof Error) throw error;
            throw new Error('Failed to sync pending changes.');
          }
        }
        set({ lastSyncMessage: 'All changes synced' });
      };

      return {
      barbers: initialBarbers,
      services: initialServices,
      packages: initialPackages,
      customers: [],
      invoices: [],
      cart: [],
      isAuthenticated: false,
      userEmail: 'admin@vistasaloon.local',
      userPassword: 'VistaLocal123!',
      userId: null,
      invoiceEditPin: '9999',
      pendingMutations: [],
      lastSyncMessage: null,

      addBarber: async (barber) => {
        const previousBarbers = get().barbers;
        set({ barbers: [...previousBarbers, barber] });
        const rollback = () => set({ barbers: previousBarbers });
        try {
          await runOrQueue('barber:add', { barber }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('barbers').upsert(barber);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to add barber. Please try again.');
        }
      },
      updateBarber: async (updated) => {
        const previousBarbers = get().barbers;
        set({
          barbers: previousBarbers.map((b) => (b.id === updated.id ? updated : b)),
        });
        const rollback = () => set({ barbers: previousBarbers });
        try {
          await runOrQueue('barber:update', { barber: updated }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('barbers').upsert(updated);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to update barber. Please try again.');
        }
      },
      removeBarber: async (id) => {
        const { barbers: previousBarbers } = get();
        set({
          barbers: previousBarbers.map((b) => (b.id === id ? { ...b, active: false } : b)),
        });
        const rollback = () => set({ barbers: previousBarbers });
        try {
          await runOrQueue('barber:remove', { id }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error: deleteError } = await supabase.from('barbers').update({ active: false }).eq('id', id);
            if (deleteError) throw deleteError;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to remove barber. Please try again.');
        }
      },

      addService: async (service) => {
        const previousServices = get().services;
        set({ services: [...previousServices, service] });
        const rollback = () => set({ services: previousServices });
        try {
          await runOrQueue('service:add', { service }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('services').upsert(service);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to add service. Please try again.');
        }
      },
      updateService: async (updated) => {
        const previousServices = get().services;
        set({
          services: previousServices.map((s) => (s.id === updated.id ? updated : s)),
        });
        const rollback = () => set({ services: previousServices });
        try {
          await runOrQueue('service:update', { service: updated }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('services').upsert(updated);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to update service. Please try again.');
        }
      },
      removeService: async (id) => {
        const { services: previousServices } = get();
        set({
          services: previousServices.map((s) => (s.id === id ? { ...s, active: false } : s)),
        });
        const rollback = () => set({ services: previousServices });
        try {
          await runOrQueue('service:remove', { id }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error: deleteError } = await supabase.from('services').update({ active: false }).eq('id', id);
            if (deleteError) throw deleteError;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to remove service. Please try again.');
        }
      },

      reorderServices: (fromIndex, toIndex) => set((state) => {
        const newServices = [...state.services];
        const [movedItem] = newServices.splice(fromIndex, 1);
        newServices.splice(toIndex, 0, movedItem);
        return { services: newServices };
      }),

      addPackage: async (pkg) => {
        const previousPackages = get().packages;
        set({ packages: [...previousPackages, pkg] });
        const rollback = () => set({ packages: previousPackages });
        try {
          await runOrQueue('package:add', { pkg }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase
              .from('service_packages')
              .upsert({ id: pkg.id, name: pkg.name, price: pkg.price, active: pkg.active ?? true });
            if (error) throw error;

            await supabase.from('service_package_items').delete().eq('packageId', pkg.id);
            const itemsPayload = pkg.services.map((name, idx) => ({
              packageId: pkg.id,
              serviceName: name,
              position: idx,
            }));
            if (itemsPayload.length) {
              const { error: itemsError } = await supabase.from('service_package_items').insert(itemsPayload);
              if (itemsError) throw itemsError;
            }
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to add package. Please try again.');
        }
      },

      updatePackage: async (pkg) => {
        const previousPackages = get().packages;
        set({
          packages: previousPackages.map((p) => (p.id === pkg.id ? pkg : p)),
        });
        const rollback = () => set({ packages: previousPackages });
        try {
          await runOrQueue('package:update', { pkg }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase
              .from('service_packages')
              .upsert({ id: pkg.id, name: pkg.name, price: pkg.price, active: pkg.active ?? true });
            if (error) throw error;

            await supabase.from('service_package_items').delete().eq('packageId', pkg.id);
            const itemsPayload = pkg.services.map((name, idx) => ({
              packageId: pkg.id,
              serviceName: name,
              position: idx,
            }));
            if (itemsPayload.length) {
              const { error: itemsError } = await supabase.from('service_package_items').insert(itemsPayload);
              if (itemsError) throw itemsError;
            }
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to update package. Please try again.');
        }
      },

      removePackage: async (id) => {
        const previousPackages = get().packages;
        set({ packages: previousPackages.filter((p) => p.id !== id) });
        const rollback = () => set({ packages: previousPackages });
        try {
          await runOrQueue('package:remove', { id }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error: itemsError } = await supabase.from('service_package_items').delete().eq('packageId', id);
            if (itemsError) throw itemsError;
            const { error: deleteError } = await supabase.from('service_packages').delete().eq('id', id);
            if (deleteError) throw deleteError;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to remove package. Please try again.');
        }
      },

      reorderPackages: (fromIndex, toIndex) => set((state) => {
        const next = [...state.packages];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { packages: next };
      }),

      addCustomer: async (customer) => {
        const previousCustomers = get().customers;
        const duplicates = findDuplicateCustomers(previousCustomers, customer);
        if (duplicates.length) {
          throw new DuplicateCustomerError(duplicates);
        }

        set({ customers: [...previousCustomers, customer] });
        const rollback = () => set({ customers: previousCustomers });
        try {
          await runOrQueue('customer:add', { customer }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('customers').upsert(customer);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to add customer. Please try again.');
        }
      },
      updateCustomer: async (updated) => {
        const previousCustomers = get().customers;
        const duplicates = findDuplicateCustomers(previousCustomers, updated, updated.id);
        if (duplicates.length) {
          throw new DuplicateCustomerError(duplicates);
        }

        set({
          customers: previousCustomers.map((c) => (c.id === updated.id ? updated : c)),
        });
        const rollback = () => set({ customers: previousCustomers });
        try {
          await runOrQueue('customer:update', { customer: updated }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('customers').upsert(updated);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to update customer. Please try again.');
        }
      },

      removeCustomer: async (id) => {
        const { customers: previousCustomers } = get();
        set({
          customers: previousCustomers.map((c) => (c.id === id ? { ...c, active: false } : c)),
        });
        const rollback = () => set({ customers: previousCustomers });
        try {
          await runOrQueue('customer:remove', { id }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase.from('customers').update({ active: false }).eq('id', id);
            if (error) throw error;
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to remove customer. Please try again.');
        }
      },

      addToCart: (item) => set((state) => ({ cart: [...state.cart, item] })),
      removeFromCart: (index) => set((state) => ({
        cart: state.cart.filter((_, i) => i !== index),
      })),
      clearCart: () => set({ cart: [] }),

      createInvoice: async (invoice) => {
        const previousInvoices = get().invoices;
        set({ invoices: [invoice, ...previousInvoices] });
        const state = get();

        const customer = invoice.customerId
          ? state.customers.find((c) => c.id === invoice.customerId)
          : null;

        // Ensure referenced records exist to satisfy FKs
        const lineBarbers = Array.from(
          new Map(
            invoice.items.map((i) => [i.barberId, i])
          ).values()
        ).filter((i) => i.barberId);

        const barberRows = lineBarbers.map((i) => {
          const existing = state.barbers.find((b) => b.id === i.barberId);
          return {
            id: i.barberId,
            name: i.barberName,
            active: existing?.active ?? true,
            commissionRate: existing?.commissionRate ?? 0,
          } as Barber;
        });

        const rollback = () => set({ invoices: previousInvoices });
        const payload = { invoice, customer, barberRows };
        try {
          await runOrQueue('invoice:create', payload, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const tasks: PromiseLike<any>[] = [];
            if (customer) tasks.push(supabase.from('customers').upsert(customer));
            if (barberRows.length) tasks.push(supabase.from('barbers').upsert(barberRows));

            const results = await Promise.all(tasks);
            for (const r of results) {
              if (r?.error) {
                const details = r.error?.message;
                throw new Error(details ? `Failed to sync related records: ${details}` : 'Failed to sync related records before saving invoice.');
              }
            }

            const { error: invError } = await supabase.from('invoices').insert(invoice);
            if (invError) throw new Error(invError.message || 'Failed to save invoice.');

            const itemsPayload = await buildInvoiceItemsPayload(invoice);

            if (itemsPayload.length) {
              const { error: itemsError } = await supabase.from('invoice_items').insert(itemsPayload);
              if (itemsError) throw new Error(itemsError.message || 'Failed to save invoice line items.');
            }
          }, rollback);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error('Failed to save invoice.');
        }
      },

      updateInvoiceStatus: async (id, status) => {
        const previousInvoices = get().invoices;
        set({
          invoices: previousInvoices.map((inv) =>
            inv.id === id ? { ...inv, status } : inv
          ),
        });
        const rollback = () => set({ invoices: previousInvoices });
        try {
          await runOrQueue('invoice:updateStatus', { id, status }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase
              .from('invoices')
              .update({ status })
              .eq('id', id);
            if (error) throw new Error(error.message || 'Failed to update invoice status.');
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to update invoice status.');
        }
      },

      deleteInvoice: async (id) => {
        const previousInvoices = get().invoices;
        set({
          invoices: previousInvoices.filter((inv) => inv.id !== id),
        });
        const rollback = () => set({ invoices: previousInvoices });
        try {
          await runOrQueue('invoice:delete', { id }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const { error } = await supabase
              .from('invoices')
              .delete()
              .eq('id', id);
            if (error) throw new Error(error.message || 'Failed to delete invoice.');
          }, rollback);
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Failed to delete invoice.');
        }
      },

      updateInvoice: async (invoice) => {
        const previousInvoices = get().invoices;
        set({
          invoices: previousInvoices.map((inv) => (inv.id === invoice.id ? invoice : inv)),
        });
        const state = get();
        const customer = invoice.customerId
          ? state.customers.find((c) => c.id === invoice.customerId)
          : null;

        const lineBarbers = Array.from(new Map(invoice.items.map((i) => [i.barberId, i])).values()).filter((i) => i.barberId);

        const barberRows = lineBarbers.map((i) => {
          const existing = state.barbers.find((b) => b.id === i.barberId);
          return {
            id: i.barberId,
            name: i.barberName,
            active: existing?.active ?? true,
            commissionRate: existing?.commissionRate ?? 0,
          } as Barber;
        });
        const rollback = () => set({ invoices: previousInvoices });
        const payload = { invoice, customer, barberRows };
        try {
          await runOrQueue('invoice:update', payload, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            const tasks: PromiseLike<any>[] = [];
            if (customer) tasks.push(supabase.from('customers').upsert(customer));
            if (barberRows.length) tasks.push(supabase.from('barbers').upsert(barberRows));

            const preResults = await Promise.all(tasks);
            for (const r of preResults) {
              if (r?.error) {
                const details = r.error?.message;
                throw new Error(details ? `Failed to sync related records: ${details}` : 'Failed to sync related records before updating invoice.');
              }
            }

            const { error: invError } = await supabase.from('invoices').upsert(invoice);
            if (invError) throw new Error(invError.message || 'Failed to update invoice.');

            const deleteItemsResult = await supabase.from('invoice_items').delete().eq('invoiceId', invoice.id);
            if (deleteItemsResult.error) throw new Error(deleteItemsResult.error.message || 'Failed to update invoice line items.');

            const itemsPayload = await buildInvoiceItemsPayload(invoice);

            if (itemsPayload.length) {
              const { error: itemsError } = await supabase.from('invoice_items').insert(itemsPayload);
              if (itemsError) throw new Error(itemsError.message || 'Failed to update invoice line items.');
            }
          }, rollback);
        } catch (error) {
          if (error instanceof Error) throw error;
          throw new Error('Failed to update invoice.');
        }
      },

      login: async (email, password) => {
        const state = get();

        if (supabase) {
          const { data, error } = await supabase
            .from('app_users')
            .select('*')
            .order('createdAt', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            console.error('[Supabase] login fetch failed:', error);
          }

          if (data) {
            set({
              userId: data.id,
              userEmail: data.email,
              userPassword: data.password,
              invoiceEditPin: data.pin ?? state.invoiceEditPin,
            });

            if (email === data.email && password === data.password) {
              set({ isAuthenticated: true });
              return true;
            }
            return false;
          }
        }

        if (email === state.userEmail && password === state.userPassword) {
          set({ isAuthenticated: true });
          return true;
        }
        return false;
      },

      logout: () => set({ isAuthenticated: false }),

      updateCredentials: async (email, password) => {
        const state = get();
        const previous = { userEmail: state.userEmail, userPassword: state.userPassword, userId: state.userId };
        set({ userEmail: email, userPassword: password });
        const rollback = () => set({ userEmail: previous.userEmail, userPassword: previous.userPassword, userId: previous.userId });
        const payloadUser = {
          id: state.userId ?? undefined,
          email,
          password,
          pin: state.invoiceEditPin,
        };

        try {
          await runOrQueue('credentials:update', { user: payloadUser }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            let userId = payloadUser.id;
            if (!userId) {
              const { data: existing, error: fetchError } = await supabase
                .from('app_users')
                .select('id')
                .order('createdAt', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fetchError) throw fetchError;
              userId = existing?.id ?? undefined;
            }

            const payload = { id: userId, email, password, role: 'admin', active: true, pin: state.invoiceEditPin };
            const { error, data } = await supabase.from('app_users').upsert(payload).select().single();
            if (error) throw error;
            if (data?.id) {
              set({ userId: data.id, userEmail: data.email, userPassword: data.password, invoiceEditPin: data.pin ?? state.invoiceEditPin });
            }
          }, rollback);
        } catch (error) {
          rollback();
          const message = error instanceof Error ? error.message : 'Failed to update credentials. Please try again.';
          throw new Error(message);
        }
      },

      verifyInvoicePin: (pin) => get().invoiceEditPin === pin,

      updateInvoicePin: async (current, next) => {
        const state = get();
        if (current !== state.invoiceEditPin) return false;
        const previousPin = state.invoiceEditPin;
        set({ invoiceEditPin: next });
        const rollback = () => set({ invoiceEditPin: previousPin });
        const payloadUser = {
          id: state.userId ?? undefined,
          email: state.userEmail,
          password: state.userPassword,
          pin: next,
        };

        try {
          await runOrQueue('credentials:update', { user: payloadUser }, async () => {
            if (!supabase) throw new Error('Supabase unavailable');
            let userId = payloadUser.id;
            if (!userId) {
              const { data: existing, error: fetchError } = await supabase
                .from('app_users')
                .select('id')
                .order('createdAt', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (fetchError) throw fetchError;
              userId = existing?.id ?? undefined;
            }

            const payload = {
              id: userId,
              email: state.userEmail,
              password: state.userPassword,
              role: 'admin',
              active: true,
              pin: next,
            };

            const { error, data } = await supabase.from('app_users').upsert(payload).select().single();
            if (error) throw error;
            if (data?.id) {
              set({ userId: data.id, userEmail: data.email, userPassword: data.password, invoiceEditPin: data.pin });
            }
          }, rollback);
          return true;
        } catch (error) {
          rollback();
          const message = error instanceof Error ? error.message : 'Failed to update invoice PIN. Please try again.';
          throw new Error(message);
        }
      },

      syncData: async () => {
        await flushPendingMutations().catch((error) => {
          console.warn('[OfflineQueue] flush before sync failed:', error);
        });
        if (!supabase) return;

        const [barbersRes, servicesRes, packagesRes, packageItemsRes, customersRes, invoicesRes, usersRes] = await Promise.all([
          supabase.from('barbers').select('*'),
          supabase.from('services').select('*'),
          supabase.from('service_packages').select('*'),
          supabase.from('service_package_items').select('*').order('position', { ascending: true }),
          supabase.from('customers').select('*'),
          supabase.from('invoices').select('*').order('createdAt', { ascending: false }).limit(10000),
          supabase.from('app_users').select('*').order('createdAt', { ascending: false }).limit(1),
        ]);

        const anyError = barbersRes.error || servicesRes.error || packagesRes.error || packageItemsRes.error || customersRes.error || invoicesRes.error || usersRes.error;
        if (anyError) {
          console.error('[Supabase] syncData failed:', anyError);
          return;
        }

        // Seed defaults if tables are empty
        if ((barbersRes.data?.length ?? 0) === 0) {
          await supabase.from('barbers').upsert(initialBarbers);
          barbersRes.data = initialBarbers;
        }

        let packagesData = packagesRes.data ?? [];
        if ((packagesData.length ?? 0) === 0) {
          // seed packages and items
          await supabase.from('service_packages').upsert(initialPackages.map((p) => ({
            id: p.id,
            name: p.name,
            price: p.price,
            active: p.active ?? true,
          })));

          const seedItems = initialPackages.flatMap((p) =>
            p.services.map((name, idx) => ({ packageId: p.id, serviceName: name, position: idx }))
          );
          if (seedItems.length) {
            await supabase.from('service_package_items').insert(seedItems);
          }

          packagesData = initialPackages as any;
        }

        const itemsByPackage = new Map<string, { serviceName: string; position: number }[]>();
        (packageItemsRes.data ?? []).forEach((row) => {
          const arr = itemsByPackage.get(row.packageId) ?? [];
          arr.push({ serviceName: row.serviceName, position: row.position ?? 0 });
          itemsByPackage.set(row.packageId, arr);
        });

        const packagesFromDb: ServicePackage[] = (packagesData ?? []).map((pkg) => {
          const items = (itemsByPackage.get(pkg.id) ?? []).sort((a, b) => a.position - b.position);
          return {
            id: pkg.id,
            name: pkg.name,
            price: Number(pkg.price ?? 0),
            active: pkg.active ?? true,
            services: items.map((i) => i.serviceName),
          } as ServicePackage;
        });

        const userRow = usersRes.data?.[0];

        set(() => ({
          barbers: barbersRes.data ?? initialBarbers,
          services: servicesRes.data ?? initialServices,
          packages: packagesFromDb.length ? packagesFromDb : initialPackages,
          customers: customersRes.data ?? [],
          invoices: invoicesRes.data ?? [],
          userId: userRow?.id ?? null,
          userEmail: userRow?.email ?? 'admin@vistasaloon.local',
          userPassword: userRow?.password ?? 'VistaLocal123!',
          invoiceEditPin: userRow?.pin ?? '9999',
          cart: [],
        }));
      },
      enqueuePendingMutation: (mutation) => enqueuePendingMutationInternal(mutation),
      flushPendingMutations,
      };
    },
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ 
        // Keep local workspace data across sessions.
        barbers: state.barbers,
        services: state.services,
        packages: state.packages,
        customers: state.customers,
        invoices: state.invoices,
        userEmail: state.userEmail,
        userPassword: state.userPassword,
        userId: state.userId,
        isAuthenticated: state.isAuthenticated,
        invoiceEditPin: state.invoiceEditPin,
        pendingMutations: state.pendingMutations,
        lastSyncMessage: state.lastSyncMessage
      }),
    }
  )
);

if (typeof window !== 'undefined') {
  const { flushPendingMutations } = useStore.getState();
  flushPendingMutations().catch((error) => {
    console.warn('[OfflineQueue] Initial flush failed:', error);
  });

  window.addEventListener('online', () => {
    const { flushPendingMutations: flush } = useStore.getState();
    flush().catch((error) => {
      console.warn('[OfflineQueue] Auto-flush failed:', error);
    });
  });

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    (useStore.persist.rehydrate() as Promise<void>).catch((error) => {
      console.warn('[Store] Cross-tab sync failed:', error);
    });
  });
}
