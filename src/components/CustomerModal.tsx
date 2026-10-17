import { newUuid } from '../utils/uuid';
import React, { useRef, useState } from 'react';
import { ResponsiveDialog } from './ResponsiveDialog';
import { Customer } from '../types';
import { X } from 'lucide-react';
import { DuplicateCustomerMatches } from './DuplicateCustomerMatches';
import { DuplicateCustomerMatch, isDuplicateCustomerError } from '../utils/customerDuplicates';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (customer: Customer) => Promise<void>;
  onUseExisting?: (customer: Customer) => void;
}

export const CustomerModal: React.FC<Props> = ({ isOpen, onClose, onSave, onUseExisting }) => {
  const creationId=useRef<string|null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateCustomerMatch[]>([]);

  if (!isOpen) return null;

  const clearDuplicateFeedback = () => {
    setError('');
    setDuplicateMatches([]);
  };

  const handleClose = () => {
    clearDuplicateFeedback();
    onClose();
  };

  const handleUseExisting = (customer: Customer) => {
    if (!onUseExisting) return;
    clearDuplicateFeedback();
    onUseExisting(customer);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearDuplicateFeedback();
    setIsSaving(true);
    try {
      await onSave({
        id: creationId.current ||= newUuid(),
        name,
        phone,
        email,
      });
      creationId.current=null;
      setName('');
      setPhone('');
      setEmail('');
      handleClose();
    } catch (err) {
      if (isDuplicateCustomerError(err)) {
        setError('Customer already exists. Review the matching customers below.');
        setDuplicateMatches(err.matches);
      } else {
        const message = err instanceof Error ? err.message : 'Failed to save customer.';
        setError(message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ResponsiveDialog label="New Customer" onClose={()=>{if(!isSaving)handleClose();}} className="max-w-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">New Customer</h2>
          <button type="button" aria-label="Close new customer" disabled={isSaving} onClick={handleClose}><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              id="new-customer-name" aria-label="Name" autoComplete="name"
              type="text"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (duplicateMatches.length || error) {
                  clearDuplicateFeedback();
                }
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone</label>
            <input
              id="new-customer-phone" aria-label="Phone" autoComplete="tel"
              type="tel"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (duplicateMatches.length || error) {
                  clearDuplicateFeedback();
                }
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email (optional)</label>
            <input
              id="new-customer-email" aria-label="Email (optional)" autoComplete="email"
              type="email"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 border p-2"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (duplicateMatches.length || error) {
                  clearDuplicateFeedback();
                }
              }}
            />
          </div>
          {duplicateMatches.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Matching Customers</div>
              <DuplicateCustomerMatches
                matches={duplicateMatches}
                onUseCustomer={onUseExisting ? handleUseExisting : undefined}
                actionLabel="Select customer"
              />
            </div>
          )}
          <button
            type="submit"
            disabled={isSaving}
            className={`w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {isSaving ? 'Saving...' : 'Save Customer'}
          </button>
        </form>
    </ResponsiveDialog>
  );
};
