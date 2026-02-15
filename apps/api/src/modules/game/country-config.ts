import type { CountryCode } from '@mls/shared/constants';

export interface CountryConfig {
  country: CountryCode;
  dailyEventProbability: number;
  promotionMinDays: number[];
  promotionMinPoints: number[];
}

export const COUNTRY_CONFIG: Record<CountryCode, CountryConfig> = {
  US: {
    country: 'US',
    dailyEventProbability: 0.18,
    promotionMinDays: [30, 45, 60, 75, 95, 120, 145, 170, 205, 255, 315, 380, 9999],
    promotionMinPoints: [8, 12, 18, 24, 32, 40, 48, 54, 64, 78, 94, 112, 9999]
  }
};
