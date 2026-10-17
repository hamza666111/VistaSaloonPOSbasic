import { useAppSettings } from '../store/useAppSettings';
import { Invoice } from '../types';

export type InvoiceSaveAction = 'save' | 'print' | 'whatsapp';
const configuredCode = import.meta.env.VITE_WHATSAPP_DEFAULT_COUNTRY_CODE || '92';
export const defaultWhatsAppCountryCode = /^[1-9]\d{0,2}$/.test(configuredCode) ? configuredCode : '92';

// Click-to-chat needs a full international number, with no + or punctuation.
// Local Pakistani mobile numbers are normalized using the installation's country code.
export function normalizeWhatsAppPhone(value: string, countryCode = defaultWhatsAppCountryCode): string | null {
  const raw = value.trim().replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 1632)).replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 1776));
  if (!raw || (raw.match(/\+/g) || []).length > 1 || !/^[+\d\s().-]+$/.test(raw) || (raw.includes('+') && !raw.startsWith('+'))) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) { /* Already international. */ }
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) {
    if (countryCode === '92' && !/^03\d{9}$/.test(digits)) return null;
    if (!/^0[1-9]\d{6,12}$/.test(digits)) return null;
    digits = countryCode + digits.slice(1);
  } else if (countryCode === '92' && /^3\d{9}$/.test(digits)) digits = countryCode + digits;
  else if (countryCode === '1' && /^[2-9]\d{9}$/.test(digits)) digits = countryCode + digits;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
export function invoiceWhatsAppMessage(invoice: Invoice): string {
  const branding=useAppSettings.getState().settings;
  const money = (value: number) => `Rs. ${value.toFixed(2)}`;
  const lines = [
    `*${branding.salonName}*`,
    ...(branding.address ? [branding.address] : []),
    ...(branding.phone ? [`Contact: ${branding.phone}`] : []),
    'Invoice receipt',
    `Invoice: ${invoice.id}`, `Date: ${new Date(invoice.date).toLocaleString()}`,
    `Customer: ${invoice.customerName}`, '', '*Services*',
    ...invoice.items.map((item, index) => `${index + 1}. ${item.serviceName} - ${money(item.price)}`),
    '', `Subtotal: ${money(invoice.subtotal)}`,
  ];
  if (invoice.discount > 0) lines.push(`Discount: -${money(invoice.discount)}${invoice.discountType === 'percent' && invoice.discountValue !== undefined ? ` (${invoice.discountValue}%)` : ''}`);
  lines.push(`*Total: ${money(invoice.total)}*`, `Status: ${invoice.status === 'paid' ? 'Paid' : invoice.status === 'pending' ? 'Unpaid' : 'Cancelled'}`, `Payment: ${invoice.paymentMode === 'online' ? 'Online' : 'Cash'}`, '', 'Thank you for visiting!');
  return lines.join('\n');
}
export function invoiceWhatsAppUrl(invoice: Invoice, phone: string): string | null {
  const international = normalizeWhatsAppPhone(phone);
  return international ? `https://wa.me/${international}?text=${encodeURIComponent(invoiceWhatsAppMessage(invoice))}` : null;
}
export function reserveWhatsAppWindow(): Window | null {
  let target: Window | null;
  try { target = window.open('about:blank', '_blank'); } catch { return null; }
  if (target) {
    try {
      target.opener = null;
      target.document.title = 'Preparing invoice';
      target.document.body.textContent = 'Saving your invoice before opening WhatsApp...';
    } catch { /* Navigation can still proceed if the browser hides the reserved tab. */ }
  }
  return target;
}
export function openPreparedWhatsApp(target: Window | null, url: string): boolean {
  if (!target || target.closed) return false;
  try { target.location.replace(url); return true; }
  catch { try { target.close(); } catch { /* Browser owns this window. */ } return false; }
}
