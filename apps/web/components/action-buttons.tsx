import Link from 'next/link';

const links = [
  { href: '/dashboard/career', label: 'Career' },
  { href: '/dashboard/training', label: 'Training' },
  { href: '/dashboard/deployment', label: 'Deployment' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/decision-log', label: 'Decision Log' },
  { href: '/dashboard/hierarchy', label: 'Hierarchy V2' }
];

export function ActionButtons() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="rounded border border-border bg-panel px-3 py-2 text-center text-sm font-medium text-text transition hover:border-accent"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
