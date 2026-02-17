'use client';

import { create } from 'zustand';
import type { GameSnapshot } from '@mls/shared/game-types';

interface GameState {
  snapshot: GameSnapshot | null;
  clockOffsetMs: number;
  loading: boolean;
  error: string | null;
  setSnapshot: (snapshot: GameSnapshot) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const MAX_OFFSET_DRIFT_PER_SYNC_MS = 5_000;

function normalizeClockOffset(currentOffsetMs: number, serverNowMs: number): number {
  const measuredOffsetMs = serverNowMs - Date.now();
  if (!Number.isFinite(measuredOffsetMs)) {
    throw new Error('Invalid server timestamp received for clock offset calculation');
  }

  const driftMs = measuredOffsetMs - currentOffsetMs;
  if (!Number.isFinite(driftMs)) {
    throw new Error('Invalid clock drift detected while synchronizing client time');
  }

  if (Math.abs(driftMs) <= MAX_OFFSET_DRIFT_PER_SYNC_MS) {
    return measuredOffsetMs;
  }

  return currentOffsetMs + Math.sign(driftMs) * MAX_OFFSET_DRIFT_PER_SYNC_MS;
}

export const useGameStore = create<GameState>((set, get) => ({
  snapshot: null,
  clockOffsetMs: 0,
  loading: true,
  error: null,
  setSnapshot: (snapshot) => {
    const nextOffsetMs = normalizeClockOffset(get().clockOffsetMs, snapshot.serverNowMs);
    set({
      snapshot,
      clockOffsetMs: nextOffsetMs,
      loading: false,
      error: null
    });
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({ snapshot: null, clockOffsetMs: 0, loading: false, error: null })
}));
