'use client';

import Link from 'next/link';
import { useDashboardUiStore, type DashboardPanelTab } from '@/store/dashboard-ui-store';

export const DASHBOARD_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard/career', label: 'Career' },
  { href: '/dashboard/training', label: 'Training' },
  { href: '/dashboard/deployment', label: 'Deployment' },
  { href: '/dashboard/academy', label: 'Academy' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/event-frame', label: 'Event Frame' },
  { href: '/dashboard/decision-log', label: 'Decision Log' },
  { href: '/dashboard/hierarchy', label: 'Hierarchy V2' },
  { href: '/dashboard/people', label: 'NPC / People' },
  { href: '/dashboard/mailbox', label: 'Mailbox' },
  { href: '/dashboard/social-profile', label: 'Social Profile' }
];

export function ActionButtons() {
  const panelTab = useDashboardUiStore((state) => state.panelTab);
  const setPanelTab = useDashboardUiStore((state) => state.setPanelTab);
  const quickTabs: Array<{ key: DashboardPanelTab; label: string }> = [
    { key: 'status', label: 'Status Cepat' },
    { key: 'command', label: 'Perintah Cepat' },
    { key: 'location', label: 'Semua Tabs' }
  ];

  return (
    <div className="space-y-1.5">
      <nav aria-label="Dashboard quick navigation" className="cyber-panel grid grid-cols-2 gap-1.5 p-1.5 sm:grid-cols-5 lg:grid-cols-11">
        {DASHBOARD_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded border border-border/80 bg-bg/70 px-2.5 py-1.5 text-center text-[11px] font-medium text-text transition hover:border-accent sm:text-xs"
          >
            {link.label}
          </Link>
        ))}
      </nav>
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
    </div>
  );
}
