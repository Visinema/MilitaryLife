import type { BranchCode } from './constants.js';

export const MAX_ACTIVE_NPCS = 30;

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
const DIVISIONS = ['Infantry Division', 'Naval Operations', 'Logistics Command', 'Signals & Cyber'];
const SUBDIVISIONS = ['Recon', 'Cyber', 'Support', 'Training', 'Forward Command', 'Rapid Response'];
const UNITS = ['1st Brigade', '2nd Fleet Group', 'Joint Recon Unit', 'Medical Support Unit', 'Rapid Response Group', 'Engineering Task Unit'];
const POSITIONS = ['Division Commander', 'Deputy Commander', 'Operations Officer', 'Intel Officer', 'Logistics Officer', 'Medical Officer'];

function pick<T>(arr: T[], idx: number): T {
  return arr[Math.abs(idx) % arr.length] as T;
}

function branchSeed(branch: BranchCode): number {
  return branch.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
}

export function getNpcIdentity(branch: BranchCode, slot: number): NpcIdentity {
  const seed = branchSeed(branch) + slot * 17;
  return {
    slot,
    name: `${pick(FIRST_NAMES, seed)} ${pick(LAST_NAMES, seed * 3)}`,
    division: pick(DIVISIONS, seed * 5),
    subdivision: pick(SUBDIVISIONS, seed * 7),
    unit: pick(UNITS, seed * 11),
    position: pick(POSITIONS, seed * 13)
  };
}

export function buildNpcRegistry(branch: BranchCode, count = MAX_ACTIVE_NPCS): NpcIdentity[] {
  return Array.from({ length: Math.max(1, count) }, (_, slot) => getNpcIdentity(branch, slot));
}
