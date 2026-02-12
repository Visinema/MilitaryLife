import type { BranchCode, CountryCode } from '@mls/shared/constants';

export const COUNTRY_OPTIONS: Array<{ value: CountryCode; label: string }> = [
  { value: 'US', label: 'United States' },
  { value: 'ID', label: 'Indonesia' }
];

export const BRANCH_OPTIONS: Record<CountryCode, Array<{ value: BranchCode; label: string }>> = {
  US: [
    { value: 'US_ARMY', label: 'Army' },
    { value: 'US_NAVY', label: 'Navy' }
  ],
  ID: [
    { value: 'ID_TNI_AD', label: 'TNI AD' },
    { value: 'ID_TNI_AL', label: 'TNI AL' }
  ]
};

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1';
