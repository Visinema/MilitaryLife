'use client';

import { create } from 'zustand';

interface UiState {
  pauseToken: string | null;
  setPauseToken: (token: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  pauseToken: null,
  setPauseToken: (token) => set({ pauseToken: token })
}));
