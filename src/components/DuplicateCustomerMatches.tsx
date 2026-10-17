import React from 'react';
import { Customer } from '../types';
import { DuplicateCustomerMatch, formatDuplicateMatchReason } from '../utils/customerDuplicates';

interface Props {
  matches: DuplicateCustomerMatch[];
  onUseCustomer?: (customer: Customer) => void;
  actionLabel?: string;
}

export const DuplicateCustomerMatches: React.FC<Props> = ({
  matches,
  onUseCustomer,
  actionLabel = 'Use customer',
}) => {
  if (!matches.length) return null;

  return (
    <div className="space-y-3">
      {matches.map((match) => (
        <div key={match.customer.id} className="rounded-xl border border-teal-200 bg-teal-50/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-gray-900">{match.customer.name}</div>
              <div className="text-sm text-gray-600">{match.customer.phone}</div>
              {match.customer.email && (
                <div className="truncate text-xs text-gray-500">{match.customer.email}</div>
              )}
            </div>
            {onUseCustomer && (
              <button
                type="button"
                onClick={() => onUseCustomer(match.customer)}
                className="shrink-0 rounded-lg border border-teal-300 bg-white px-3 py-2 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-100"
              >
                {actionLabel}
              </button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-gray-700">
              {formatDuplicateMatchReason(match)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};