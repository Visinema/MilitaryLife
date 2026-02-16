import { DashboardShell } from '@/components/dashboard-shell';
import { ActionButtons } from '@/components/action-buttons';

export default function DashboardPage() {
  return (
    <div className="space-y-3">
      <ActionButtons />
      <DashboardShell />
    </div>
  );
}
