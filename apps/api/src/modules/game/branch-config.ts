import type { BranchCode } from '@mls/shared/constants';

export interface DeploymentProfile {
  patrol: {
    successChance: number;
    injuryChance: number;
    rewardCents: [number, number];
    healthLoss: [number, number];
    moraleLoss: [number, number];
    promotionPoints: [number, number];
  };
  support: {
    successChance: number;
    injuryChance: number;
    rewardCents: [number, number];
    healthLoss: [number, number];
    moraleLoss: [number, number];
    promotionPoints: [number, number];
  };
}

export interface BranchConfig {
  branch: BranchCode;
  ranks: string[];
  salaryPerDayCents: number[];
  eventChanceModifier: number;
  deployment: DeploymentProfile;
}

export const BRANCH_CONFIG: Record<BranchCode, BranchConfig> = {
  US_ARMY: {
    branch: 'US_ARMY',
    ranks: ['PV1', 'PV2', 'PFC', 'SPC', 'SGT', 'SSG', 'SFC', 'Lieutenant', 'Captain', 'Brigadier General', 'Major General', 'Lieutenant General', 'General'],
    salaryPerDayCents: [4200, 4500, 4900, 5400, 6200, 7100, 8100, 9000, 9400, 9800, 11600, 13600, 16000],
    eventChanceModifier: 1.08,
    deployment: {
      patrol: {
        successChance: 0.62,
        injuryChance: 0.21,
        rewardCents: [3500, 12000],
        healthLoss: [4, 18],
        moraleLoss: [2, 10],
        promotionPoints: [2, 8]
      },
      support: {
        successChance: 0.78,
        injuryChance: 0.11,
        rewardCents: [2400, 8500],
        healthLoss: [2, 10],
        moraleLoss: [1, 6],
        promotionPoints: [1, 5]
      }
    }
  },
  US_NAVY: {
    branch: 'US_NAVY',
    ranks: ['SR', 'SA', 'SN', 'PO3', 'PO2', 'PO1', 'CPO', 'Lieutenant', 'Captain', 'Brigadier General', 'Major General', 'Lieutenant General', 'General'],
    salaryPerDayCents: [4300, 4700, 5100, 5600, 6500, 7400, 8500, 9200, 9700, 10100, 11900, 14000, 16400],
    eventChanceModifier: 0.97,
    deployment: {
      patrol: {
        successChance: 0.68,
        injuryChance: 0.16,
        rewardCents: [3100, 10000],
        healthLoss: [3, 14],
        moraleLoss: [2, 8],
        promotionPoints: [2, 7]
      },
      support: {
        successChance: 0.82,
        injuryChance: 0.09,
        rewardCents: [2200, 7600],
        healthLoss: [2, 8],
        moraleLoss: [1, 5],
        promotionPoints: [1, 4]
      }
    }
  }
};
