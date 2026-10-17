import type { Barber, Service, ServicePackage } from '../types';
import { newUuid } from '../utils/uuid';

export const initialBarbers: Barber[] = [
  { id: newUuid(), name: 'Stylist 01', active: true, commissionRate: 0 },
  { id: newUuid(), name: 'Stylist 02', active: true, commissionRate: 0 },
  { id: newUuid(), name: 'Stylist 03', active: true, commissionRate: 0 },
  { id: newUuid(), name: 'Stylist 04', active: true, commissionRate: 0 },
];

export const initialServices: Service[] = [
  // Hair Cut
  { id: newUuid(), name: 'Hair Cut - Regular', price: 400, active: true },
  { id: newUuid(), name: 'Hair Cut - Kids', price: 400, active: true },
  { id: newUuid(), name: 'Hair Cut - Fade', price: 600, active: true },

  // Beard Cut
  { id: newUuid(), name: 'Beard Cut - Trim', price: 300, active: true },
  { id: newUuid(), name: 'Beard Cut - Fade', price: 350, active: true },
  { id: newUuid(), name: 'Beard Cut - Clean', price: 300, active: true },

  // Waxing
  { id: newUuid(), name: 'Waxing - Full Face', price: 600, active: true },
  { id: newUuid(), name: 'Waxing - Cheeks', price: 200, active: true },
  { id: newUuid(), name: 'Waxing - Nose', price: 200, active: true },
  { id: newUuid(), name: 'Waxing - Ear', price: 200, active: true },

  // Massage
  { id: newUuid(), name: 'Massage - Head', price: 300, active: true },
  { id: newUuid(), name: 'Massage - Half Body', price: 600, active: true },
  { id: newUuid(), name: 'Massage - Full Body', price: 1000, active: true },

  // Hair Color
  { id: newUuid(), name: 'Hair Color - Head Keune', price: 1500, active: true },
  { id: newUuid(), name: 'Hair Color - Beard Keune', price: 700, active: true },
  { id: newUuid(), name: 'Hair Color - Head Eletik', price: 800, active: true },
  { id: newUuid(), name: 'Hair Color - Beard Eletik', price: 400, active: true },
  { id: newUuid(), name: 'Hair Color - Head Service', price: 250, active: true },
  { id: newUuid(), name: 'Hair Color - Beard Service', price: 150, active: true },

  // Others
  { id: newUuid(), name: 'Hair Polish', price: 1000, active: true },
  { id: newUuid(), name: 'Head Wash', price: 250, active: true },

  // Facial
  { id: newUuid(), name: 'Facial - Nature Life', price: 4500, active: true },
  { id: newUuid(), name: 'Facial - Derma Shine', price: 3000, active: true },
  { id: newUuid(), name: 'Facial - Dr Rashiel', price: 2500, active: true },
  { id: newUuid(), name: 'Facial - Cleansing', price: 1000, active: true },
];

export const initialPackages: ServicePackage[] = [
  {
    id: newUuid(),
    name: 'Gentlemen Starter',
    price: 1200,
    services: ['Hair Cut - Regular', 'Beard Cut - Trim', 'Head Wash'],
    active: true,
  },
  {
    id: newUuid(),
    name: 'Signature Glow',
    price: 2800,
    services: ['Hair Cut - Fade', 'Beard Cut - Fade', 'Facial - Cleansing', 'Massage - Head'],
    active: true,
  },
  {
    id: newUuid(),
    name: 'Color & Relax',
    price: 3200,
    services: ['Hair Color - Head Keune', 'Head Wash', 'Massage - Head'],
    active: true,
  },
];
