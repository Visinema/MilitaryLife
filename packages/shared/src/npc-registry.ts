import type { BranchCode } from './constants.js';
import { DIVISION_REFERENCE_PROFILES } from './division-registry.js';

export const MAX_ACTIVE_NPCS = 120;

export interface NpcIdentity {
  slot: number;
  name: string;
  division: string;
  subdivision: string;
  unit: string;
  position: string;
}

const FIRST_NAMES = ['James', 'Michael', 'William', 'David', 'Joseph', 'Daniel', 'Matthew', 'Anthony', 'Andrew', 'Christopher', 'Robert', 'Thomas', 'Ryan', 'Logan', 'Nathan'];
const LAST_NAMES = ['Anderson', 'Walker', 'Rodriguez', 'Bennett', 'Parker', 'Morgan', 'Hughes', 'Cooper', 'Price', 'Foster', 'Sullivan', 'Reed', 'Campbell', 'Brooks', 'Hayes'];
const DIVISION_NAMES = DIVISION_REFERENCE_PROFILES.map((profile) => profile.name);

function pick<T>(arr: T[], idx: number): T {
  return arr[Math.abs(idx) % arr.length] as T;
}

function branchSeed(branch: BranchCode): number {
  return branch.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

export function getNpcIdentity(branch: BranchCode, slot: number): NpcIdentity {
  const seed = branchSeed(branch) + slot * 17;
  const profile = DIVISION_REFERENCE_PROFILES[Math.abs(seed * 5) % DIVISION_REFERENCE_PROFILES.length];

  return {
    slot,
    name: `${pick(FIRST_NAMES, seed)} ${pick(LAST_NAMES, seed * 3)}`,
    division: profile?.name ?? pick(DIVISION_NAMES, seed * 5),
    subdivision: pick(profile?.subdivisions ?? ['General Support Unit'], seed * 7),
    unit: pick(profile?.units ?? ['Command Response Team'], seed * 11),
    position: pick(profile?.positions ?? ['Operations Officer'], seed * 13)
  };
}

export function buildNpcRegistry(branch: BranchCode, count = MAX_ACTIVE_NPCS): NpcIdentity[] {
  return Array.from({ length: Math.max(1, count) }, (_, slot) => getNpcIdentity(branch, slot));
}
