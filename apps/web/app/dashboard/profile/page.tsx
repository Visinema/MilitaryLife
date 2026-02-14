'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PausedRouteGuard } from '@/components/paused-route-guard';
import { PersonalStatsPanel } from '@/components/personal-stats-panel';
import { api } from '@/lib/api-client';
import { useGameStore } from '@/store/game-store';

export default function ProfilePage() {
  const router = useRouter();
  const snapshot = useGameStore((state) => state.snapshot);
  const setSnapshot = useGameStore((state) => state.setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (snapshot) return;
    void api
      .snapshot()
      .then((response) => setSnapshot(response.snapshot))
      .catch((err: Error) => setError(`Gagal memuat profile: ${err.message}`));
  }, [setSnapshot, snapshot]);

  const logout = async () => {
    setBusy(true);
    try {
      await api.logout();
      router.replace('/login');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PausedRouteGuard />
      <div className="flex items-center justify-between rounded-md border border-border bg-panel px-4 py-3 shadow-panel">
        <h1 className="text-lg font-semibold">Profile</h1>
        <Link href="/dashboard" className="text-sm text-muted underline">
          Back to Dashboard
        </Link>
      </div>

      <div className="rounded-md border border-border bg-panel p-4 shadow-panel">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <p className="text-xs uppercase tracking-[0.12em] text-muted">Current Branch</p>
        <p className="mt-1 text-base text-text">{snapshot?.branch ?? '-'}</p>

        <p className="mt-4 text-xs uppercase tracking-[0.12em] text-muted">Current Rank</p>
        <p className="mt-1 text-base text-text">{snapshot?.rankCode ?? '-'}</p>

        {snapshot ? (
          <div className="mt-4">
            <PersonalStatsPanel
              title="Active Commander"
              seed={snapshot.gameDay + snapshot.age}
              baseMorale={snapshot.morale}
              baseHealth={snapshot.health}
              baseReadiness={Math.min(100, 45 + Math.floor(snapshot.gameDay / 4))}
            />
          </div>
        ) : null}

        <button
          onClick={logout}
          disabled={busy}
          className="mt-6 rounded border border-border bg-bg px-4 py-2 text-sm text-text hover:border-accent disabled:opacity-60"
        >
          {busy ? 'Signing out...' : 'Logout'}
        </button>
      </div>
    </div>
  );
}
