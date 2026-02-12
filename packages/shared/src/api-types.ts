import type { GameSnapshot } from './game-types.js';

export interface AuthSession {
  userId: string;
  profileId: string | null;
  sid: string;
  expiresAt: string;
}

export interface AuthMeResponse {
  userId: string;
  email: string;
  profileId: string | null;
}

export interface SnapshotResponse {
  snapshot: GameSnapshot;
}
