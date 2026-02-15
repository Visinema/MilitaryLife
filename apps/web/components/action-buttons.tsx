import Link from 'next/link';

export const DASHBOARD_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/dashboard/career', label: 'Career' },
  { href: '/dashboard/training', label: 'Training' },
  { href: '/dashboard/deployment', label: 'Deployment' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/event-frame', label: 'Event Frame' },
  { href: '/dashboard/decision-log', label: 'Decision Log' },
  { href: '/dashboard/hierarchy', label: 'Hierarchy V2' },
  { href: '/dashboard/people', label: 'NPC / People' }
];

export function ActionButtons() {
  return (
    <nav aria-label="Dashboard quick navigation" className="cyber-panel grid grid-cols-2 gap-1.5 p-1.5 sm:grid-cols-4 lg:grid-cols-8">
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
  );
}
