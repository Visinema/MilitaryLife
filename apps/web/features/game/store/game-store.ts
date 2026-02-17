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

export const useGameStore = create<GameState>((set) => ({
  snapshot: null,
  clockOffsetMs: 0,
  loading: true,
  error: null,
  setSnapshot: (snapshot) =>
    set({
      snapshot,
      clockOffsetMs: snapshot.serverNowMs - Date.now(),
      loading: false,
      error: null
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  reset: () => set({ snapshot: null, clockOffsetMs: 0, loading: false, error: null })
}));
