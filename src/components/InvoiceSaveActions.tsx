import React from 'react';
import { Save, Printer, MessageCircle } from 'lucide-react';
import { InvoiceSaveAction } from '../utils/invoiceWhatsApp';

export const InvoiceSaveActions: React.FC<{
  onAction: (action: InvoiceSaveAction) => void;
  alreadySaved?: boolean;
  busy?: boolean;
  disabled?: boolean;
  whatsAppUnavailable?: string;
}> = ({ onAction, alreadySaved = false, busy = false, disabled = false, whatsAppUnavailable }) => <div className="invoice-save-controls">
  <div className={`invoice-save-actions${alreadySaved ? ' invoice-saved-actions' : ''}`}>
    {!alreadySaved && <button type="button" disabled={busy || disabled} onClick={() => onAction('save')} className="invoice-save-action invoice-save-only"><Save size={16} /><span>Save only</span></button>}
    <button type="button" disabled={busy || disabled} onClick={() => onAction('print')} className="invoice-save-action invoice-save-print"><Printer size={16} /><span>{alreadySaved ? 'Print' : 'Save + Print'}</span></button>
    <button type="button" disabled={busy || disabled || !!whatsAppUnavailable} title={whatsAppUnavailable} onClick={() => onAction('whatsapp')} className="invoice-save-action invoice-save-whatsapp"><MessageCircle size={16} /><span>{alreadySaved ? 'WhatsApp' : 'Save + WhatsApp'}</span></button>
  </div>
  {busy ? <p role="status" className="invoice-action-hint">{alreadySaved ? 'Preparing invoice...' : 'Saving invoice...'}</p> : whatsAppUnavailable && <p className="invoice-action-hint">{whatsAppUnavailable}</p>}
</div>;
