import { newUuid } from '../utils/uuid';
import { useServiceCategories } from '../store/useServiceCategories';
import { useStore } from '../store/useStore';
import { Barber, Customer, Invoice, InvoiceItem, Service, ServicePackage } from '../types';
import { isDemoMode } from './mode';

const SEED_MARKER = 'vistasaloon-demo-seeded-v1';

export function createDemoData() {
  const barbers: Barber[] = [
    { id: newUuid(), name: 'Aisha Noor', active: true, commissionRate: 20 },
    { id: newUuid(), name: 'Adam Reed', active: true, commissionRate: 18 },
    { id: newUuid(), name: 'Maya Rose', active: true, commissionRate: 25 },
    { id: newUuid(), name: 'Zain Ali', active: true, commissionRate: 15 },
    { id: newUuid(), name: 'Sara Khan', active: false, commissionRate: 20 },
  ];
  const catalog: [string, number, number][] = [
    ['Hair Cut - Regular', 400, 30], ['Hair Cut - Kids', 400, 25], ['Hair Cut - Fade', 600, 40],
    ['Cut & Blow Dry', 1800, 60], ['Beard Cut - Trim', 300, 15], ['Beard Cut - Fade', 350, 20],
    ['Hair Color - Full', 4500, 100], ['Balayage & Finish', 8500, 150], ['Hair Spa', 2200, 60],
    ['Head Wash', 250, 15], ['Facial - Cleansing', 1000, 40], ['Hydrating Facial', 3000, 60],
    ['Manicure', 1200, 40], ['Pedicure', 1600, 50], ['Waxing - Full Face', 600, 25],
    ['Massage - Head', 300, 20], ['Brow Shaping', 400, 15], ['Occasion Styling', 2800, 70],
    ['Keratin Treatment', 6500, 120], ['Bridal Consultation', 1500, 45],
  ];
  const services: Service[] = catalog.map(([name, price, duration], index) => ({
    id: newUuid(), name, price, duration, active: index !== 19,
  }));
  const packages: ServicePackage[] = [
    { id: newUuid(), name: 'Everyday Refresh', price: 2000, services: ['Cut & Blow Dry', 'Head Wash', 'Massage - Head'], active: true },
    { id: newUuid(), name: 'Groom & Go', price: 1000, services: ['Hair Cut - Fade', 'Beard Cut - Trim', 'Head Wash'], active: true },
    { id: newUuid(), name: 'Self-care Ritual', price: 4800, services: ['Hydrating Facial', 'Manicure', 'Pedicure'], active: true },
    { id: newUuid(), name: 'Color & Care', price: 6000, services: ['Hair Color - Full', 'Hair Spa', 'Head Wash'], active: true },
    { id: newUuid(), name: 'Seasonal Styling', price: 3000, services: ['Occasion Styling', 'Manicure'], active: false },
  ];
  const names = ['Emma Wilson', 'Omar Ahmed', 'Sophia James', 'Daniel Brooks', 'Amina Shah', 'Liam Parker', 'Noor Hassan', 'Olivia Reed', 'Ryan Malik', 'Zara Ali', 'James Carter', 'Leila Khan', 'Ethan Blake', 'Mia Collins', 'Aria Rose', 'Hugo Evans', 'Ava Scott', 'Sam Taylor'];
  const notes = ['Prefers a quiet appointment. Patch test before color.', 'Usually visits after work. Prefers a natural finish.', 'Interested in hair care packages.', 'Regular client. Likes a head massage after styling.'];
  const customers: Customer[] = names.map((name, index) => ({
    id: newUuid(), name, phone: `000${String(index + 1).padStart(8, '0')}`,
    email: `client${index + 1}@example.test`, notes: `Fictional demo client. ${notes[index % notes.length]}`,
    active: index !== 17,
  }));
  const invoices: Invoice[] = Array.from({ length: 84 }, (_, index): Invoice => {
    const daysAgo = index < 9 ? 0 : 1 + Math.floor((index - 9) * 0.9);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    date.setHours(9 + index % 10, index * 7 % 60, 0, 0);
    const walkIn = index % 11 === 0;
    const customer = customers[index % 17];
    const selections = [services[index % 19]];
    if (index % 3 !== 0) selections.push(services[(index + 4) % 19]);
    const items: InvoiceItem[] = selections.map((service, itemIndex) => {
      const member = barbers[(index + itemIndex) % 4];
      return { serviceId: service.id, serviceName: service.name, price: service.price, barberId: member.id, barberName: member.name };
    });
    if (index % 9 === 0) {
      const pkg = packages[index % 4];
      const member = barbers[index % 4];
      items.push({ serviceId: pkg.id, serviceName: pkg.name, price: pkg.price, barberId: member.id, barberName: member.name });
    }
    const subtotal = items.reduce((sum, item) => sum + item.price, 0);
    const discountType = index % 2 === 0 ? 'percent' : 'amount';
    const discountValue = index % 4 === 0 ? 10 : index % 5 === 0 ? 100 : 0;
    const discount = discountType === 'percent' ? subtotal * discountValue / 100 : Math.min(subtotal, discountValue);
    return {
      id: newUuid(), date: date.toISOString(),
      customerId: walkIn ? undefined : customer.id, customerName: walkIn ? 'Walk-in Customer' : customer.name,
      items, subtotal, discount, discountType, discountValue, total: subtotal - discount,
      status: index % 6 === 0 ? 'pending' : 'paid', paymentMode: index % 3 === 0 ? 'online' : 'cash',
    };
  }).sort((a, b) => b.date.localeCompare(a.date));
  return { barbers, services, packages, customers, invoices };
}

export function initializeDemoWorkspace() {
  if (!isDemoMode || localStorage.getItem(SEED_MARKER)) return;
  // Keep an existing local sign-in when opening the separate demo workspace.
  let isAuthenticated = useStore.getState().isAuthenticated;
  try {
    const previous = JSON.parse(localStorage.getItem('vistasaloon-basic-storage') || 'null');
    isAuthenticated ||= previous?.state?.isAuthenticated === true;
  } catch { /* The demo does not depend on another workspace's storage. */ }
  useStore.setState({ ...createDemoData(), isAuthenticated });
  localStorage.setItem(SEED_MARKER, 'true');
}

export function resetDemoWorkspace() {
  if (!isDemoMode) return;
  const data = createDemoData();
  useStore.setState({ ...data, cart: [], pendingMutations: [], lastSyncMessage: null });
  useServiceCategories.getState().reset(data.services);
  localStorage.setItem(SEED_MARKER, 'true');
  window.location.reload();
}
