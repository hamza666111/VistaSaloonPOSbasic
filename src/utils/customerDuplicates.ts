import { Customer } from '../types';

export interface DuplicateCustomerMatch {
  customer: Customer;
  matchedByName: boolean;
  matchedByPhone: boolean;
}

export class DuplicateCustomerError extends Error {
  readonly matches: DuplicateCustomerMatch[];

  constructor(matches: DuplicateCustomerMatch[]) {
    super('Customer already exists');
    this.name = 'DuplicateCustomerError';
    this.matches = matches;
  }
}

export const normalizeCustomerName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

export const getCustomerPhoneLastDigits = (value: string, count = 11) => {
  const digits = value.replace(/\D/g, '');
  return digits.length >= count ? digits.slice(-count) : '';
};

export const findDuplicateCustomers = (
  customers: Customer[],
  candidate: Pick<Customer, 'id' | 'name' | 'phone'>,
  excludeId?: string
) => {
  const phoneKey=(phone:string)=>getCustomerPhoneLastDigits(phone)||phone.replace(/\D/g,'');
  const phoneSuffix = phoneKey(candidate.phone);

  return customers
    .flatMap((existingCustomer) => {
      if (existingCustomer.id === candidate.id || existingCustomer.id === excludeId) {
        return [];
      }

      const matchedByPhone =
        phoneSuffix !== '' && phoneKey(existingCustomer.phone) === phoneSuffix;

      if (!matchedByPhone) {
        return [];
      }

      return [{ customer: existingCustomer, matchedByName: false, matchedByPhone }];
    })
    .sort((left, right) => {
      const leftScore = Number(left.matchedByName) + Number(left.matchedByPhone);
      const rightScore = Number(right.matchedByName) + Number(right.matchedByPhone);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.customer.name.localeCompare(right.customer.name, undefined, { sensitivity: 'base' });
    });
};

export const isDuplicateCustomerError = (error: unknown): error is DuplicateCustomerError =>
  error instanceof DuplicateCustomerError;

export const formatDuplicateMatchReason = (match: DuplicateCustomerMatch) => {
  if (match.matchedByName && match.matchedByPhone) {
    return 'Same name and last 11 digits of phone';
  }
  if (match.matchedByName) {
    return 'Same name';
  }
  return 'Same last 11 digits of phone';
};

export const formatDuplicateCustomerMessage = (matches: DuplicateCustomerMatch[]) => {
  if (!matches.length) {
    return 'Customer already exists.';
  }

  return [
    'Customer already exists.',
    'Matching customers:',
    ...matches.map(
      (match) =>
        `- ${match.customer.name} (${match.customer.phone}) - ${formatDuplicateMatchReason(match)}`
    ),
  ].join('\n');
};