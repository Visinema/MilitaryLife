import dynamic from 'next/dynamic';

const ActionButtons = dynamic(() => import('@/components/action-buttons').then((mod) => mod.ActionButtons), {
  loading: () => <div className="cyber-panel h-16 animate-pulse" />
});

const DashboardShell = dynamic(() => import('@/components/dashboard-shell').then((mod) => mod.DashboardShell), {
  loading: () => <div className="cyber-panel h-[70vh] animate-pulse" />
});

export default function DashboardPage() {
  return (
    <div className="space-y-3">
      <ActionButtons />
      <DashboardShell />
    </div>
  );
}
