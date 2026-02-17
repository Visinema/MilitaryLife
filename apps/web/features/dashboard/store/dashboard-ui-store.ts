'use client';

import { create } from 'zustand';

export type DashboardPanelTab = 'status' | 'command' | 'location';

interface DashboardUiState {
  panelTab: DashboardPanelTab;
  setPanelTab: (tab: DashboardPanelTab) => void;
}

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  panelTab: 'status',
  setPanelTab: (tab) => set({ panelTab: tab })
}));

