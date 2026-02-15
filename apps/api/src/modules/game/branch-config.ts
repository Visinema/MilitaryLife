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

const UNIFIED_RANK = 'Operator';
const UNIFIED_RANKS = [UNIFIED_RANK];

export const BRANCH_CONFIG: Record<BranchCode, BranchConfig> = {
  US_ARMY: {
    branch: 'US_ARMY',
    ranks: UNIFIED_RANKS,
    salaryPerDayCents: [4200],
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
    ranks: UNIFIED_RANKS,
    salaryPerDayCents: [4300],
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
  },
  ID_TNI_AD: {
    branch: 'ID_TNI_AD',
    ranks: UNIFIED_RANKS,
    salaryPerDayCents: [1200],
    eventChanceModifier: 1.05,
    deployment: {
      patrol: {
        successChance: 0.58,
        injuryChance: 0.24,
        rewardCents: [1300, 5200],
        healthLoss: [5, 18],
        moraleLoss: [3, 10],
        promotionPoints: [2, 7]
      },
      support: {
        successChance: 0.74,
        injuryChance: 0.13,
        rewardCents: [900, 3500],
        healthLoss: [2, 9],
        moraleLoss: [1, 6],
        promotionPoints: [1, 4]
      }
    }
  },
  ID_TNI_AL: {
    branch: 'ID_TNI_AL',
    ranks: UNIFIED_RANKS,
    salaryPerDayCents: [1250],
    eventChanceModifier: 0.96,
    deployment: {
      patrol: {
        successChance: 0.63,
        injuryChance: 0.18,
        rewardCents: [1200, 4700],
        healthLoss: [4, 14],
        moraleLoss: [2, 8],
        promotionPoints: [2, 6]
      },
      support: {
        successChance: 0.79,
        injuryChance: 0.1,
        rewardCents: [950, 3600],
        healthLoss: [2, 8],
        moraleLoss: [1, 5],
        promotionPoints: [1, 4]
      }
    }
  }
};
