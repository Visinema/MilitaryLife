'use client';

import { useDashboardUiStore, type DashboardPanelTab } from '@/store/dashboard-ui-store';

export type DashboardNavLink = { href: string; label: string };

export const DASHBOARD_PRIMARY_LINKS: ReadonlyArray<DashboardNavLink> = [
  { href: '/dashboard/career', label: 'Career' },
  { href: '/dashboard/training', label: 'Training' },
  { href: '/dashboard/deployment', label: 'Deployment' },
  { href: '/dashboard/academy', label: 'Academy' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/event-frame', label: 'Event Frame' },
  { href: '/dashboard/decision-log', label: 'Decision Log' },
  { href: '/dashboard/hierarchy', label: 'Hierarchy V5' },
  { href: '/dashboard/people', label: 'NPC / People' },
  { href: '/dashboard/mailbox', label: 'Mailbox' },
  { href: '/dashboard/social-profile', label: 'Social Profile' }
];

export const DASHBOARD_EXPANSION_LINKS: ReadonlyArray<DashboardNavLink> = [
  { href: '/dashboard/ceremony', label: 'Upacara Medal' },
  { href: '/dashboard/recruitment', label: 'Rekrutmen' },
  { href: '/dashboard/raider-attack', label: 'Raider Alert' },
  { href: '/dashboard/news', label: 'News' },
  { href: '/dashboard/medals', label: 'Medals' },
  { href: '/dashboard/division-ops', label: 'Division Ops' },
  { href: '/dashboard/military-court', label: 'Pending Sidang' },
  { href: '/dashboard/military-law', label: 'Military Law' }
];

function dedupeLinks(links: ReadonlyArray<DashboardNavLink>): DashboardNavLink[] {
  const byHref = new Map<string, DashboardNavLink>();
  for (const link of links) byHref.set(link.href, link);
  return Array.from(byHref.values());
}

export const DASHBOARD_ALL_LINKS: ReadonlyArray<DashboardNavLink> = dedupeLinks([
  ...DASHBOARD_PRIMARY_LINKS,
  ...DASHBOARD_EXPANSION_LINKS
]);

// Backward-compatible alias for older imports.
export const DASHBOARD_LINKS: ReadonlyArray<DashboardNavLink> = DASHBOARD_ALL_LINKS;

export function ActionButtons() {
  const panelTab = useDashboardUiStore((state) => state.panelTab);
  const setPanelTab = useDashboardUiStore((state) => state.setPanelTab);
  const quickTabs: Array<{ key: DashboardPanelTab; label: string }> = [
    { key: 'status', label: 'Status Cepat' },
    { key: 'command', label: 'Perintah Cepat' },
    { key: 'location', label: 'Semua Tabs' }
  ];

  return (
    <div className="cyber-panel hidden items-center gap-1.5 p-1.5 lg:flex">
      <p className="px-1 text-[10px] uppercase tracking-[0.12em] text-muted">Quick Tabs</p>
      <div className="grid flex-1 grid-cols-3 gap-1">
        {quickTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setPanelTab(tab.key)}
            className={`rounded border px-2 py-1 text-[11px] font-medium ${panelTab === tab.key ? 'border-accent bg-accent/20 text-text' : 'border-border bg-panel text-muted'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
