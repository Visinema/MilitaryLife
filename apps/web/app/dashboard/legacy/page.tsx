import { DashboardShell } from '@/components/dashboard-shell';
import { ActionButtons } from '@/components/action-buttons';
import Link from 'next/link';

export default function DashboardLegacyPage() {
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Link href="/dashboard/v5" className="rounded border border-accent/70 bg-accent/20 px-3 py-1 text-xs font-semibold text-text">
          Open V5 Dashboard
        </Link>
      </div>
      <ActionButtons />
      <DashboardShell />
    </div>
  );
}

