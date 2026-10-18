export interface Barber {
  id: string;
  version?: number;
  name: string;
  active: boolean;
  commissionRate?: number; // percentage commission applied to this barber's sales
}

export interface Service {
  id: string;
  version?: number;
  name: string;
  price: number;
  duration?: number; // in minutes
  active: boolean;
}

export interface ServicePackage {
  id: string;
  version?: number;
  name: string;
  price: number;
  services: string[]; // human-readable service names included in the bundle
  active?: boolean;
}

export interface Customer {
  id: string;
  version?: number;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  active?: boolean;
}

export interface InvoiceItem {
  serviceId: string;
  serviceName: string;
  price: number;
  barberId: string;
  barberName: string;
}

export interface Invoice {
  syncStatus?: 'pending'|'blocked';
  syncError?: string;
  id: string;
  version?: number;
  date: string;
  customerId?: string;
  customerName: string;
  items: InvoiceItem[];
  subtotal: number;
  discount: number; // absolute discount amount applied to total
  discountType?: 'amount' | 'percent';
  discountValue?: number;
  total: number;
  status: 'paid' | 'pending' | 'cancelled';
  paymentMode?: 'cash' | 'online';
}
